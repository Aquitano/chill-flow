use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex, PoisonError};
use std::thread::{self, Thread};
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, ErrorKind, FromSample, SampleFormat, SizedSample, StreamConfig};
use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Fft, FixedSync, Resampler};

use super::EngineEvent;
use super::mixer::{BLOCK_FRAMES, Mixer};

const RETRY_INTERVAL: Duration = Duration::from_secs(2);
const OPEN_TIMEOUT: Duration = Duration::from_secs(3);

/// The rate the whole session mixes at, fixed when it starts.
pub(super) fn device_rate() -> Result<u32, String> {
    let device = cpal::default_host()
        .default_output_device()
        .ok_or("no audio output device")?;
    let default = device.default_output_config().map_err(|error| error.to_string())?;
    Ok(session_rate(default.sample_rate(), plays_at(&device, PREFERRED_RATE)))
}

fn plays_at(device: &cpal::Device, rate: u32) -> bool {
    device.supported_output_configs().map_or(true, |mut configs| {
        configs.any(|range| (range.min_sample_rate()..=range.max_sample_rate()).contains(&rate))
    })
}

const PREFERRED_RATE: u32 = 48_000;

/// Prefers 48 kHz, which every output runs outside a headset's call mode, so a session that
/// starts during a call isn't stuck at the call's 16 or 24 kHz once it ends. An output that
/// can't do 48 kHz at all keeps its own rate.
fn session_rate(default: u32, supports_preferred: bool) -> u32 {
    if supports_preferred || default < 44_100 {
        PREFERRED_RATE
    } else {
        default
    }
}

/// Keeps the mixer running: on the default output device when there is one, otherwise on
/// a silent real-time clock so playback position and the spectrum keep moving.
pub(super) struct Output {
    shutdown: Arc<AtomicBool>,
    thread: Thread,
}

impl Output {
    pub(super) fn start(mixer: Mixer, rate: u32, device: Result<(), String>, events: Sender<EngineEvent>) -> Self {
        let shutdown = Arc::new(AtomicBool::new(false));
        let supervisor = Supervisor {
            mixer: Arc::new(Mutex::new(mixer)),
            rate,
            events,
            shutdown: Arc::clone(&shutdown),
        };
        let thread = thread::spawn(move || supervisor.run(device)).thread().clone();
        Self { shutdown, thread }
    }
}

impl Drop for Output {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Release);
        self.thread.unpark();
    }
}

/// The mixer sits behind a mutex only so it survives a stream rebuild. At most one consumer
/// (the active device callback or the null sink) touches it at a time, so the callback's
/// `try_lock` never contends and never blocks.
struct Supervisor {
    mixer: Arc<Mutex<Mixer>>,
    rate: u32,
    events: Sender<EngineEvent>,
    shutdown: Arc<AtomicBool>,
}

impl Supervisor {
    fn run(self, device: Result<(), String>) {
        // On Linux a device missing at startup is never probed again, because every failed
        // ALSA open prints to stderr over the TUI. Elsewhere it is retried like a lost one.
        let mut reported = false;
        if let Err(reason) = device {
            let _ = self.events.send(EngineEvent::NoDevice(reason));
            if cfg!(target_os = "linux") {
                self.null_sink(None);
                return;
            }
            reported = true;
        }
        while !self.stopping() {
            let lost = Arc::new(AtomicBool::new(false));
            match self.open(&lost) {
                Ok(stream) => {
                    reported = false;
                    while !lost.load(Ordering::Acquire) && !self.stopping() {
                        thread::park_timeout(Duration::from_secs(1));
                    }
                    drop(stream);
                }
                Err(reason) => {
                    if !reported {
                        let _ = self.events.send(EngineEvent::NoDevice(reason));
                        reported = true;
                    }
                    self.null_sink(Some(RETRY_INTERVAL));
                }
            }
        }
    }

    fn stopping(&self) -> bool {
        self.shutdown.load(Ordering::Acquire)
    }

    fn open(&self, lost: &Arc<AtomicBool>) -> Result<cpal::Stream, String> {
        let device = cpal::default_host()
            .default_output_device()
            .ok_or("no audio output device")?;
        let supported = device.default_output_config().map_err(|error| error.to_string())?;
        let config = StreamConfig {
            channels: supported.channels(),
            sample_rate: if plays_at(&device, self.rate) {
                self.rate
            } else {
                supported.sample_rate()
            },
            buffer_size: BufferSize::Default,
        };
        let stream = match supported.sample_format() {
            SampleFormat::F32 => self.build::<f32>(&device, config, lost),
            SampleFormat::F64 => self.build::<f64>(&device, config, lost),
            SampleFormat::I8 => self.build::<i8>(&device, config, lost),
            SampleFormat::I16 => self.build::<i16>(&device, config, lost),
            SampleFormat::I24 => self.build::<cpal::I24>(&device, config, lost),
            SampleFormat::I32 => self.build::<i32>(&device, config, lost),
            SampleFormat::I64 => self.build::<i64>(&device, config, lost),
            SampleFormat::U8 => self.build::<u8>(&device, config, lost),
            SampleFormat::U16 => self.build::<u16>(&device, config, lost),
            SampleFormat::U24 => self.build::<cpal::U24>(&device, config, lost),
            SampleFormat::U32 => self.build::<u32>(&device, config, lost),
            SampleFormat::U64 => self.build::<u64>(&device, config, lost),
            other => Err(format!("unsupported sample format {other:?}")),
        }?;
        stream.play().map_err(|error| error.to_string())?;
        Ok(stream)
    }

    fn build<T>(
        &self,
        device: &cpal::Device,
        config: StreamConfig,
        lost: &Arc<AtomicBool>,
    ) -> Result<cpal::Stream, String>
    where
        T: SizedSample + FromSample<f32>,
    {
        let channels = usize::from(config.channels);
        let mixer = Arc::clone(&self.mixer);
        let mut stereo = vec![0.0; BLOCK_FRAMES * 2];
        let mut to_device = (config.sample_rate != self.rate)
            .then(|| ToDevice::new(self.rate, config.sample_rate))
            .transpose()?;
        let lost = Arc::clone(lost);
        let supervisor = thread::current();
        device
            .build_output_stream::<T, _, _>(
                config,
                move |out: &mut [T], _| match mixer.try_lock() {
                    Ok(mut mixer) => write_frames(out, channels, &mut stereo, |mix| match &mut to_device {
                        Some(to_device) => to_device.render(mix, |input| mixer.render(input)),
                        None => mixer.render(mix),
                    }),
                    Err(_) => out.fill(T::EQUILIBRIUM),
                },
                move |error| {
                    if matches!(
                        error.kind(),
                        ErrorKind::DeviceNotAvailable | ErrorKind::StreamInvalidated
                    ) {
                        lost.store(true, Ordering::Release);
                        supervisor.unpark();
                    }
                },
                Some(OPEN_TIMEOUT),
            )
            .map_err(|error| error.to_string())
    }

    fn null_sink(&self, duration: Option<Duration>) {
        let block = (self.rate / 100).max(1) as usize;
        let period = Duration::from_secs_f64(block as f64 / f64::from(self.rate));
        let mut buffer = vec![0.0; block * 2];
        let started = Instant::now();
        let mut next = started;
        while !self.stopping() && duration.is_none_or(|limit| started.elapsed() < limit) {
            self.mixer
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .render(&mut buffer);
            next += period;
            let now = Instant::now();
            if next > now {
                thread::sleep(next - now);
            } else if now - next > Duration::from_millis(200) {
                next = now;
            }
        }
    }
}

/// Carries the mix from the session rate to an output that can't play it, such as a headset
/// that joins mid-session in its call mode.
struct ToDevice {
    resampler: Fft<f32>,
    input: Vec<f32>,
    output: Vec<f32>,
    played: usize,
}

impl ToDevice {
    fn new(from: u32, to: u32) -> Result<Self, String> {
        let resampler = Fft::new(from as usize, to as usize, BLOCK_FRAMES, 2, FixedSync::Output)
            .map_err(|error| error.to_string())?;
        Ok(Self {
            input: vec![0.0; resampler.input_frames_max() * 2],
            output: vec![0.0; BLOCK_FRAMES * 2],
            played: BLOCK_FRAMES * 2,
            resampler,
        })
    }

    fn render(&mut self, mut out: &mut [f32], mut mix: impl FnMut(&mut [f32])) {
        while !out.is_empty() {
            if self.played == self.output.len() {
                self.resample(&mut mix);
            }
            let count = out.len().min(self.output.len() - self.played);
            let (now, rest) = out.split_at_mut(count);
            now.copy_from_slice(&self.output[self.played..self.played + count]);
            self.played += count;
            out = rest;
        }
    }

    fn resample(&mut self, mix: &mut impl FnMut(&mut [f32])) {
        let frames = self.resampler.input_frames_next();
        mix(&mut self.input[..frames * 2]);
        let resampled = InterleavedSlice::new(&self.input[..], 2, frames)
            .ok()
            .zip(InterleavedSlice::new_mut(&mut self.output[..], 2, BLOCK_FRAMES).ok())
            .and_then(|(input, mut output)| self.resampler.process_into_buffer(&input, &mut output, None).ok());
        if resampled.is_none() {
            self.output.fill(0.0);
        }
        self.played = 0;
    }
}

/// Writes the stereo mix into a device buffer of any sample format and channel count:
/// mono devices get the downmix, extra channels stay silent.
fn write_frames<T>(out: &mut [T], channels: usize, stereo: &mut [f32], mut render: impl FnMut(&mut [f32]))
where
    T: SizedSample + FromSample<f32>,
{
    let channels = channels.max(1);
    let block_frames = stereo.len() / 2;
    for block in out.chunks_mut(block_frames * channels) {
        let mix = &mut stereo[..block.len() / channels * 2];
        render(mix);
        for (frame, &[left, right]) in block.chunks_exact_mut(channels).zip(mix.as_chunks().0) {
            match frame {
                [mono] => *mono = T::from_sample(0.5 * (left + right)),
                [out_left, out_right, rest @ ..] => {
                    *out_left = T::from_sample(left);
                    *out_right = T::from_sample(right);
                    rest.fill(T::EQUILIBRIUM);
                }
                [] => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn half_left_half_right_inverted(mix: &mut [f32]) {
        for (index, sample) in mix.iter_mut().enumerate() {
            *sample = if index % 2 == 0 { 0.5 } else { -0.5 };
        }
    }

    #[test]
    fn a_session_started_during_a_call_still_mixes_at_48_khz() {
        assert_eq!(session_rate(24_000, false), 48_000);
        assert_eq!(session_rate(44_100, true), 48_000);
        assert_eq!(session_rate(44_100, false), 44_100);
    }

    #[test]
    fn an_output_at_another_rate_plays_the_mix_at_its_own_speed() {
        let mut to_device = ToDevice::new(48_000, 16_000).unwrap();
        let mut mixed = 0;
        let mut out = vec![0.0; 16_000 * 2];
        for buffer in out.chunks_mut(441 * 2) {
            to_device.render(buffer, |input| {
                input.fill(0.5);
                mixed += input.len() / 2;
            });
        }
        assert!(mixed.abs_diff(48_000) < BLOCK_FRAMES * 3, "mixed {mixed} frames");
        assert!(out[out.len() - 2..].iter().all(|sample| (sample - 0.5).abs() < 0.01));
    }

    #[test]
    fn stereo_mix_maps_onto_integer_and_multichannel_devices() {
        let mut stereo = vec![0.0; 8];
        let mut quad = [7_i16; 12];
        write_frames(&mut quad, 4, &mut stereo, half_left_half_right_inverted);
        assert_eq!(quad, [16_384, -16_384, 0, 0].repeat(3).as_slice());

        let mut unsigned = [0_u16; 6];
        write_frames(&mut unsigned, 2, &mut stereo, half_left_half_right_inverted);
        assert_eq!(unsigned, [49_152, 16_384].repeat(3).as_slice());
    }

    #[test]
    fn mono_devices_get_the_downmix_across_several_blocks() {
        let mut stereo = vec![0.0; 4];
        let mut mono = [1.0_f32; 5];
        write_frames(&mut mono, 1, &mut stereo, |mix| {
            mix.iter_mut().enumerate().for_each(|(i, s)| *s = i as f32);
        });
        assert_eq!(mono, [0.5, 2.5, 0.5, 2.5, 0.5]);
    }
}
