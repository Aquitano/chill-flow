mod ambient;
mod chime;
mod decoder;
mod ffmpeg;
mod mixer;
mod noise;
mod output;
mod spectrum;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};

use rtrb::{Consumer, Producer};

use ambient::{LoadRequest, LoadedLoop};
use decoder::Decoder;
use mixer::{AmbientLane, AtomicF32, Command, Controls, Garbage, LaneLevel, Mixer};
pub use noise::Noise;
use output::Output;
use spectrum::Analysis;

const FALLBACK_RATE: u32 = 48_000;

/// One music stream for ffmpeg to decode: an R2 file, a resolved YouTube audio URL, or an
/// HLS live playlist.
#[derive(Debug, Clone)]
pub struct StreamInput {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub start_secs: f64,
    pub live: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum EngineEvent {
    Ended,
    Failed(String),
    AmbientFailed { id: String, message: String },
    NoDevice(String),
}

pub struct Engine {
    rate: u32,
    cache_dir: PathBuf,
    controls: Arc<Controls>,
    commands: Producer<Command>,
    garbage: Consumer<Garbage>,
    analysis: Analysis,
    events: Sender<EngineEvent>,
    inbox: Receiver<EngineEvent>,
    stream_events: Sender<(u64, EngineEvent)>,
    stream_inbox: Receiver<(u64, EngineEvent)>,
    next_stream: u64,
    loaded: Sender<LoadedLoop>,
    arrivals: Receiver<LoadedLoop>,
    stream: Option<Playing>,
    ambient: HashMap<String, AmbientSlot>,
    _output: Option<Output>,
}

struct Playing {
    id: u64,
    input: StreamInput,
    start_secs: f64,
    decoder: Decoder,
}

/// Where an ambient loop's audio comes from.
#[derive(Debug, Clone, PartialEq)]
pub enum LoopSource {
    File(String),
    Noise(Noise),
}

struct AmbientSlot {
    source: LoopSource,
    level: Arc<LaneLevel>,
}

impl Engine {
    pub fn start(cache_dir: PathBuf) -> Engine {
        let device = output::device_rate();
        let rate = device.as_ref().copied().unwrap_or(FALLBACK_RATE);
        let (mut engine, mixer) = Self::build(cache_dir, rate);
        engine._output = Some(Output::start(mixer, rate, device.map(|_| ()), engine.events.clone()));
        engine
    }

    #[cfg(test)]
    pub fn offline(cache_dir: PathBuf) -> Engine {
        Self::build(cache_dir, FALLBACK_RATE).0
    }

    fn build(cache_dir: PathBuf, rate: u32) -> (Engine, Mixer) {
        let controls = Arc::new(Controls {
            gain: AtomicF32::new(1.0),
            music_gain: AtomicF32::new(1.0),
            paused: AtomicBool::new(true),
        });
        let (mixer, ends) = Mixer::new(rate, Arc::clone(&controls));
        let (events, inbox) = mpsc::channel();
        let (stream_events, stream_inbox) = mpsc::channel();
        let (loaded, arrivals) = mpsc::channel();
        let engine = Engine {
            rate,
            cache_dir,
            controls,
            commands: ends.commands,
            garbage: ends.garbage,
            analysis: Analysis::new(ends.analysis, rate),
            events,
            inbox,
            stream_events,
            stream_inbox,
            next_stream: 0,
            loaded,
            arrivals,
            stream: None,
            ambient: HashMap::new(),
            _output: None,
        };
        (engine, mixer)
    }

    pub fn play_stream(&mut self, input: StreamInput) {
        let start_secs = if input.live { 0.0 } else { input.start_secs.max(0.0) };
        self.start_decoder(input, start_secs);
    }

    pub fn stop_stream(&mut self) {
        self.stream = None;
        self.send(Command::Music(None));
    }

    pub fn seek(&mut self, secs: f64) {
        if let Some(playing) = &self.stream
            && !playing.input.live
        {
            let input = playing.input.clone();
            self.start_decoder(input, secs.max(0.0));
        }
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.controls.paused.store(paused, Ordering::Relaxed);
    }

    pub fn is_paused(&self) -> bool {
        self.controls.paused.load(Ordering::Relaxed)
    }

    pub fn set_volume(&mut self, volume: f32) {
        self.controls.gain.store(perceptual(volume));
    }

    /// The music's own level under the master volume, for balancing it against the ambience.
    pub fn set_music_level(&mut self, level: f32) {
        self.controls.music_gain.store(perceptual(level));
    }

    pub fn set_ambient(&mut self, id: &str, source: LoopSource, level: f32, gain: f32) {
        let target = perceptual(level) * gain.max(0.0);
        if let Some(slot) = self.ambient.get(id)
            && slot.source == source
            && slot.level.set(target)
        {
            return;
        }
        self.stop_ambient(id);
        if target <= 0.0 {
            return;
        }
        let level = Arc::new(LaneLevel::new(target));
        let request = LoadRequest {
            id: id.to_owned(),
            source: source.clone(),
            cache_dir: self.cache_dir.clone(),
            rate: self.rate,
            level: Arc::clone(&level),
        };
        ambient::spawn_load(request, self.loaded.clone(), self.events.clone());
        let slot = AmbientSlot { source, level };
        self.ambient.insert(id.to_owned(), slot);
    }

    pub fn stop_ambient(&mut self, id: &str) {
        if let Some(slot) = self.ambient.remove(id) {
            slot.level.set(0.0);
        }
    }

    pub fn chime(&mut self) {
        self.send(Command::Chime);
    }

    pub fn position(&self) -> f64 {
        self.stream.as_ref().map_or(0.0, |playing| {
            let frames = playing.decoder.state().frames.load(Ordering::Relaxed);
            playing.start_secs + frames as f64 / f64::from(self.rate)
        })
    }

    pub fn is_buffering(&self) -> bool {
        self.stream.as_ref().is_some_and(|playing| {
            let state = playing.decoder.state();
            !self.is_paused() && state.starved.load(Ordering::Relaxed) && !state.finished.load(Ordering::Acquire)
        })
    }

    pub fn spectrum(&mut self, bands: &mut [f32]) {
        self.analysis.fill(bands);
    }

    pub fn poll_events(&mut self) -> Vec<EngineEvent> {
        while self.garbage.pop().is_ok() {}
        while let Ok(LoadedLoop { samples, level }) = self.arrivals.try_recv() {
            self.send(Command::Ambient(AmbientLane::new(samples, level)));
        }
        let current = self.stream.as_ref().map(|playing| playing.id);
        let mut events: Vec<EngineEvent> = self.inbox.try_iter().collect();
        // A replaced decoder can finish or fail just before it notices it was cancelled.
        events.extend(
            self.stream_inbox
                .try_iter()
                .filter(|(id, _)| Some(*id) == current)
                .map(|(_, event)| event),
        );
        events
    }

    fn start_decoder(&mut self, input: StreamInput, start_secs: f64) {
        self.stream = None;
        self.next_stream += 1;
        let id = self.next_stream;
        let events = self.stream_events.clone();
        match Decoder::spawn(&input, start_secs, self.rate, move |event| {
            let _ = events.send((id, event));
        }) {
            Ok((decoder, lane)) => {
                self.send(Command::Music(Some(lane)));
                self.stream = Some(Playing {
                    id,
                    input,
                    start_secs,
                    decoder,
                });
            }
            Err(message) => {
                self.send(Command::Music(None));
                let _ = self.events.send(EngineEvent::Failed(message));
            }
        }
    }

    fn send(&mut self, command: Command) {
        let _ = self.commands.push(command);
    }
}

fn perceptual(level: f32) -> f32 {
    level.clamp(0.0, 1.0).powi(2)
}
