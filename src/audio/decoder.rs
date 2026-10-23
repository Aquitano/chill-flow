use std::io::{BufRead, BufReader, ErrorKind, Read};
use std::process::{Child, ChildStderr, ChildStdout, ExitStatus, Stdio};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use rtrb::{Producer, RingBuffer};

use super::file::{self, Bytes, Download};
use super::mixer::{MusicLane, MusicState};
use super::{EngineEvent, StreamInput, ffmpeg};

const BUFFER_SECS: usize = 2;
const BACKOFF: Duration = Duration::from_millis(10);

/// Decodes one music stream: a catalog file here, or anything else in an ffmpeg process.
/// Dropping it cancels the decoding thread and kills the process.
pub(super) struct Decoder {
    state: Arc<MusicState>,
    child: Option<Arc<Mutex<Child>>>,
}

impl Decoder {
    pub(super) fn spawn(
        input: &StreamInput,
        start_secs: f64,
        rate: u32,
        report: impl Fn(EngineEvent) + Send + 'static,
    ) -> Result<(Self, MusicLane), String> {
        // Links reach here from catalogs and from other machines through sync, and ffmpeg also
        // reads local files and protocols such as concat:, so nothing but the web gets through.
        if !(input.url.starts_with("http://") || input.url.starts_with("https://")) {
            return Err("only http and https links can play".to_owned());
        }
        let mut command = ffmpeg::command();
        // Without a read timeout, a connection that goes silent (a closed lid, a Wi-Fi switch)
        // blocks ffmpeg forever instead of ending the stream so the app reconnects.
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
        let child = Arc::new(Mutex::new(child));
        let (reader, decoder, lane) = Reader::new(rate, report, Some(Arc::clone(&child)));
        thread::spawn(move || reader.run(&child, stdout, collect_last_line(stderr)));
        Ok((decoder, lane))
    }

    pub(super) fn file(
        download: Arc<Download>,
        start_secs: f64,
        rate: u32,
        report: impl Fn(EngineEvent) + Send + 'static,
    ) -> (Self, MusicLane) {
        let (mut reader, decoder, lane) = Reader::new(rate, report, None);
        thread::spawn(move || {
            let source = Bytes::new(download, Arc::clone(&reader.state));
            let result = file::decode(Box::new(source), start_secs, rate, |samples| reader.push(samples));
            reader.end(result);
        });
        (decoder, lane)
    }

    pub(super) fn state(&self) -> &MusicState {
        &self.state
    }
}

impl Drop for Decoder {
    fn drop(&mut self) {
        self.state.cancelled.store(true, Ordering::Release);
        if let Some(child) = &self.child {
            let _ = lock(child).kill();
        }
    }
}

struct Reader {
    producer: Producer<f32>,
    state: Arc<MusicState>,
    report: Box<dyn Fn(EngineEvent) + Send>,
}

impl Reader {
    fn new(
        rate: u32,
        report: impl Fn(EngineEvent) + Send + 'static,
        child: Option<Arc<Mutex<Child>>>,
    ) -> (Reader, Decoder, MusicLane) {
        let (producer, consumer) = RingBuffer::new(rate as usize * 2 * BUFFER_SECS);
        let state = Arc::new(MusicState::new());
        let reader = Reader {
            producer,
            state: Arc::clone(&state),
            report: Box::new(report),
        };
        let lane = MusicLane::new(consumer, Arc::clone(&state));
        (reader, Decoder { state, child }, lane)
    }

    fn run(mut self, child: &Mutex<Child>, mut stdout: ChildStdout, stderr: JoinHandle<String>) {
        self.pump(&mut stdout);
        let status = self.reap(child);
        let last_line = stderr.join().unwrap_or_default();
        let result = match status {
            Ok(status) if status.success() => Ok(()),
            Ok(status) if last_line.is_empty() => Err(format!("ffmpeg exited with {status}")),
            Ok(_) => Err(last_line),
            Err(error) => Err(error.to_string()),
        };
        self.end(result);
    }

    /// Reports how the stream ended, once the lane played what was decoded.
    fn end(self, result: Result<(), String>) {
        self.state.finished.store(true, Ordering::Release);
        if self.cancelled() {
            return;
        }
        match result {
            Ok(()) => {
                self.wait_until_drained();
                if !self.cancelled() {
                    (self.report)(EngineEvent::Ended);
                }
            }
            Err(message) => (self.report)(EngineEvent::Failed(message)),
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

    fn reap(&self, child: &Mutex<Child>) -> std::io::Result<ExitStatus> {
        loop {
            {
                let mut child = lock(child);
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
