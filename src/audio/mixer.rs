use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};

use rtrb::{Consumer, Producer, RingBuffer};

use super::chime;

pub(super) const BLOCK_FRAMES: usize = 512;
const MAX_AMBIENT_LANES: usize = 32;
const PAUSE_FADE_SECS: f32 = 0.06;
const SMOOTHING_SECS: f32 = 0.03;
const PRIME_SECS: f32 = 0.25;
const SILENT: f32 = 1e-4;
const LIMITER_KNEE: f32 = 0.9;

pub(super) struct AtomicF32(AtomicU32);

impl AtomicF32 {
    pub(super) fn new(value: f32) -> Self {
        Self(AtomicU32::new(value.to_bits()))
    }

    pub(super) fn load(&self) -> f32 {
        f32::from_bits(self.0.load(Ordering::Relaxed))
    }

    pub(super) fn store(&self, value: f32) {
        self.0.store(value.to_bits(), Ordering::Relaxed);
    }
}

pub(super) struct Controls {
    pub(super) gain: AtomicF32,
    pub(super) music_gain: AtomicF32,
    pub(super) paused: AtomicBool,
}

/// Target gain of an ambient lane. Once the mixer has faded a lane out and dropped it, the
/// value becomes `RETIRED` for good, so the owner knows the lane must be loaded again.
pub(super) struct LaneLevel(AtomicU32);

const RETIRED: u32 = u32::MAX;

impl LaneLevel {
    pub(super) fn new(target: f32) -> Self {
        Self(AtomicU32::new(Self::bits(target)))
    }

    pub(super) fn set(&self, target: f32) -> bool {
        self.0
            .try_update(Ordering::SeqCst, Ordering::SeqCst, |bits| {
                (bits != RETIRED).then_some(Self::bits(target))
            })
            .is_ok()
    }

    /// Silence must be exactly `0` bits (not `-0.0` or NaN) for `try_retire` to match it.
    fn bits(target: f32) -> u32 {
        if target > 0.0 { target.to_bits() } else { 0 }
    }

    pub(super) fn retire(&self) {
        self.0.store(RETIRED, Ordering::SeqCst);
    }

    /// Whether the sound is still turned up, so a load can stop once it's been turned off.
    pub(super) fn wanted(&self) -> bool {
        self.target() > 0.0
    }

    fn target(&self) -> f32 {
        match self.0.load(Ordering::SeqCst) {
            RETIRED => 0.0,
            bits => f32::from_bits(bits),
        }
    }

    fn try_retire(&self) -> bool {
        self.0
            .compare_exchange(0, RETIRED, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }
}

pub(super) struct MusicState {
    pub(super) frames: AtomicU64,
    pub(super) starved: AtomicBool,
    pub(super) finished: AtomicBool,
    pub(super) cancelled: AtomicBool,
}

impl MusicState {
    pub(super) fn new() -> Self {
        Self {
            frames: AtomicU64::new(0),
            starved: AtomicBool::new(true),
            finished: AtomicBool::new(false),
            cancelled: AtomicBool::new(false),
        }
    }
}

pub(super) struct MusicLane {
    samples: Consumer<f32>,
    state: Arc<MusicState>,
    primed: bool,
}

impl MusicLane {
    pub(super) fn new(samples: Consumer<f32>, state: Arc<MusicState>) -> Self {
        Self {
            samples,
            state,
            primed: false,
        }
    }

    fn read_into(&mut self, out: &mut [f32], prime_samples: usize) {
        let available = self.samples.slots() & !1;
        let finished = self.state.finished.load(Ordering::Acquire);
        if !self.primed && (available >= prime_samples || finished) {
            self.primed = true;
        }
        let count = if self.primed { available.min(out.len()) } else { 0 };
        let _ = self.samples.pop_partial_slice(&mut out[..count]);
        self.state.frames.fetch_add((count / 2) as u64, Ordering::Relaxed);
        let starved = count < out.len();
        self.state.starved.store(starved, Ordering::Relaxed);
        if starved && !finished {
            self.primed = false;
        }
    }
}

pub(super) struct AmbientLane {
    samples: Box<[i16]>,
    level: Arc<LaneLevel>,
    position: usize,
    gain: f32,
}

impl AmbientLane {
    pub(super) fn new(samples: Box<[i16]>, level: Arc<LaneLevel>) -> Self {
        Self {
            samples,
            level,
            position: 0,
            gain: 0.0,
        }
    }

    fn mix_into(&mut self, out: &mut [f32], smoothing: f32) {
        let target = self.level.target();
        for [out_left, out_right] in out.as_chunks_mut::<2>().0 {
            self.gain += (target - self.gain) * smoothing;
            let Some(&[left, right]) = self.samples.get(self.position..self.position + 2) else {
                self.position = 0;
                continue;
            };
            let scale = self.gain / 32768.0;
            *out_left += f32::from(left) * scale;
            *out_right += f32::from(right) * scale;
            self.position += 2;
            if self.position >= self.samples.len() {
                self.position = 0;
            }
        }
    }
}

pub(super) enum Command {
    Music(Option<MusicLane>),
    Ambient(AmbientLane),
    Chime,
}

/// Lanes leave the audio callback through this ring so their buffers are freed on the UI
/// thread instead of inside the real-time callback.
#[expect(dead_code, reason = "lanes are carried only to be dropped")]
pub(super) enum Garbage {
    Music(MusicLane),
    Ambient(AmbientLane),
}

pub(super) struct MixerEnds {
    pub(super) commands: Producer<Command>,
    pub(super) garbage: Consumer<Garbage>,
    pub(super) analysis: Consumer<f32>,
}

pub(super) struct Mixer {
    controls: Arc<Controls>,
    commands: Consumer<Command>,
    garbage: Producer<Garbage>,
    analysis: Producer<f32>,
    music: Option<MusicLane>,
    ambient: Vec<AmbientLane>,
    chime: Box<[f32]>,
    chime_position: usize,
    pause_gain: f32,
    pause_step: f32,
    gain: f32,
    music_gain: f32,
    smoothing: f32,
    prime_samples: usize,
    mono: Vec<f32>,
}

impl Mixer {
    pub(super) fn new(rate: u32, controls: Arc<Controls>) -> (Self, MixerEnds) {
        let (commands_in, commands) = RingBuffer::new(256);
        let (garbage, garbage_out) = RingBuffer::new(256);
        let (analysis, analysis_out) = RingBuffer::new(8192);
        let rate_f = rate as f32;
        let chime = chime::synthesize(rate);
        let mixer = Self {
            controls,
            commands,
            garbage,
            analysis,
            music: None,
            ambient: Vec::with_capacity(MAX_AMBIENT_LANES),
            chime_position: chime.len(),
            chime,
            pause_gain: 0.0,
            pause_step: 1.0 / (PAUSE_FADE_SECS * rate_f),
            gain: 0.0,
            music_gain: 1.0,
            smoothing: 1.0 - (-1.0 / (SMOOTHING_SECS * rate_f)).exp(),
            prime_samples: (PRIME_SECS * rate_f) as usize * 2,
            mono: vec![0.0; BLOCK_FRAMES],
        };
        let ends = MixerEnds {
            commands: commands_in,
            garbage: garbage_out,
            analysis: analysis_out,
        };
        (mixer, ends)
    }

    /// Fills interleaved stereo `out`. Runs on the real-time audio thread: no locks, no I/O,
    /// no allocation.
    pub(super) fn render(&mut self, out: &mut [f32]) {
        self.apply_commands();
        for block in out.chunks_mut(BLOCK_FRAMES * 2) {
            self.render_block(block);
        }
    }

    fn apply_commands(&mut self) {
        while let Ok(command) = self.commands.pop() {
            match command {
                Command::Music(lane) => {
                    if let Some(old) = std::mem::replace(&mut self.music, lane) {
                        self.discard(Garbage::Music(old));
                    }
                }
                Command::Ambient(lane) => {
                    if self.ambient.len() == MAX_AMBIENT_LANES {
                        self.retire_silent_lanes();
                    }
                    if self.ambient.len() < MAX_AMBIENT_LANES {
                        self.ambient.push(lane);
                    } else {
                        lane.level.retire();
                        self.discard(Garbage::Ambient(lane));
                    }
                }
                Command::Chime => self.chime_position = 0,
            }
        }
    }

    fn discard(&mut self, garbage: Garbage) {
        let _ = self.garbage.push(garbage);
    }

    fn render_block(&mut self, out: &mut [f32]) {
        out.fill(0.0);
        let paused = self.controls.paused.load(Ordering::Relaxed);
        if !paused || self.pause_gain > 0.0 {
            if let Some(music) = &mut self.music {
                music.read_into(out, self.prime_samples);
                let target = self.controls.music_gain.load();
                for [left, right] in out.as_chunks_mut::<2>().0 {
                    self.music_gain += (target - self.music_gain) * self.smoothing;
                    *left *= self.music_gain;
                    *right *= self.music_gain;
                }
            }
            for lane in &mut self.ambient {
                lane.mix_into(out, self.smoothing);
            }
        }
        self.retire_silent_lanes();

        let pause_target = if paused { 0.0 } else { 1.0 };
        let target_gain = self.controls.gain.load();
        let frames = out.len() / 2;
        for ([out_left, out_right], mono) in out.as_chunks_mut::<2>().0.iter_mut().zip(&mut self.mono[..frames]) {
            self.pause_gain = step_toward(self.pause_gain, pause_target, self.pause_step);
            self.gain += (target_gain - self.gain) * self.smoothing;
            let left = *out_left * self.pause_gain;
            let right = *out_right * self.pause_gain;
            *mono = 0.5 * (left + right);
            let bell = match self.chime.get(self.chime_position) {
                Some(&sample) => {
                    self.chime_position += 1;
                    sample
                }
                None => 0.0,
            };
            *out_left = soft_limit(left * self.gain + bell);
            *out_right = soft_limit(right * self.gain + bell);
        }
        let _ = self.analysis.push_partial_slice(&self.mono[..frames]);
    }

    fn retire_silent_lanes(&mut self) {
        let paused = self.controls.paused.load(Ordering::Relaxed) && self.pause_gain == 0.0;
        let mut index = 0;
        while index < self.ambient.len() {
            let lane = &self.ambient[index];
            if (paused || lane.gain < SILENT) && lane.level.try_retire() {
                let lane = self.ambient.swap_remove(index);
                self.discard(Garbage::Ambient(lane));
            } else {
                index += 1;
            }
        }
    }
}

fn step_toward(value: f32, target: f32, step: f32) -> f32 {
    if value < target {
        (value + step).min(target)
    } else {
        (value - step).max(target)
    }
}

fn soft_limit(sample: f32) -> f32 {
    let magnitude = sample.abs();
    if magnitude <= LIMITER_KNEE {
        return sample;
    }
    let headroom = 1.0 - LIMITER_KNEE;
    sample.signum() * (LIMITER_KNEE + headroom * ((magnitude - LIMITER_KNEE) / headroom).tanh())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn muted_lanes_leave_room_for_new_sounds_while_paused() {
        for played in [false, true] {
            let controls = Arc::new(Controls {
                gain: AtomicF32::new(1.0),
                music_gain: AtomicF32::new(1.0),
                paused: AtomicBool::new(!played),
            });
            let (mut mixer, mut ends) = Mixer::new(48_000, Arc::clone(&controls));
            let levels: Vec<_> = (0..MAX_AMBIENT_LANES).map(|_| Arc::new(LaneLevel::new(0.5))).collect();
            for level in &levels {
                assert!(
                    ends.commands
                        .push(Command::Ambient(AmbientLane::new(
                            vec![16_000; 2].into_boxed_slice(),
                            Arc::clone(level),
                        )))
                        .is_ok()
                );
            }
            let mut out = [0.0; BLOCK_FRAMES * 2];
            mixer.render(&mut out);
            controls.paused.store(true, Ordering::Relaxed);
            for _ in 0..8 {
                mixer.render(&mut out);
            }
            for level in levels {
                assert!(level.set(0.0));
            }
            let replacement = Arc::new(LaneLevel::new(0.5));
            assert!(
                ends.commands
                    .push(Command::Ambient(AmbientLane::new(
                        vec![16_000; 2].into_boxed_slice(),
                        Arc::clone(&replacement),
                    )))
                    .is_ok()
            );
            mixer.render(&mut out);
            assert!(out.iter().all(|sample| *sample == 0.0));
            assert!(replacement.set(0.75));
            controls.paused.store(false, Ordering::Relaxed);
            mixer.render(&mut out);
            assert!(out.iter().any(|sample| *sample > 0.0));
        }
    }
}
