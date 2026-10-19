use serde::{Deserialize, Serialize};

use crate::catalog::{Catalog, CatalogTrack, Levels};
use crate::timer::TimerMode;

/// Something the player can put in the queue. `key` is stable across sessions
/// (`r2:<track id>` or `yt:<video id>`) so likes and the resume point survive restarts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Item {
    pub key: String,
    pub title: String,
    pub artist: String,
    pub duration: Option<u32>,
    pub cover: Option<String>,
    pub play: Playable,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Playable {
    File { url: String },
    YouTube { url: String, live: bool },
}

impl Item {
    pub fn from_track(catalog: &Catalog, track: &CatalogTrack) -> Item {
        Item {
            key: format!("r2:{}", track.id),
            title: track.title.clone(),
            artist: track.artist.clone(),
            duration: Some(track.duration_sec),
            cover: track.cover.as_deref().map(|cover| catalog.url(cover)),
            play: Playable::File {
                url: catalog.url(&track.file),
            },
        }
    }

    pub fn is_live(&self) -> bool {
        matches!(self.play, Playable::YouTube { live: true, .. })
    }

    pub fn origin(&self) -> &'static str {
        match self.play {
            Playable::File { .. } => "R2",
            Playable::YouTube { live: true, .. } => "YouTube live",
            Playable::YouTube { live: false, .. } => "YouTube",
        }
    }
}

/// What fills the queue.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Source {
    Tracks,
    Liked,
    Saved {
        id: String,
    },
    /// Ambience on its own, no music.
    Soundscape,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Repeat {
    #[default]
    Off,
    All,
    One,
}

impl Repeat {
    pub fn cycled(self) -> Repeat {
        match self {
            Repeat::Off => Repeat::All,
            Repeat::All => Repeat::One,
            Repeat::One => Repeat::Off,
        }
    }
}

/// A YouTube video, playlist, or live stream that was opened once and kept in the library.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Saved {
    pub id: String,
    pub url: String,
    pub title: String,
    pub channel: String,
    pub items: Vec<Item>,
}

impl Saved {
    pub fn kind_label(&self) -> &'static str {
        match self.items.as_slice() {
            [item] if item.is_live() => "live",
            [_] => "video",
            _ => "playlist",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Scene {
    pub name: String,
    pub source: Source,
    pub item_key: Option<String>,
    pub levels: Levels,
    pub timer: TimerMode,
    #[serde(default = "even")]
    pub balance: f32,
}

/// Music and ambience at their own levels, neither turned down for the other.
pub const EVEN: f32 = 0.5;

fn even() -> f32 {
    EVEN
}

/// Everything restored on the next launch.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Session {
    pub source: Source,
    pub item_key: Option<String>,
    pub position: f64,
    pub volume: f32,
    pub balance: f32,
    pub levels: Levels,
    pub timer: TimerMode,
    pub shuffle: bool,
    pub repeat: Repeat,
}

impl Default for Session {
    fn default() -> Self {
        Session {
            source: Source::Tracks,
            item_key: None,
            position: 0.0,
            volume: 0.7,
            balance: EVEN,
            levels: Levels::new(),
            timer: TimerMode::Pomodoro,
            shuffle: false,
            repeat: Repeat::All,
        }
    }
}
