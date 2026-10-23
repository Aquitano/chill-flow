use std::io::{self, Read, Seek, SeekFrom};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError, Weak};
use std::thread;
use std::time::{Duration, Instant};

use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Fft, FixedSync, Resampler};
use symphonia::core::codecs::CodecParameters;
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::{Error, SeekErrorKind};
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, SeekMode, SeekTo, TrackType};
use symphonia::core::io::{MediaSource, MediaSourceStream};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::units::Time;

use super::mixer::MusicState;

/// How long a download may go without a byte before playback gives up on it, so the app
/// reconnects instead of waiting on a connection that went silent.
const STALL: Duration = Duration::from_secs(10);
/// The most a file may hold, about three hours of a catalog track, so a wrong link can't fill
/// memory.
const SIZE_LIMIT: u64 = 256 * 1024 * 1024;
/// How many frames the resampler converts at a time.
const CHUNK_FRAMES: usize = 1024;

/// A catalog file fetched into memory while it plays, so a seek reads it again rather than
/// fetching it twice.
pub(super) struct Download {
    url: String,
    progress: Mutex<Progress>,
    arrived: Condvar,
}

struct Progress {
    bytes: Vec<u8>,
    end: Option<Result<(), String>>,
    arrived_at: Instant,
}

impl Download {
    pub(super) fn start(url: &str) -> Arc<Download> {
        let download = Arc::new(Download {
            url: url.to_owned(),
            progress: Mutex::new(Progress {
                bytes: Vec::new(),
                end: None,
                arrived_at: Instant::now(),
            }),
            arrived: Condvar::new(),
        });
        let fetching = Arc::downgrade(&download);
        let url = url.to_owned();
        thread::spawn(move || {
            let result = fetch(&url, &fetching);
            if let Some(download) = fetching.upgrade() {
                download.end(result);
            }
        });
        download
    }

    pub(super) fn url(&self) -> &str {
        &self.url
    }

    /// Whether a seek can read it again, which a failed download can't.
    pub(super) fn usable(&self) -> bool {
        !matches!(self.lock().end, Some(Err(_)))
    }

    fn lock(&self) -> MutexGuard<'_, Progress> {
        self.progress.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Keeps bytes that arrived, and returns whether the download should go on.
    fn append(&self, chunk: &[u8]) -> bool {
        let mut progress = self.lock();
        if progress.end.is_some() {
            return false;
        }
        progress.bytes.extend_from_slice(chunk);
        progress.arrived_at = Instant::now();
        self.arrived.notify_all();
        true
    }

    fn end(&self, result: Result<(), String>) {
        self.lock().end.get_or_insert(result);
        self.arrived.notify_all();
    }
}

/// Stops early once nothing plays the download any more.
fn fetch(url: &str, download: &Weak<Download>) -> Result<(), String> {
    let response = ureq::get(url)
        .config()
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_response(Some(Duration::from_secs(15)))
        // ureq has no idle timeout, so a connection that goes silent holds this thread for up to
        // this long, though playback gives up on it after STALL.
        .timeout_recv_body(Some(Duration::from_secs(30 * 60)))
        .build()
        .call()
        .map_err(|error| error.to_string())?;
    let mut body = response.into_body().into_with_config().limit(SIZE_LIMIT).reader();
    let mut chunk = vec![0; 64 * 1024];
    loop {
        let read = match body.read(&mut chunk) {
            Ok(0) => return Ok(()),
            Ok(read) => read,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error.to_string()),
        };
        match download.upgrade() {
            Some(download) if download.append(&chunk[..read]) => {}
            _ => return Ok(()),
        }
    }
}

/// Reads a download from its start, waiting for bytes still on their way.
pub(super) struct Bytes {
    download: Arc<Download>,
    position: usize,
    state: Arc<MusicState>,
}

impl Bytes {
    pub(super) fn new(download: Arc<Download>, state: Arc<MusicState>) -> Bytes {
        Bytes {
            download,
            position: 0,
            state,
        }
    }
}

impl Read for Bytes {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let download = &self.download;
        let mut progress = download.lock();
        loop {
            if let Some(available) = progress.bytes.get(self.position..)
                && !available.is_empty()
            {
                let count = available.len().min(buf.len());
                buf[..count].copy_from_slice(&available[..count]);
                self.position += count;
                return Ok(count);
            }
            match &progress.end {
                Some(Ok(())) => return Ok(0),
                Some(Err(message)) => return Err(io::Error::other(message.clone())),
                None if self.state.cancelled.load(Ordering::Acquire) => {
                    return Err(io::Error::other("playback moved on"));
                }
                None if progress.arrived_at.elapsed() >= STALL => {
                    progress.end = Some(Err("the download stopped arriving".to_owned()));
                }
                None => {
                    progress = download
                        .arrived
                        .wait_timeout(progress, Duration::from_millis(100))
                        .unwrap_or_else(PoisonError::into_inner)
                        .0;
                }
            }
        }
    }
}

impl Seek for Bytes {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        let position = match to {
            SeekFrom::Start(position) => Some(position),
            SeekFrom::Current(offset) => (self.position as u64).checked_add_signed(offset),
            SeekFrom::End(_) => None,
        }
        .ok_or_else(|| io::Error::new(io::ErrorKind::Unsupported, "a download can't seek from its end"))?;
        self.position = usize::try_from(position).map_err(io::Error::other)?;
        Ok(position)
    }
}

impl MediaSource for Bytes {
    /// Probing a seekable source reads its end for tags, which would wait for the whole
    /// download, so the decoder reads straight through and seeks forward by reading.
    fn is_seekable(&self) -> bool {
        false
    }

    fn byte_len(&self) -> Option<u64> {
        None
    }
}

/// Decodes `source` from `start_secs` to stereo at `rate`, handing the samples to `push`
/// until the source ends or `push` returns false.
pub(super) fn decode(
    source: Box<dyn MediaSource>,
    start_secs: f64,
    rate: u32,
    mut push: impl FnMut(&[f32]) -> bool,
) -> Result<(), String> {
    let stream = MediaSourceStream::new(source, Default::default());
    let mut format = symphonia::default::get_probe()
        .probe(
            &Hint::new(),
            stream,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(|error| format!("chill can't read this audio: {error}"))?;
    let track = format
        .default_track(TrackType::Audio)
        .ok_or("the file holds no audio")?;
    let (track_id, time_base) = (track.id, track.time_base);
    let Some(CodecParameters::Audio(params)) = track.codec_params.clone() else {
        return Err("the file holds no audio".to_owned());
    };
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&params, &AudioDecoderOptions::default())
        .map_err(|error| format!("chill can't decode this audio: {error}"))?;
    let source_rate = params.sample_rate.ok_or("the file has no sample rate")?;
    let mut converter = ToRate::new(source_rate, rate)?;

    let mut skip_to = None;
    if start_secs > 0.0 {
        let time = Time::try_from_secs_f64(start_secs).ok_or("the start is out of range")?;
        match format.seek(
            SeekMode::Accurate,
            SeekTo::Time {
                time,
                track_id: Some(track_id),
            },
        ) {
            Ok(_) => skip_to = time_base.map(|base| (base, start_secs)),
            Err(Error::SeekError(SeekErrorKind::OutOfRange)) => return Ok(()),
            Err(error) => return Err(error.to_string()),
        }
    }

    let (mut samples, mut stereo) = (Vec::new(), Vec::new());
    while let Some(packet) = format.next_packet().map_err(|error| error.to_string())? {
        if packet.track_id != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            // A damaged frame drops out rather than ending the track.
            Err(Error::DecodeError(_)) => continue,
            Err(error) => return Err(error.to_string()),
        };
        let channels = decoded.spec().channels().count();
        decoded.copy_to_vec_interleaved(&mut samples);
        let mut skip = 0;
        // A seek lands on a frame at or before the start; what comes before the start is dropped.
        if let Some((base, from)) = skip_to {
            let begins = base.calc_time(packet.pts).map_or(from, |time| time.as_secs_f64());
            skip = ((from - begins) * f64::from(source_rate)).round().max(0.0) as usize;
            if skip < decoded.frames() {
                skip_to = None;
            }
        }
        to_stereo(&samples, channels, skip, &mut stereo);
        if !converter.feed(&stereo, &mut push)? {
            return Ok(());
        }
    }
    converter.finish(&mut push)
}

fn to_stereo(samples: &[f32], channels: usize, skip: usize, stereo: &mut Vec<f32>) {
    stereo.clear();
    match channels {
        0 => {}
        1 => stereo.extend(samples.iter().skip(skip).flat_map(|&sample| [sample, sample])),
        _ => stereo.extend(
            samples
                .chunks_exact(channels)
                .skip(skip)
                .flat_map(|frame| [frame[0], frame[1]]),
        ),
    }
}

/// Carries stereo audio from a file's sample rate to the output's.
enum ToRate {
    Same,
    Resampled {
        resampler: Box<Fft<f32>>,
        pending: Vec<f32>,
        output: Vec<f32>,
        delay: usize,
    },
}

impl ToRate {
    fn new(from: u32, to: u32) -> Result<ToRate, String> {
        if from == to {
            return Ok(ToRate::Same);
        }
        let resampler = Fft::new(from as usize, to as usize, CHUNK_FRAMES, 2, FixedSync::Input)
            .map_err(|error| error.to_string())?;
        Ok(ToRate::Resampled {
            output: vec![0.0; resampler.output_frames_max() * 2],
            delay: resampler.output_delay(),
            resampler: Box::new(resampler),
            pending: Vec::new(),
        })
    }

    /// Hands `stereo` on at the output rate, and returns false once `push` wants no more.
    fn feed(&mut self, stereo: &[f32], push: &mut impl FnMut(&[f32]) -> bool) -> Result<bool, String> {
        let ToRate::Resampled {
            resampler,
            pending,
            output,
            delay,
        } = self
        else {
            return Ok(push(stereo));
        };
        pending.extend_from_slice(stereo);
        let mut used = 0;
        while pending.len() - used >= resampler.input_frames_next() * 2 {
            let frames = resampler.input_frames_next();
            let input = InterleavedSlice::new(&pending[used..], 2, frames).map_err(|error| error.to_string())?;
            let capacity = output.len() / 2;
            let mut out =
                InterleavedSlice::new_mut(output.as_mut_slice(), 2, capacity).map_err(|error| error.to_string())?;
            let (read, written) = resampler
                .process_into_buffer(&input, &mut out, None)
                .map_err(|error| error.to_string())?;
            used += read * 2;
            // The resampler starts with a few frames of its own delay, which would shift the track.
            let late = (*delay).min(written);
            *delay -= late;
            if !push(&output[late * 2..written * 2]) {
                return Ok(false);
            }
        }
        pending.drain(..used);
        Ok(true)
    }

    /// Lets out the last frames the resampler holds, followed by a moment of silence.
    fn finish(&mut self, push: &mut impl FnMut(&[f32]) -> bool) -> Result<(), String> {
        if let ToRate::Resampled { resampler, .. } = self {
            let silence = vec![0.0; (resampler.input_frames_max() + resampler.output_delay() + 1) * 4];
            self.feed(&silence, push)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(frames: usize, rate: u32) -> Vec<f32> {
        (0..frames)
            .flat_map(|frame| {
                let value = (std::f32::consts::TAU * 440.0 * frame as f32 / rate as f32).sin() * 0.5;
                [value, value]
            })
            .collect()
    }

    #[test]
    fn resampling_keeps_the_length_and_the_level() {
        let input = sine(44_100, 44_100);
        let mut output = Vec::new();
        let mut converter = ToRate::new(44_100, 48_000).unwrap();
        for chunk in input.chunks(1152 * 2) {
            assert!(
                converter
                    .feed(chunk, &mut |samples| {
                        output.extend_from_slice(samples);
                        true
                    })
                    .unwrap()
            );
        }
        converter
            .finish(&mut |samples| {
                output.extend_from_slice(samples);
                true
            })
            .unwrap();

        let frames = output.len() / 2;
        assert!((48_000..48_000 + 4 * CHUNK_FRAMES).contains(&frames), "{frames} frames");
        let peak = output[..96_000]
            .iter()
            .fold(0.0_f32, |peak, sample| peak.max(sample.abs()));
        assert!((0.48..0.52).contains(&peak), "peak {peak}");
        let first_loud = output.iter().position(|sample| sample.abs() > 0.01).unwrap() / 2;
        assert!(first_loud < 20, "starts {first_loud} frames late");
    }

    fn download(bytes: &[u8], end: Option<Result<(), String>>) -> Arc<Download> {
        Arc::new(Download {
            url: "https://cdn.example/tone.mp3".into(),
            progress: Mutex::new(Progress {
                bytes: bytes.to_vec(),
                end,
                arrived_at: Instant::now(),
            }),
            arrived: Condvar::new(),
        })
    }

    fn decoded(source: impl MediaSource + 'static, start_secs: f64) -> Vec<f32> {
        let mut samples = Vec::new();
        decode(Box::new(source), start_secs, 48_000, |decoded| {
            samples.extend_from_slice(decoded);
            true
        })
        .unwrap();
        samples
    }

    #[test]
    fn an_mp3_plays_in_stereo_at_the_output_rate_from_its_start() {
        const TONE: &[u8] = include_bytes!("tone.mp3");
        let whole = decoded(io::Cursor::new(TONE), 0.0);
        let frames = whole.len() / 2;
        assert!((96_000..96_000 + 4 * CHUNK_FRAMES).contains(&frames), "{frames} frames");
        assert!(whole.as_chunks::<2>().0.iter().all(|[left, right]| left == right));
        let peak = whole.iter().fold(0.0_f32, |peak, sample| peak.max(sample.abs()));
        assert!((0.45..0.55).contains(&peak), "peak {peak}");

        let streamed = |start_secs| {
            let state = Arc::new(MusicState::new());
            decoded(Bytes::new(download(TONE, Some(Ok(()))), state), start_secs)
        };
        assert_eq!(streamed(0.0), whole);
        let later = streamed(1.5).len() / 2;
        assert!((24_000..24_000 + 4 * CHUNK_FRAMES).contains(&later), "{later} frames");
        assert!(streamed(5.0).is_empty());
    }

    #[test]
    fn a_read_waits_for_bytes_on_their_way_and_stops_at_the_end() {
        let download = download(b"", None);
        let mut bytes = Bytes::new(Arc::clone(&download), Arc::new(MusicState::new()));
        let writer = Arc::clone(&download);
        let arriving = thread::spawn(move || {
            thread::sleep(Duration::from_millis(50));
            writer.append(b"abc");
            writer.end(Ok(()));
        });
        let mut read = Vec::new();
        bytes.read_to_end(&mut read).unwrap();
        arriving.join().unwrap();
        assert_eq!(read, b"abc");
        assert!(download.usable());
    }
}
