use std::io::{BufRead, BufReader, ErrorKind, Read};
use std::process::{Child, ChildStderr, ChildStdout, ExitStatus, Stdio};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use rtrb::{Producer, RingBuffer};

use super::mixer::{MusicLane, MusicState};
use super::{EngineEvent, StreamInput, ffmpeg};

const BUFFER_SECS: usize = 2;
const BACKOFF: Duration = Duration::from_millis(10);

/// Owns one ffmpeg process. Dropping it cancels the reader thread and kills the process.
pub(super) struct Decoder {
    state: Arc<MusicState>,
    child: Arc<Mutex<Child>>,
}

impl Decoder {
    pub(super) fn spawn(
        input: &StreamInput,
        start_secs: f64,
        rate: u32,
        report: impl Fn(EngineEvent) + Send + 'static,
    ) -> Result<(Self, MusicLane), String> {
        let mut command = ffmpeg::command();
        if input.url.starts_with("http://") || input.url.starts_with("https://") {
            // Without a read timeout, a connection that goes silent (a closed lid, a Wi-Fi
            // switch) blocks ffmpeg forever instead of ending the stream so the app reconnects.
            command.args([
                "-reconnect",
                "1",
                "-reconnect_streamed",
                "1",
                "-reconnect_delay_max",
                "5",
                "-rw_timeout",
                "10000000",
            ]);
        }
        if !input.headers.is_empty() {
            let headers: String = input
                .headers
                .iter()
                .map(|(name, value)| format!("{name}: {value}\r\n"))
                .collect();
            command.arg("-headers").arg(headers);
        }
        if start_secs > 0.0 {
            command.arg("-ss").arg(format!("{start_secs:.3}"));
        }
        // YouTube uploads and live streams are mastered anywhere from very quiet to very loud, so
        // every stream is brought to -14 LUFS, where streaming services play music, and the
        // balance against the ambience stays where it was set.
        command
            .args(["-i", &input.url, "-vn", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11"])
            .args(["-f", "f32le", "-ac", "2", "-ar"])
            .arg(rate.to_string())
            .arg("pipe:1")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = command.spawn().map_err(ffmpeg::spawn_error)?;
        let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
            let _ = child.kill();
            let _ = child.wait();
            return Err("ffmpeg started without output pipes".to_owned());
        };
        let (producer, consumer) = RingBuffer::new(rate as usize * 2 * BUFFER_SECS);
        let state = Arc::new(MusicState::new());
        let child = Arc::new(Mutex::new(child));
        let reader = Reader {
            producer,
            state: Arc::clone(&state),
            child: Arc::clone(&child),
            report: Box::new(report),
        };
        thread::spawn(move || reader.run(stdout, collect_last_line(stderr)));
        let lane = MusicLane::new(consumer, Arc::clone(&state));
        Ok((Self { state, child }, lane))
    }

    pub(super) fn state(&self) -> &MusicState {
        &self.state
    }
}

impl Drop for Decoder {
    fn drop(&mut self) {
        self.state.cancelled.store(true, Ordering::Release);
        let _ = lock(&self.child).kill();
    }
}

struct Reader {
    producer: Producer<f32>,
    state: Arc<MusicState>,
    child: Arc<Mutex<Child>>,
    report: Box<dyn Fn(EngineEvent) + Send>,
}

impl Reader {
    fn run(mut self, mut stdout: ChildStdout, stderr: JoinHandle<String>) {
        self.pump(&mut stdout);
        let status = self.reap();
        let last_line = stderr.join().unwrap_or_default();
        self.state.finished.store(true, Ordering::Release);
        if self.cancelled() {
            return;
        }
        match status {
            Ok(status) if status.success() => {
                self.wait_until_drained();
                if !self.cancelled() {
                    (self.report)(EngineEvent::Ended);
                }
            }
            Ok(status) => {
                let message = if last_line.is_empty() {
                    format!("ffmpeg exited with {status}")
                } else {
                    last_line
                };
                (self.report)(EngineEvent::Failed(message));
            }
            Err(error) => {
                (self.report)(EngineEvent::Failed(error.to_string()));
            }
        }
    }

    fn pump(&mut self, stdout: &mut ChildStdout) {
        let mut bytes = vec![0_u8; 16 * 1024];
        let mut samples = Vec::with_capacity(bytes.len() / 4);
        let mut filled = 0;
        while !self.cancelled() {
            match stdout.read(&mut bytes[filled..]) {
                Ok(0) => return,
                Ok(read) => {
                    filled += read;
                    let (whole, rest) = bytes[..filled].as_chunks::<4>();
                    samples.clear();
                    samples.extend(whole.iter().map(|&sample| f32::from_le_bytes(sample)));
                    let leftover = rest.len();
                    bytes.copy_within(filled - leftover..filled, 0);
                    filled = leftover;
                    if !self.push(&samples) {
                        return;
                    }
                }
                Err(error) if error.kind() == ErrorKind::Interrupted => {}
                Err(_) => return,
            }
        }
    }

    fn push(&mut self, mut samples: &[f32]) -> bool {
        while !samples.is_empty() {
            if self.cancelled() || self.producer.is_abandoned() {
                return false;
            }
            let (_, rest) = self.producer.push_partial_slice(samples);
            if rest.len() == samples.len() {
                thread::sleep(BACKOFF);
            }
            samples = rest;
        }
        true
    }

    fn reap(&self) -> std::io::Result<ExitStatus> {
        loop {
            {
                let mut child = lock(&self.child);
                if self.cancelled() {
                    let _ = child.kill();
                }
                if let Some(status) = child.try_wait()? {
                    return Ok(status);
                }
            }
            thread::sleep(BACKOFF);
        }
    }

    fn wait_until_drained(&self) {
        while self.producer.slots() < self.producer.buffer().capacity()
            && !self.producer.is_abandoned()
            && !self.cancelled()
        {
            thread::sleep(BACKOFF * 2);
        }
    }

    fn cancelled(&self) -> bool {
        self.state.cancelled.load(Ordering::Acquire)
    }
}

fn collect_last_line(stderr: ChildStderr) -> JoinHandle<String> {
    thread::spawn(move || {
        let mut last = String::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Some(line) = ffmpeg::last_line(&line) {
                last = line.to_owned();
            }
        }
        last
    })
}

fn lock(child: &Mutex<Child>) -> MutexGuard<'_, Child> {
    child.lock().unwrap_or_else(PoisonError::into_inner)
}
