use std::path::PathBuf;

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
    paused: bool,
}

impl Engine {
    pub fn start(_cache_dir: PathBuf) -> Engine {
        Engine { paused: true }
    }

    pub fn play_stream(&mut self, _input: StreamInput) {}

    pub fn stop_stream(&mut self) {}

    pub fn seek(&mut self, _secs: f64) {}

    pub fn set_paused(&mut self, paused: bool) {
        self.paused = paused;
    }

    pub fn is_paused(&self) -> bool {
        self.paused
    }

    pub fn set_volume(&mut self, _volume: f32) {}

    pub fn set_ambient(&mut self, _id: &str, _url: &str, _level: f32, _gain: f32) {}

    pub fn chime(&mut self) {}

    pub fn position(&self) -> f64 {
        0.0
    }

    pub fn is_buffering(&self) -> bool {
        false
    }

    pub fn spectrum(&mut self, bands: &mut [f32]) {
        bands.fill(0.0);
    }

    pub fn poll_events(&mut self) -> Vec<EngineEvent> {
        Vec::new()
    }
}
