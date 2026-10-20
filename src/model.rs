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

    pub fn refreshed(self, catalog: &Catalog) -> Option<Item> {
        let Some(id) = self.key.strip_prefix("r2:") else {
            return Some(self);
        };
        let track = catalog.tracks.iter().find(|track| track.id == id)?;
        Some(Item::from_track(catalog, track))
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
#[serde(default)]
pub struct Playback {
    pub source: Source,
    pub item: Option<Item>,
    #[serde(rename = "item_key", skip_serializing)]
    pub legacy_item_key: Option<String>,
}

impl Playback {
    pub fn key(&self) -> Option<&str> {
        self.item
            .as_ref()
            .map(|item| item.key.as_str())
            .or(self.legacy_item_key.as_deref())
    }
}

impl Default for Playback {
    fn default() -> Self {
        Playback {
            source: Source::Tracks,
            item: None,
            legacy_item_key: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Scene {
    pub name: String,
    #[serde(flatten)]
    pub playback: Playback,
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
    #[serde(flatten)]
    pub playback: Playback,
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
            playback: Playback::default(),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn playback_keeps_flat_json_and_reads_legacy_keys() {
        let legacy = serde_json::json!({
            "name": "study",
            "source": { "kind": "tracks" },
            "item_key": "r2:old",
            "levels": {},
            "timer": { "kind": "pomodoro" }
        });
        let scene: Scene = serde_json::from_value(legacy.clone()).unwrap();
        assert_eq!(scene.playback.key(), Some("r2:old"));

        let legacy_session: Session = serde_json::from_value(serde_json::json!({
            "source": { "kind": "tracks" },
            "item_key": "r2:old",
            "position": 12.0
        }))
        .unwrap();
        assert_eq!(legacy_session.playback.key(), Some("r2:old"));
        assert_eq!(legacy_session.volume, Session::default().volume);

        let item = serde_json::json!({
            "key": "yt:queued",
            "title": "Queued",
            "artist": "",
            "duration": 60,
            "cover": null,
            "play": { "kind": "youtube", "url": "https://youtu.be/queued", "live": false }
        });
        let session: Session = serde_json::from_value(serde_json::json!({
            "source": { "kind": "tracks" },
            "item": item.clone(),
            "item_key": "r2:old"
        }))
        .unwrap();
        assert_eq!(session.playback.key(), Some("yt:queued"));
        let encoded = serde_json::to_value(&session).unwrap();
        assert_eq!(encoded["item"], item);
        assert_eq!(encoded["source"], legacy["source"]);
        assert!(encoded.get("playback").is_none());
        assert!(encoded.get("item_key").is_none());

        let fresh = Scene {
            playback: session.playback,
            ..scene
        };
        let encoded = serde_json::to_value(&fresh).unwrap();
        assert_eq!(encoded["item"], item);
        assert!(encoded.get("item_key").is_none());
        assert_eq!(
            serde_json::from_value::<Scene>(encoded).unwrap().playback.key(),
            Some("yt:queued")
        );
        assert_eq!(serde_json::from_str::<Session>("{}").unwrap(), Session::default());
    }
}
