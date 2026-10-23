use std::f32::consts::FRAC_PI_2;
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::thread;
use std::time::Duration;

use sha2::{Digest, Sha256};

use super::mixer::LaneLevel;
use super::{EngineEvent, LoopSource, file};

const SEAM_SECS: f32 = 0.5;
const QUIET_WINDOW_SECS: f32 = 0.05;
const QUIET_POWER_RATIO: f64 = 0.01;

pub(super) struct LoadedLoop {
    pub(super) samples: Box<[i16]>,
    pub(super) level: Arc<LaneLevel>,
}

pub(super) struct LoadRequest {
    pub(super) id: String,
    pub(super) source: LoopSource,
    pub(super) cache_dir: PathBuf,
    pub(super) rate: u32,
    pub(super) level: Arc<LaneLevel>,
}

pub(super) fn spawn_load(request: LoadRequest, loaded: Sender<LoadedLoop>, events: Sender<EngineEvent>) {
    thread::spawn(move || match load(&request.source, &request.cache_dir, request.rate) {
        Ok(samples) => {
            let _ = loaded.send(LoadedLoop {
                samples,
                level: request.level,
            });
        }
        Err(message) => {
            request.level.retire();
            let _ = events.send(EngineEvent::AmbientFailed {
                id: request.id,
                message,
            });
        }
    });
}

fn load(source: &LoopSource, cache_dir: &Path, rate: u32) -> Result<Box<[i16]>, String> {
    let url = match source {
        LoopSource::File(url) => url,
        LoopSource::Noise(noise) => {
            let mut samples = noise.generate(rate);
            close_loop(&mut samples, (SEAM_SECS * rate as f32) as usize);
            return Ok(samples.into_boxed_slice());
        }
    };
    let path = cached_file(url, cache_dir)?;
    let looped = decode(&path, rate).and_then(|samples| into_loop(&path, samples, rate));
    if looped.is_err() {
        // A damaged download would fail the same way every time, so the next try fetches it again.
        let _ = fs::remove_file(&path);
    }
    looped
}

fn cached_file(url: &str, cache_dir: &Path) -> Result<PathBuf, String> {
    let name = cache_name(url).ok_or_else(|| format!("no file name in {url}"))?;
    let dir = cache_dir.join("ambient");
    let path = dir.join(&name);
    if path.is_file() {
        return Ok(path);
    }
    let io_error = |error: io::Error| format!("could not cache {name}: {error}");
    fs::create_dir_all(&dir).map_err(io_error)?;
    let response = ureq::get(url)
        .config()
        .timeout_global(Some(Duration::from_secs(60)))
        .build()
        .call()
        .map_err(|error| format!("could not download {name}: {error}"))?;
    // Each download writes a partial file of its own, so two loads of one sound can't interleave.
    static DOWNLOADS: AtomicU64 = AtomicU64::new(0);
    let download = DOWNLOADS.fetch_add(1, Ordering::Relaxed);
    let partial = dir.join(format!("{name}.{}-{download}.part", std::process::id()));
    let written = File::create(&partial)
        .and_then(|mut file| io::copy(&mut response.into_body().into_reader(), &mut file))
        .and_then(|_| fs::rename(&partial, &path));
    if let Err(error) = written {
        let _ = fs::remove_file(&partial);
        return Err(io_error(error));
    }
    Ok(path)
}

fn cache_name(url: &str) -> Option<String> {
    let resource = url.split('#').next()?;
    let path = resource.split('?').next()?;
    let last = path.rsplit('/').next()?;
    if last.is_empty() || last.starts_with('.') {
        return None;
    }
    Some(format!("{:x}", Sha256::digest(resource.as_bytes())))
}

fn decode(path: &Path, rate: u32) -> Result<Vec<i16>, String> {
    let source = File::open(path).map_err(|error| format!("could not open {}: {error}", path.display()))?;
    let mut samples = Vec::new();
    file::decode(Box::new(source), 0.0, rate, |decoded| {
        samples.extend(
            decoded
                .iter()
                .map(|&sample| (sample * 32768.0).round().clamp(-32768.0, 32767.0) as i16),
        );
        true
    })?;
    Ok(samples)
}

fn into_loop(path: &Path, mut samples: Vec<i16>, rate: u32) -> Result<Box<[i16]>, String> {
    trim_quiet_ends(&mut samples, (QUIET_WINDOW_SECS * rate as f32) as usize);
    close_loop(&mut samples, (SEAM_SECS * rate as f32) as usize);
    if samples.len() < 2 {
        return Err(format!("{} contains no audio", path.display()));
    }
    Ok(samples.into_boxed_slice())
}

/// Cuts encoder padding and baked-in fades (windows 20 dB below the loop's mean power) off
/// both ends, which no seam crossfade could hide.
fn trim_quiet_ends(samples: &mut Vec<i16>, window_frames: usize) {
    let window = window_frames * 2;
    if window == 0 || samples.is_empty() {
        return;
    }
    let power = |chunk: &[i16]| chunk.iter().map(|&s| f64::from(s).powi(2)).sum::<f64>() / chunk.len() as f64;
    let threshold = power(samples) * QUIET_POWER_RATIO;
    let loud = |chunk: &[i16]| power(chunk) >= threshold;
    let (Some(first), Some(last)) = (
        samples.chunks(window).position(loud),
        samples.chunks(window).rposition(loud),
    ) else {
        return;
    };
    samples.truncate(((last + 1) * window).min(samples.len()));
    samples.drain(..first * window);
}

/// Blends the last `seam_frames` of an interleaved stereo loop into its head with an
/// equal-power crossfade, then trims them, so the wrap from end to start is continuous.
fn close_loop(samples: &mut Vec<i16>, seam_frames: usize) {
    let frames = samples.len() / 2;
    let seam = seam_frames.min(frames / 4);
    if seam == 0 {
        return;
    }
    let tail_start = (frames - seam) * 2;
    for index in 0..seam * 2 {
        let t = ((index / 2) as f32 + 0.5) / seam as f32;
        let head = f32::from(samples[index]) * (t * FRAC_PI_2).sin();
        let tail = f32::from(samples[tail_start + index]) * (t * FRAC_PI_2).cos();
        samples[index] = (head + tail).round().clamp(f32::from(i16::MIN), f32::from(i16::MAX)) as i16;
    }
    samples.truncate(tail_start);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stereo_sine(frames: usize, period: f32) -> Vec<i16> {
        (0..frames)
            .flat_map(|frame| {
                let value = (10_000.0 * (std::f32::consts::TAU * frame as f32 / period).sin()) as i16;
                [value, value]
            })
            .collect()
    }

    #[test]
    fn closing_the_loop_trims_the_seam_and_removes_the_wrap_jump() {
        let period = 97.3;
        let mut samples = stereo_sine(4_800, period);
        let largest_step = 2 * (10_000.0 * std::f32::consts::TAU / period) as i32;
        let jump = |a: i16, b: i16| (i32::from(a) - i32::from(b)).abs();
        let wrap_jump = |s: &[i16]| jump(s[s.len() - 2], s[0]);
        assert!(wrap_jump(&samples) > largest_step);

        close_loop(&mut samples, 240);

        assert_eq!(samples.len(), (4_800 - 240) * 2);
        assert!(wrap_jump(&samples) <= largest_step);
        assert!(samples.windows(4).step_by(2).all(|w| jump(w[2], w[0]) <= largest_step));
    }

    #[test]
    fn quiet_ends_are_trimmed_but_quiet_moments_inside_are_kept() {
        let loud = stereo_sine(1_000, 50.0);
        let samples: Vec<i16> = [vec![0; 300], loud.clone(), vec![3; 200], loud, vec![0; 500]].concat();
        let mut trimmed = samples.clone();

        trim_quiet_ends(&mut trimmed, 50);

        assert_eq!(trimmed.as_slice(), &samples[300..samples.len() - 500]);
    }

    #[test]
    fn a_cached_loop_that_cannot_be_decoded_is_dropped() {
        let cache = tempfile::tempdir().unwrap();
        let url = "https://example.com/rain.mp3";
        let path = cache.path().join("ambient").join(cache_name(url).unwrap());
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"not audio").unwrap();

        assert!(load(&LoopSource::File(url.into()), cache.path(), 48_000).is_err());
        assert!(!path.exists());
    }

    #[test]
    fn cache_names_distinguish_resource_paths_and_query_versions() {
        assert_ne!(
            cache_name("https://x.dev/rain/light.mp3"),
            cache_name("https://x.dev/rain_light.mp3")
        );
        assert_ne!(
            cache_name("https://x.dev/rain.mp3?v=1"),
            cache_name("https://x.dev/rain.mp3?v=2")
        );
        assert_ne!(
            cache_name("https://x.dev/rain.mp3"),
            cache_name("https://y.dev/rain.mp3")
        );
        assert_eq!(
            cache_name("https://x.dev/rain.mp3?v=1#one"),
            cache_name("https://x.dev/rain.mp3?v=1#two")
        );
        assert_eq!(cache_name("https://x.dev/a/.."), None);
        assert_eq!(cache_name("https://x.dev/"), None);
    }
}
