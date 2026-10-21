use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::{Duration, Instant};

use anyhow::Result;
use image::DynamicImage;
use jiff::Timestamp;
use jiff::tz::TimeZone;

use crate::action::{Action, Prompt, Removal, Setting, Tab};
use crate::audio::{Engine, EngineEvent, LoopSource, Noise, StreamInput};
use crate::catalog::{self, AmbientSound, Catalog, Levels, Mix};
use crate::config::{self, Config, Paths};
use crate::media::{MediaCommand, NowPlaying};
use crate::model::{self, Item, Playable, Playback, Saved, Scene, Session, Source};
use crate::queue::Queue;
use crate::store::{FocusDays, Store};
use crate::timer::{Phase, PhaseEnded, Timer, TimerMode};
use crate::tools::Tool;
use crate::youtube;

pub enum Job {
    Catalog {
        url: String,
        result: Result<Catalog>,
    },
    CatalogAdded {
        url: String,
        result: Result<Catalog>,
    },
    Inspected {
        id: u64,
        result: Result<Saved>,
    },
    Resolved {
        generation: u64,
        result: Result<StreamInput>,
    },
    Cover {
        url: String,
        image: Option<DynamicImage>,
    },
    Media(MediaCommand),
    Tools(Vec<(Tool, Option<String>)>),
    /// A worker thread panicked; the panic itself went to crash.log.
    Crashed,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Stream {
    Idle,
    Resolving,
    Playing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    Info,
    Done,
    Error,
}

/// One row of the library list, whatever the tab.
#[derive(Debug, Clone)]
pub struct Row {
    pub title: String,
    pub detail: String,
    pub meta: String,
    pub like_key: Option<String>,
    pub current: bool,
    pub target: Target,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Target {
    Track(usize),
    Liked(usize),
    Saved(usize),
    Mix(usize),
    Scene(usize),
}

/// One unpaused stretch of a focus phase. Each stretch gets its own row, so focus resumed after
/// midnight counts toward the new day.
struct FocusBlock {
    id: i64,
    saved_at: Instant,
    /// How much of the phase earlier stretches already recorded.
    before: Duration,
}

/// A stream that dropped partway through, retried from where it stopped until it plays again.
#[derive(Debug, Clone, Copy)]
struct Reconnect {
    at: f64,
    attempts: usize,
    /// When the next attempt starts, or `None` while one is running.
    due: Option<Instant>,
    /// The playback the attempts belong to. Anything the user starts moves past it.
    generation: u64,
    /// The last attempt connected and ended at once, which a file that ends there does every time.
    ended_empty: bool,
}

/// Seconds between attempts to reach a dropped stream, about two minutes in all.
const RECONNECT_DELAYS: [u64; 8] = [0, 2, 4, 8, 15, 30, 30, 30];

enum InspectionPurpose {
    Open { url: String, choices: u64 },
    Refresh { id: String },
}

impl InspectionPurpose {
    fn progress(&self) -> &'static str {
        match self {
            Self::Open { .. } => LOOKING_UP,
            Self::Refresh { .. } => "Refreshing that playlist…",
        }
    }
}

struct Inspection {
    id: u64,
    purpose: InspectionPurpose,
    _lookup: youtube::Lookup,
}

pub struct App {
    pub config: Config,
    cache_dir: PathBuf,
    config_file: PathBuf,
    store: Store,
    /// Every catalog in use, main first, as last loaded. `catalog` is their merge.
    catalogs: Vec<(String, Catalog)>,
    /// Catalogs asked for with "Add a catalog" whose first fetch hasn't come back.
    adding: Vec<String>,
    pub catalog: Catalog,
    pub engine: Engine,
    pub queue: Queue,
    pub source: Source,
    pub saved: Vec<Saved>,
    pub likes: Vec<Item>,
    pub mixes: Vec<Mix>,
    pub scenes: Vec<Scene>,
    pub levels: Levels,
    pub mix_name: Option<String>,
    pub volume: f32,
    /// 0 favors the music, 1 the ambience, and 0.5 leaves both at their own levels.
    pub balance: f32,
    pub timer: Timer,
    pub focus_days: FocusDays,
    focus_block: Option<FocusBlock>,
    timer_follows_play: bool,
    pub stream: Stream,
    generation: u64,
    /// Counts playback changes the user asked for, unlike `generation`, which also moves when a
    /// track ends on its own.
    choices: u64,
    failures_in_a_row: u32,
    reconnecting: Option<Reconnect>,
    /// Where the current stream started, so `position` minus this is how much of it has played.
    stream_from: f64,
    resume_at: Option<f64>,
    pending_seek: Option<(f64, Instant)>,
    pending_resolve: Option<(String, f64, Instant)>,
    next_inspection: u64,
    inspection: Option<Inspection>,
    resolution: Option<youtube::Lookup>,
    cover_requested: Option<String>,
    pub jobs: Sender<Job>,
    inbox: Receiver<Job>,
    pub events: Vec<Event>,
    pub covers: Vec<(String, DynamicImage)>,
    pub filter: String,
    pub tab: Tab,
    zone: TimeZone,
    session_saved_at: Instant,
    ticked_at: Instant,
    pub quit: bool,
}

const LOOKING_UP: &str = "Looking up that link…";

/// Things the UI should react to (toasts, glows, transitions), drained once per frame.
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Toast(Tone, String),
    DismissToast(&'static str),
    TrackChanged,
    PhaseChanged,
    Liked,
}

impl App {
    pub fn new(config: Config, paths: Paths, store: Store, engine: Engine) -> App {
        let Paths {
            config_file,
            cache: cache_dir,
            ..
        } = paths;
        let (jobs, inbox) = mpsc::channel();
        let session = store.session();
        let catalogs: Vec<(String, Catalog)> = std::iter::once(&config.catalog_url)
            .chain(&config.catalogs)
            .enumerate()
            .map(|(index, url)| (url.clone(), catalog::offline(&cache_dir, url, index == 0)))
            .collect();
        let catalog = with_noise(catalog::merge(&catalogs));
        let zone = TimeZone::system();
        let mut app = App {
            timer: Timer::new(session.timer, config.pomodoro),
            focus_days: store.focus_days(7, &zone).unwrap_or(FocusDays { days: Vec::new() }),
            saved: store.saved().unwrap_or_default(),
            likes: Vec::new(),
            scenes: store.scenes().unwrap_or_default(),
            mixes: Vec::new(),
            config,
            cache_dir,
            config_file,
            store,
            catalogs,
            adding: Vec::new(),
            catalog,
            engine,
            queue: Queue::new(session.shuffle, session.repeat),
            source: session.playback.source.clone(),
            levels: Levels::new(),
            mix_name: None,
            volume: session.volume.clamp(0.0, 1.0),
            balance: model::EVEN,
            focus_block: None,
            timer_follows_play: true,
            stream: Stream::Idle,
            generation: 0,
            choices: 0,
            failures_in_a_row: 0,
            reconnecting: None,
            stream_from: 0.0,
            resume_at: (session.position > 1.0).then_some(session.position),
            pending_seek: None,
            pending_resolve: None,
            next_inspection: 0,
            inspection: None,
            resolution: None,
            cover_requested: None,
            jobs,
            inbox,
            events: Vec::new(),
            covers: Vec::new(),
            filter: String::new(),
            tab: Tab::Tracks,
            zone,
            session_saved_at: Instant::now(),
            ticked_at: Instant::now(),
            quit: false,
        };
        app.refresh_mixes();
        app.load_likes();
        app.engine.set_volume(app.volume);
        app.set_balance(session.balance);
        app.apply_levels(&session.levels);
        app.mix_name = app.matching_mix_name();
        app.restore_playback(&session.playback);
        app.fetch_catalogs();
        app
    }

    /// `chill <url>` or `chill <scene>`: start that instead of the paused resume.
    pub fn launch(&mut self, target: &str) {
        if youtube::looks_like_url(target) {
            self.open_url(target.trim());
        } else if let Some(index) = self
            .scenes
            .iter()
            .position(|scene| scene.name.eq_ignore_ascii_case(target))
        {
            self.load_scene(index);
        } else {
            self.toast(Tone::Error, format!("No scene called \"{target}\""));
        }
    }

    /// A missing ffmpeg would otherwise only show up as an error on the first play.
    pub fn check_tools(&self) {
        let jobs = self.jobs.clone();
        std::thread::spawn(move || {
            let found = Tool::ALL.into_iter().map(|tool| (tool, tool.version())).collect();
            let _ = jobs.send(Job::Tools(found));
        });
    }

    fn tools_checked(&mut self, found: Vec<(Tool, Option<String>)>) {
        let today = Timestamp::now().to_zoned(self.zone.clone()).date();
        let has_yt_dlp = found
            .iter()
            .any(|(tool, version)| *tool == Tool::YtDlp && version.is_some());
        for (tool, version) in found {
            match (tool, version) {
                (Tool::Ffmpeg, None) => self.toast(
                    Tone::Error,
                    "ffmpeg is missing, so nothing can play. Run chill doctor to see how to install it.",
                ),
                (Tool::YtDlp, None) => self.toast(
                    Tone::Info,
                    "yt-dlp is missing, so YouTube links won't open. Run chill doctor for details.",
                ),
                (Tool::Deno, None) if has_yt_dlp => self.toast(
                    Tone::Info,
                    "deno is missing, so some YouTube links may fail. Run chill doctor for details.",
                ),
                (tool, Some(version)) => {
                    if let Some(days) = tool.stale_days(&version, today) {
                        self.toast(
                            Tone::Info,
                            format!(
                                "yt-dlp is {days} days old and may fail on YouTube links. Update it with {}.",
                                tool.upgrade()
                            ),
                        );
                    }
                }
                _ => {}
            }
        }
    }

    fn fetch_catalogs(&self) {
        for (url, _) in &self.catalogs {
            let jobs = self.jobs.clone();
            let (cache, url) = (self.cache_dir.clone(), url.clone());
            std::thread::spawn(move || {
                let result = catalog::fetch(&cache, &url);
                let _ = jobs.send(Job::Catalog { url, result });
            });
        }
    }

    /// Whether tracks come from more than one catalog, so rows say which one.
    pub fn has_added_catalogs(&self) -> bool {
        self.catalogs.len() > 1
    }

    /// The catalogs added on top of the main one, with the names their tracks show.
    pub fn added_catalogs(&self) -> impl Iterator<Item = (&str, String)> {
        self.catalogs
            .iter()
            .skip(1)
            .map(|(url, catalog)| (url.as_str(), catalog::label(catalog, url)))
    }

    fn add_catalog(&mut self, url: &str) {
        if self.catalogs.iter().any(|(known, _)| known == url) || self.adding.iter().any(|known| known == url) {
            self.toast(Tone::Info, "That catalog is already added");
            return;
        }
        self.adding.push(url.to_string());
        self.toast(Tone::Info, "Loading the catalog…");
        let jobs = self.jobs.clone();
        let (cache, url) = (self.cache_dir.clone(), url.to_string());
        std::thread::spawn(move || {
            let result = catalog::fetch(&cache, &url);
            let _ = jobs.send(Job::CatalogAdded { url, result });
        });
    }

    fn remove_catalog(&mut self, url: &str) {
        self.config.catalogs.retain(|known| known != url);
        self.catalogs
            .retain(|(known, _)| known != url || known == &self.config.catalog_url);
        catalog::forget(&self.cache_dir, url);
        self.save_config();
        self.merge_catalogs();
    }

    fn merge_catalogs(&mut self) {
        let previous = self.items_for(&self.source);
        self.catalog = with_noise(catalog::merge(&self.catalogs));
        self.refresh_mixes();
        self.load_likes();
        self.refresh_ambience();
        self.mix_name = self.matching_mix_name();
        self.reconcile_queue(&previous);
    }

    pub fn toast(&mut self, tone: Tone, message: impl Into<String>) {
        self.events.push(Event::Toast(tone, message.into()));
    }

    pub fn is_playing(&self) -> bool {
        !self.engine.is_paused()
    }

    pub fn current(&self) -> Option<&Item> {
        match self.source {
            Source::Soundscape => None,
            _ => self.queue.current(),
        }
    }

    pub fn now_playing(&self) -> Option<NowPlaying<'_>> {
        match (self.current(), &self.source) {
            (Some(item), _) => Some(NowPlaying {
                title: &item.title,
                artist: &item.artist,
                album: item.origin(),
                cover: item.cover.as_deref(),
                duration: item.duration,
            }),
            (None, Source::Soundscape) if !self.levels.is_empty() => Some(NowPlaying {
                title: self.mix_name.as_deref().unwrap_or("Ambience"),
                artist: "chill",
                album: "Soundscape",
                cover: None,
                duration: None,
            }),
            (None, _) => None,
        }
    }

    pub fn position(&self) -> f64 {
        match (&self.stream, self.pending_seek) {
            (Stream::Playing, Some((at, _))) => at,
            (Stream::Playing, None) => self.engine.position(),
            _ => self.resume_at.unwrap_or(0.0),
        }
    }

    pub fn is_liked(&self, key: &str) -> bool {
        self.likes.iter().any(|item| item.key == key)
    }

    pub fn source_label(&self) -> String {
        match (&self.source, &self.mix_name) {
            (Source::Soundscape, Some(mix)) => mix.clone(),
            (source, _) => self.source_name(source),
        }
    }

    fn source_name(&self, source: &Source) -> String {
        match source {
            Source::Tracks => "Tracks".into(),
            Source::Liked => "Liked".into(),
            Source::Saved { id } => self
                .saved
                .iter()
                .find(|saved| &saved.id == id)
                .map_or_else(|| "YouTube".into(), |saved| saved.title.clone()),
            Source::Soundscape => "Ambience only".into(),
        }
    }

    pub fn sound_labels(&self, levels: &Levels) -> Vec<&str> {
        levels
            .keys()
            .filter_map(|id| self.catalog.sound(id).map(|sound| sound.label.as_str()))
            .collect()
    }

    pub fn rows(&self, tab: Tab) -> Vec<Row> {
        let duration = |seconds: Option<u32>| seconds.map(format_clock).unwrap_or_default();
        let playing = self.current().map(|item| item.key.as_str());
        let rows: Vec<Row> = match tab {
            Tab::Tracks => self
                .catalog
                .tracks
                .iter()
                .enumerate()
                .map(|(index, track)| Row {
                    title: track.title.clone(),
                    detail: match &track.catalog {
                        Some(catalog) if self.has_added_catalogs() => format!("{} · {catalog}", track.artist),
                        _ => track.artist.clone(),
                    },
                    meta: duration(Some(track.duration_sec)),
                    current: playing.and_then(|key| key.strip_prefix("r2:")) == Some(&track.id),
                    like_key: Some(format!("r2:{}", track.id)),
                    target: Target::Track(index),
                })
                .collect(),
            Tab::Liked => self
                .likes
                .iter()
                .enumerate()
                .map(|(index, item)| Row {
                    title: item.title.clone(),
                    detail: item.artist.clone(),
                    meta: if item.is_live() {
                        "live".into()
                    } else {
                        duration(item.duration)
                    },
                    current: playing == Some(&item.key),
                    like_key: Some(item.key.clone()),
                    target: Target::Liked(index),
                })
                .collect(),
            Tab::YouTube => self
                .saved
                .iter()
                .enumerate()
                .map(|(index, saved)| Row {
                    title: saved.title.clone(),
                    detail: saved.channel.clone(),
                    meta: match saved.kind_label() {
                        "playlist" => format!("{} videos", saved.items.len()),
                        "video" => duration(saved.items.first().and_then(|item| item.duration)),
                        other => other.into(),
                    },
                    current: matches!(&self.source, Source::Saved { id } if id == &saved.id),
                    like_key: (saved.items.len() == 1).then(|| saved.items[0].key.clone()),
                    target: Target::Saved(index),
                })
                .collect(),
            Tab::Sounds => self
                .mixes
                .iter()
                .enumerate()
                .map(|(index, mix)| Row {
                    title: mix.name.clone(),
                    detail: self.sound_labels(&mix.levels).join(" · "),
                    meta: if mix.id.starts_with("saved:") {
                        "yours".into()
                    } else {
                        String::new()
                    },
                    current: !self.levels.is_empty() && self.mix_name.as_ref() == Some(&mix.name),
                    like_key: None,
                    target: Target::Mix(index),
                })
                .collect(),
            Tab::Scenes => self
                .scenes
                .iter()
                .enumerate()
                .map(|(index, scene)| Row {
                    title: scene.name.clone(),
                    detail: self.describe_scene(scene),
                    meta: scene.timer.label(),
                    current: false,
                    like_key: None,
                    target: Target::Scene(index),
                })
                .collect(),
        };
        let needle = self.filter.to_lowercase();
        if needle.is_empty() {
            return rows;
        }
        rows.into_iter()
            .filter(|row| format!("{} {}", row.title, row.detail).to_lowercase().contains(&needle))
            .collect()
    }

    fn describe_scene(&self, scene: &Scene) -> String {
        let source = self.source_name(&scene.playback.source);
        let sounds = self.sound_labels(&scene.levels);
        if sounds.is_empty() {
            source
        } else {
            format!("{source} + {}", sounds.join(", "))
        }
    }

    fn items_for(&self, source: &Source) -> Vec<Item> {
        match source {
            Source::Tracks => self
                .catalog
                .tracks
                .iter()
                .map(|track| Item::from_track(&self.catalog, track))
                .collect(),
            Source::Liked => self
                .likes
                .iter()
                .cloned()
                .filter_map(|item| item.refreshed(&self.catalog))
                .collect(),
            Source::Saved { id } => self
                .saved
                .iter()
                .find(|saved| &saved.id == id)
                .map(|saved| saved.items.clone())
                .unwrap_or_default(),
            Source::Soundscape => Vec::new(),
        }
    }

    fn load_likes(&mut self) {
        let likes = self.store.likes().unwrap_or_default();
        self.likes = likes
            .into_iter()
            .map(|item| item.clone().refreshed(&self.catalog).unwrap_or(item))
            .collect();
    }

    fn fill_queue(&mut self, source: &Source, start_key: Option<&str>) {
        let items = self.items_for(source);
        self.set_queue(source, items, start_key);
    }

    fn restore_playback(&mut self, playback: &Playback) {
        let mut items = self.items_for(&playback.source);
        let current = playback.item.clone().or_else(|| {
            let key = playback.key()?;
            if let Some(id) = key.strip_prefix("r2:") {
                return self
                    .catalog
                    .tracks
                    .iter()
                    .find(|track| track.id == id)
                    .map(|track| Item::from_track(&self.catalog, track));
            }
            items
                .iter()
                .chain(&self.likes)
                .chain(self.saved.iter().flat_map(|saved| &saved.items))
                .find(|item| item.key == key)
                .cloned()
        });
        let current = current
            .filter(|_| playback.source != Source::Soundscape)
            .and_then(|item| item.refreshed(&self.catalog));
        let key = current.as_ref().map(|item| item.key.clone());
        if let Some(item) = current
            && !items.iter().any(|other| other.key == item.key)
        {
            items.insert(0, item);
        }
        self.set_queue(&playback.source, items, key.as_deref());
        if self.current().map(|item| item.key.as_str()) != playback.key() {
            self.resume_at = None;
        }
    }

    fn reconcile_queue(&mut self, previous_source: &[Item]) {
        let previous = self.current().cloned();
        let position = self.position();
        let next_source = self.items_for(&self.source);
        let catalog = &self.catalog;
        let changed = self
            .queue
            .reconcile(previous_source, next_source, |item| item.refreshed(catalog));
        let current = self.current().cloned();
        if changed {
            self.resume_at = None;
            self.reconnecting = None;
        }
        let input_changed = previous.as_ref().map(|item| &item.play) != current.as_ref().map(|item| &item.play);
        if self.stream != Stream::Idle && (changed || input_changed) {
            match current {
                Some(item) => self.start(item, if changed { 0.0 } else { position }),
                None => self.music_ended(),
            }
        } else if current != previous {
            self.events.push(Event::TrackChanged);
            self.load_cover();
        }
    }

    fn set_queue(&mut self, source: &Source, items: Vec<Item>, start_key: Option<&str>) {
        self.source = source.clone();
        self.refresh_ambience();
        self.queue.replace(items, start_key);
        self.events.push(Event::TrackChanged);
        self.load_cover();
    }

    fn play_source(&mut self, source: Source, start_key: Option<&str>) {
        self.fill_queue(&source, start_key);
        self.play_queue();
    }

    fn play_queue(&mut self) {
        self.choices += 1;
        self.resume_at = None;
        self.failures_in_a_row = 0;
        match self.queue.current().cloned() {
            Some(item) => self.start(item, 0.0),
            None => self.stop_stream(),
        }
        self.resume();
    }

    fn start(&mut self, item: Item, start_secs: f64) {
        self.generation += 1;
        self.stream_from = start_secs;
        self.resolution = None;
        self.pending_seek = None;
        self.pending_resolve = None;
        self.resume_at = (start_secs > 0.0).then_some(start_secs);
        self.events.push(Event::TrackChanged);
        self.load_cover();
        match item.play {
            Playable::File { url } => {
                self.engine.play_stream(StreamInput {
                    url,
                    headers: Vec::new(),
                    start_secs,
                    live: false,
                });
                self.stream = Stream::Playing;
                self.resume_at = None;
            }
            Playable::YouTube { url, .. } => {
                self.engine.stop_stream();
                self.stream = Stream::Resolving;
                self.pending_resolve = Some((url, start_secs, Instant::now()));
            }
        }
    }

    fn stop_stream(&mut self) {
        self.generation += 1;
        self.resolution = None;
        self.pending_seek = None;
        self.pending_resolve = None;
        self.engine.stop_stream();
        self.stream = Stream::Idle;
    }

    /// The queue ran out or gave up. Without ambience nothing is audible any more, so show it
    /// as paused; the timer keeps running either way.
    fn music_ended(&mut self) {
        self.stop_stream();
        if self.levels.is_empty() {
            self.engine.set_paused(true);
        }
    }

    fn enter_soundscape(&mut self) {
        self.choices += 1;
        self.stop_stream();
        self.queue.replace(Vec::new(), None);
        self.source = Source::Soundscape;
        self.refresh_ambience();
        self.events.push(Event::TrackChanged);
        self.resume();
    }

    fn load_cover(&mut self) {
        let Some(url) = self.current().and_then(|item| item.cover.clone()) else {
            return;
        };
        if self.cover_requested.as_ref() == Some(&url) {
            return;
        }
        self.cover_requested = Some(url.clone());
        let jobs = self.jobs.clone();
        std::thread::spawn(move || {
            let image = fetch_cover(&url);
            let _ = jobs.send(Job::Cover { url, image });
        });
    }

    /// Play starts the timer too, unless the user paused it on its own mid-phase.
    fn resume(&mut self) {
        self.engine.set_paused(false);
        if self.timer_follows_play || self.timer.elapsed(Instant::now()).is_zero() {
            self.set_timer_running(true);
        }
    }

    fn toggle_play(&mut self) {
        if self.is_playing() {
            self.timer_follows_play = self.timer.is_running();
            self.engine.set_paused(true);
            self.set_timer_running(false);
            return;
        }
        if self.stream == Stream::Idle
            && let Some(item) = self.current().cloned()
        {
            let at = self.resume_at.unwrap_or(0.0);
            self.failures_in_a_row = 0;
            self.start(item, at);
        }
        self.resume();
    }

    fn set_timer_running(&mut self, running: bool) {
        self.set_timer_running_at(running, Instant::now());
    }

    fn set_timer_running_at(&mut self, running: bool, now: Instant) {
        if running {
            self.timer.start(now);
            self.track_focus(now);
        } else {
            self.timer.pause(now);
            self.save_focus_block(now);
            self.focus_block = None;
        }
    }

    fn skip(&mut self, forward: bool) {
        self.failures_in_a_row = 0;
        if !forward && self.position() > 3.0 && self.current().is_some_and(|item| !item.is_live()) {
            if self.stream == Stream::Playing {
                self.pending_seek = None;
                self.engine.seek(0.0);
                self.stream_from = 0.0;
                return;
            }
            if self
                .reconnecting
                .is_some_and(|reconnect| reconnect.due.is_some() && reconnect.generation == self.generation)
            {
                return self.seek_to(0.0);
            }
        }
        self.choices += 1;
        let next = if forward {
            self.queue.next()
        } else {
            self.queue.previous()
        };
        match next.cloned() {
            Some(item) => self.start(item, 0.0),
            None => {
                self.music_ended();
                self.toast(Tone::Info, "End of the queue");
            }
        }
    }

    pub fn dispatch(&mut self, action: Action) {
        match action {
            Action::TogglePlay => self.toggle_play(),
            Action::Next => self.skip(true),
            Action::Previous => self.skip(false),
            Action::SeekBy(delta) => self.seek_to(self.position() + delta),
            Action::SeekTo(seconds) => self.seek_to(seconds),
            Action::VolumeBy(delta) => self.set_volume(self.volume + delta),
            Action::SetVolume(volume) => self.set_volume(volume),
            Action::SetBalance(balance) => self.set_balance(balance),
            Action::BalanceBy(delta) => self.set_balance(((self.balance + delta) * 10.0).round() / 10.0),
            Action::ToggleShuffle => {
                self.queue.set_shuffle(!self.queue.shuffle);
            }
            Action::CycleRepeat => {
                self.queue.repeat = self.queue.repeat.cycled();
            }
            Action::ToggleLikeCurrent => {
                if let Some(item) = self.current().cloned() {
                    self.toggle_like(item);
                }
            }
            Action::ToggleLikeRow(index) => {
                if let Some(item) = self.row_item(index) {
                    self.toggle_like(item);
                }
            }
            Action::Activate(index) => self.activate(index),
            Action::Enqueue(index) => self.enqueue(index),
            Action::RefreshSaved(id) => self.refresh_saved(&id),
            Action::Remove(removal) => self.remove(removal),
            Action::JumpQueue(offset) => {
                if let Some(item) = self.queue.jump(offset).cloned() {
                    self.choices += 1;
                    self.failures_in_a_row = 0;
                    self.start(item, 0.0);
                    self.resume();
                }
            }
            Action::RemoveQueued(offset) => self.queue.remove_upcoming(offset),
            Action::MoveQueued(offset, delta) => {
                self.queue.move_upcoming(offset, delta);
            }
            Action::TimerToggle => {
                let running = !self.timer.is_running();
                self.timer_follows_play = running;
                self.set_timer_running(running);
            }
            Action::TimerReset => {
                self.save_focus_block(Instant::now());
                self.focus_block = None;
                self.timer.reset();
                self.timer_follows_play = true;
            }
            Action::TimerSkip => {
                let now = Instant::now();
                self.save_focus_block(now);
                self.focus_block = None;
                let ended = self.timer.skip(now);
                self.on_phase_ended(ended, false);
            }
            Action::SetTimerMode(mode) => self.set_timer_mode(mode),
            Action::CycleTimerMode => {
                let presets = TimerMode::PRESETS;
                let index = presets
                    .iter()
                    .position(|mode| *mode == self.timer.mode())
                    .map_or(0, |i| i + 1);
                self.set_timer_mode(presets[index % presets.len()]);
            }
            Action::SetLevel(id, level) => {
                self.set_level(&id, level);
                self.mix_name = self.matching_mix_name();
            }
            Action::LevelBy(id, delta) => {
                let level = self.levels.get(&id).copied().unwrap_or(0);
                self.set_level(&id, (i16::from(level) + delta).clamp(0, 100) as u8);
                self.mix_name = self.matching_mix_name();
            }
            Action::ApplyMix(index) => self.apply_mix(index),
            Action::PlaySoundscape(index) => {
                self.apply_mix(index);
                self.enter_soundscape();
            }
            Action::CycleMix(step) => {
                if self.mixes.is_empty() {
                    return;
                }
                let current = self
                    .mixes
                    .iter()
                    .position(|mix| Some(&mix.name) == self.mix_name.as_ref());
                let count = self.mixes.len() as isize;
                let next = current.map_or(0, |index| (index as isize + step).rem_euclid(count) as usize);
                self.apply_mix(next);
            }
            Action::AmbienceOff => {
                self.apply_levels(&Levels::new());
                self.mix_name = None;
            }
            Action::LoadScene(index) => self.load_scene(index),
            Action::Submit(prompt, text) => self.submit(prompt, text.trim()),
            Action::AdjustSetting(setting, delta) => self.adjust_setting(setting, delta),
            Action::Quit => self.quit = true,
            Action::ShowTab(_)
            | Action::RemoveRow(_)
            | Action::Focus(_)
            | Action::OpenPrompt(_)
            | Action::OpenPalette
            | Action::OpenHelp
            | Action::OpenStats
            | Action::OpenSettings => {}
        }
    }

    fn seek_to(&mut self, seconds: f64) {
        let Some(item) = self.current() else { return };
        if item.is_live() {
            return;
        }
        let end = item.duration.map_or(f64::MAX, |duration| f64::from(duration) - 1.0);
        let seconds = seconds.clamp(0.0, end.max(0.0));
        match self.stream {
            Stream::Playing => self.pending_seek = Some((seconds, Instant::now())),
            _ => self.resume_at = Some(seconds),
        }
        // A seek takes a waiting reconnect along, and once playing again, starts a later drop afresh.
        match &mut self.reconnecting {
            Some(reconnect) if reconnect.due.is_some() => {
                reconnect.at = seconds;
                reconnect.ended_empty = false;
            }
            _ => self.reconnecting = None,
        }
    }

    fn set_volume(&mut self, volume: f32) {
        self.volume = volume.clamp(0.0, 1.0);
        self.engine.set_volume(self.volume);
    }

    fn set_balance(&mut self, balance: f32) {
        // The middle snaps so a dragged slider can find it.
        let balance = balance.clamp(0.0, 1.0);
        self.balance = if (balance - model::EVEN).abs() < 0.03 {
            model::EVEN
        } else {
            balance
        };
        self.engine.set_music_level((2.0 * (1.0 - self.balance)).min(1.0));
        self.refresh_ambience();
    }

    /// Soundscapes have no music to balance against, so they keep the ambience at its levels.
    /// The floor is inaudible but keeps the sounds loaded, since a silent lane is dropped and
    /// would have to be decoded again.
    fn ambience_share(&self) -> f32 {
        if self.source == Source::Soundscape {
            1.0
        } else {
            (2.0 * self.balance).clamp(0.1, 1.0)
        }
    }

    fn refresh_ambience(&mut self) {
        for (id, level) in self.levels.clone() {
            self.set_level(&id, level);
        }
    }

    fn set_timer_mode(&mut self, mode: TimerMode) {
        let now = Instant::now();
        let was_running = self.timer.is_running();
        self.save_focus_block(now);
        self.focus_block = None;
        self.timer.set_mode(mode, self.config.pomodoro);
        if was_running {
            self.timer.start(now);
            self.track_focus(now);
        }
    }

    fn set_level(&mut self, id: &str, level: u8) {
        let Some(sound) = self.catalog.sound(id) else {
            // A fresh catalog dropped this sound while it played.
            self.engine.stop_ambient(id);
            self.levels.remove(id);
            return;
        };
        let level = level.min(100);
        // Only the entries `with_noise` added have no file; a catalog recording that happens to share
        // a noise id still plays its file.
        let noise = Noise::ALL.into_iter().find(|noise| noise.id() == id);
        let source = match noise.filter(|_| sound.file.is_empty()) {
            Some(noise) => LoopSource::Noise(noise),
            None => LoopSource::File(self.catalog.url(&sound.file)),
        };
        let gain = sound.gain_percent as f32 / 100.0;
        self.engine
            .set_ambient(id, source, f32::from(level) / 100.0 * self.ambience_share(), gain);
        if level == 0 {
            self.levels.remove(id);
        } else {
            self.levels.insert(id.to_string(), level);
        }
    }

    fn apply_levels(&mut self, levels: &Levels) {
        let ids: Vec<String> = self.catalog.ambient.iter().map(|sound| sound.id.clone()).collect();
        for id in ids {
            self.set_level(&id, levels.get(&id).copied().unwrap_or(0));
        }
    }

    fn apply_mix(&mut self, index: usize) {
        let Some(mix) = self.mixes.get(index).cloned() else {
            return;
        };
        self.apply_levels(&mix.levels);
        self.mix_name = Some(mix.name);
    }

    fn matching_mix_name(&self) -> Option<String> {
        self.mixes
            .iter()
            .find(|mix| mix.levels == self.levels)
            .map(|mix| mix.name.clone())
    }

    fn refresh_mixes(&mut self) {
        let known = |mix: &Mix| mix.levels.keys().any(|id| self.catalog.sound(id).is_some());
        let mut mixes: Vec<Mix> = self.catalog.mixes.iter().filter(|mix| known(mix)).cloned().collect();
        mixes.extend(self.store.mixes().unwrap_or_default());
        self.mixes = mixes;
    }

    fn load_scene(&mut self, index: usize) {
        let Some(scene) = self.scenes.get(index).cloned() else {
            return;
        };
        if self.timer.mode() != scene.timer {
            self.set_timer_mode(scene.timer);
        }
        self.set_balance(scene.balance);
        self.apply_levels(&scene.levels);
        self.mix_name = self.matching_mix_name();
        self.timer_follows_play = true;
        if scene.playback.source == Source::Soundscape {
            self.enter_soundscape();
        } else {
            let source_missing = matches!(&scene.playback.source, Source::Saved { id }
                if !self.saved.iter().any(|saved| &saved.id == id));
            if !source_missing {
                self.restore_playback(&scene.playback);
            }
            if source_missing || self.current().is_none() {
                self.enter_soundscape();
                self.toast(
                    Tone::Error,
                    format!("The music in \"{}\" is gone, playing its ambience only", scene.name),
                );
                return;
            }
            self.play_queue();
        }
        self.toast(Tone::Done, format!("Scene \"{}\"", scene.name));
    }

    fn row(&self, index: usize) -> Option<Row> {
        self.rows(self.tab).into_iter().nth(index)
    }

    pub fn row_item(&self, index: usize) -> Option<Item> {
        let row = self.row(index)?;
        match row.target {
            Target::Track(i) => self
                .catalog
                .tracks
                .get(i)
                .map(|track| Item::from_track(&self.catalog, track)),
            Target::Liked(i) => self.likes.get(i).cloned(),
            Target::Saved(i) => self.saved.get(i).and_then(|saved| match saved.items.as_slice() {
                [item] => Some(item.clone()),
                _ => None,
            }),
            Target::Mix(_) | Target::Scene(_) => None,
        }
    }

    fn toggle_like(&mut self, item: Item) {
        let liked = !self.is_liked(&item.key);
        if let Err(error) = self.store.set_liked(&item, liked) {
            self.toast(Tone::Error, format!("Could not save the like: {error}"));
            return;
        }
        self.load_likes();
        if liked {
            self.events.push(Event::Liked);
        }
    }

    fn activate(&mut self, index: usize) {
        let Some(row) = self.row(index) else {
            return;
        };
        match row.target {
            Target::Track(i) => {
                let key = self.catalog.tracks.get(i).map(|track| format!("r2:{}", track.id));
                self.play_source(Source::Tracks, key.as_deref());
            }
            Target::Liked(i) => {
                if let Some(item) = self.playable_like(i) {
                    self.play_source(Source::Liked, Some(&item.key));
                }
            }
            Target::Saved(i) => {
                if let Some(saved) = self.saved.get(i) {
                    let source = Source::Saved { id: saved.id.clone() };
                    let start = youtube::start_key(&saved.url);
                    self.play_source(source, start.as_deref());
                }
            }
            Target::Mix(i) => self.dispatch(Action::PlaySoundscape(i)),
            Target::Scene(i) => self.load_scene(i),
        }
    }

    /// A like the catalog dropped stays listed so it can be removed, but has nothing to play.
    fn playable_like(&mut self, index: usize) -> Option<Item> {
        let like = self.likes.get(index)?.clone();
        let playable = like.clone().refreshed(&self.catalog);
        if playable.is_none() {
            self.toast(Tone::Error, format!("\"{}\" is no longer in the catalog", like.title));
        }
        playable
    }

    fn enqueue(&mut self, index: usize) {
        let Some(row) = self.row(index) else {
            return;
        };
        let items = match row.target {
            Target::Saved(i) => self.saved.get(i).map(|saved| saved.items.clone()).unwrap_or_default(),
            Target::Mix(i) => return self.apply_mix(i),
            Target::Scene(_) => return,
            Target::Liked(i) => self.playable_like(i).into_iter().collect(),
            Target::Track(_) => self.row_item(index).into_iter().collect(),
        };
        if self.source == Source::Soundscape {
            return self.activate(index);
        }
        let message = match items.as_slice() {
            [item] => format!("Queued \"{}\"", item.title),
            _ => format!("Queued {} tracks", items.len()),
        };
        for item in items {
            self.queue.enqueue(item);
        }
        self.toast(Tone::Done, message);
    }

    /// The identity and title behind a library row, for a delete that waits on confirmation.
    pub fn removal(&self, index: usize) -> Option<(Removal, String)> {
        let row = self.row(index)?;
        let removal = match row.target {
            Target::Saved(i) => Removal::Saved(self.saved.get(i)?.id.clone()),
            Target::Liked(i) => Removal::Like(self.likes.get(i)?.key.clone()),
            Target::Mix(i) => {
                let mix = self.mixes.get(i).filter(|mix| mix.id.starts_with("saved:"))?;
                Removal::Mix(mix.name.clone())
            }
            Target::Scene(i) => Removal::Scene(self.scenes.get(i)?.name.clone()),
            Target::Track(_) => return None,
        };
        Some((removal, row.title))
    }

    fn remove(&mut self, removal: Removal) {
        let result = match &removal {
            Removal::Saved(id) => self.store.forget(id),
            Removal::Like(key) => match self.likes.iter().find(|item| &item.key == key) {
                Some(item) => self.store.set_liked(item, false),
                None => Ok(()),
            },
            Removal::Mix(name) => self.store.delete_mix(name),
            Removal::Scene(name) => self.store.delete_scene(name),
            Removal::Catalog(url) => {
                self.remove_catalog(url);
                return;
            }
        };
        match result {
            Ok(()) => self.reload_library(),
            Err(error) => self.toast(Tone::Error, format!("Could not remove it: {error}")),
        }
    }

    fn reload_library(&mut self) {
        self.saved = self.store.saved().unwrap_or_default();
        self.load_likes();
        self.scenes = self.store.scenes().unwrap_or_default();
        self.refresh_mixes();
        self.mix_name = self.matching_mix_name();
    }

    fn submit(&mut self, prompt: Prompt, text: &str) {
        if text.is_empty() {
            return;
        }
        match prompt {
            Prompt::OpenUrl if youtube::looks_like_url(text) => self.open_url(text),
            Prompt::OpenUrl => self.toast(Tone::Error, "That doesn't look like a link"),
            Prompt::AddCatalog if text.starts_with("https://") || text.starts_with("http://") => self.add_catalog(text),
            Prompt::AddCatalog => self.toast(Tone::Error, "A catalog is a link to its catalog.json"),
            Prompt::SaveScene => {
                let scene = Scene {
                    name: text.to_string(),
                    playback: self.playback(),
                    levels: self.levels.clone(),
                    timer: self.timer.mode(),
                    balance: self.balance,
                };
                match self.store.save_scene(&scene) {
                    Ok(()) => {
                        self.reload_library();
                        self.toast(
                            Tone::Done,
                            format!(
                                "Saved \"{text}\". Run chill {}\"{text}\" to start it.",
                                if crate::is_command(text) { "-- " } else { "" }
                            ),
                        );
                    }
                    Err(error) => self.toast(Tone::Error, format!("Could not save the scene: {error}")),
                }
            }
            Prompt::SaveMix => match self.store.save_mix(text, &self.levels) {
                Ok(()) => {
                    self.reload_library();
                    self.toast(Tone::Done, format!("Saved mix \"{text}\""));
                }
                Err(error) => self.toast(Tone::Error, format!("Could not save the mix: {error}")),
            },
        }
    }

    pub fn open_url(&mut self, url: &str) {
        self.choices += 1;
        self.start_inspection(
            url,
            InspectionPurpose::Open {
                url: url.to_string(),
                choices: self.choices,
            },
        );
    }

    fn start_inspection(&mut self, url: &str, purpose: InspectionPurpose) {
        if let Some(previous) = self.inspection.take() {
            self.events.push(Event::DismissToast(previous.purpose.progress()));
        }
        self.toast(Tone::Info, purpose.progress());
        self.next_inspection += 1;
        let (jobs, id) = (self.jobs.clone(), self.next_inspection);
        let lookup = youtube::inspect(url, move |result| {
            let _ = jobs.send(Job::Inspected { id, result });
        });
        self.inspection = Some(Inspection {
            id,
            purpose,
            _lookup: lookup,
        });
    }

    pub fn playlist_for_row(&self, index: usize) -> Option<&Saved> {
        if self.tab != Tab::YouTube {
            return None;
        }
        let Target::Saved(index) = self.row(index)?.target else {
            return None;
        };
        self.saved.get(index).filter(|saved| saved.id.starts_with("ytpl:"))
    }

    fn refresh_saved(&mut self, id: &str) {
        let Some(saved) = self
            .saved
            .iter()
            .find(|saved| saved.id == id && saved.id.starts_with("ytpl:"))
        else {
            return;
        };
        let url = saved.url.clone();
        self.start_inspection(&url, InspectionPurpose::Refresh { id: id.to_string() });
    }

    fn refreshed_playlist(&mut self, id: &str, result: Result<Saved>) {
        let Some(previous) = self.saved.iter().find(|saved| saved.id == id) else {
            return;
        };
        let previous_items =
            matches!(&self.source, Source::Saved { id: active } if active == id).then(|| previous.items.clone());
        let saved = match result {
            Ok(saved) if saved.id == id => saved,
            Ok(_) => return self.toast(Tone::Error, "Could not refresh the playlist: its identity changed"),
            Err(error) => {
                return self.toast(
                    Tone::Error,
                    format!("Could not refresh \"{}\": {error}", previous.title),
                );
            }
        };
        if let Err(error) = self.store.save(&saved) {
            return self.toast(Tone::Error, format!("Could not save the refreshed playlist: {error}"));
        }
        self.reload_library();
        if let Some(previous) = previous_items {
            self.reconcile_queue(&previous);
        }
        self.toast(
            Tone::Done,
            format!("Refreshed \"{}\" · {} tracks", saved.title, saved.items.len()),
        );
    }

    fn inspected(&mut self, url: &str, choices: u64, result: Result<Saved>) {
        let saved = match result {
            Ok(saved) if saved.items.is_empty() => {
                return self.toast(Tone::Error, "That playlist has no playable videos");
            }
            Ok(saved) => saved,
            Err(error) => return self.toast(Tone::Error, format!("Could not open that link. {error}")),
        };
        if let Err(error) = self.store.save(&saved) {
            return self.toast(Tone::Error, format!("Could not save it: {error}"));
        }
        self.reload_library();
        // The user picked something else while yt-dlp was looking; keep that playing.
        if choices == self.choices {
            let source = Source::Saved { id: saved.id };
            self.play_source(source, youtube::start_key(url).as_deref());
        } else {
            self.toast(Tone::Done, format!("Added \"{}\" to YouTube", saved.title));
        }
    }

    fn track_focus(&mut self, now: Instant) {
        if self.timer.phase() != Phase::Focus || !self.timer.is_running() || self.focus_block.is_some() {
            return;
        }
        let planned = self.timer.phase_length().as_secs();
        match self.store.begin_focus_block(Timestamp::now(), planned) {
            Ok(id) => {
                let before = self.timer.elapsed(now);
                self.focus_block = Some(FocusBlock {
                    id,
                    saved_at: now,
                    before,
                });
            }
            Err(error) => self.toast(Tone::Error, format!("Could not record focus time: {error}")),
        }
    }

    fn save_focus_block(&mut self, now: Instant) {
        if self.timer.phase() != Phase::Focus {
            return;
        }
        let Some(block) = self.focus_block.as_mut() else { return };
        block.saved_at = now;
        let (id, focused) = (block.id, self.timer.elapsed(now).saturating_sub(block.before).as_secs());
        if let Err(error) = self.store.update_focus_block(id, focused, false) {
            self.toast(Tone::Error, format!("Could not record focus time: {error}"));
        }
        self.refresh_stats();
    }

    fn refresh_stats(&mut self) {
        if let Ok(days) = self.store.focus_days(7, &self.zone) {
            self.focus_days = days;
        }
    }

    fn on_phase_ended(&mut self, ended: PhaseEnded, natural: bool) {
        if ended.ended == Phase::Focus && natural {
            if let Some(block) = self.focus_block.take() {
                let focused = ended.length.saturating_sub(block.before).as_secs();
                if let Err(error) = self.store.update_focus_block(block.id, focused, true) {
                    self.toast(Tone::Error, format!("Could not record focus time: {error}"));
                }
            }
            self.refresh_stats();
        }
        self.focus_block = None;
        self.events.push(Event::PhaseChanged);
        if !natural {
            self.track_focus(Instant::now());
            return;
        }
        if self.config.chime {
            self.engine.chime();
        }
        let minutes = self.timer.phase_length().as_secs() / 60;
        let (title, body) = match (ended.ended, ended.next) {
            (Phase::Focus, Phase::Focus) => ("Focus block done".to_string(), "Nice work.".to_string()),
            (Phase::Focus, next) => (
                "Focus block done".to_string(),
                format!("Time for a {minutes} minute {}", next.label()),
            ),
            (_, _) => (
                "Break's over".to_string(),
                format!("Next up: {minutes} minutes of focus"),
            ),
        };
        self.toast(Tone::Done, format!("{title} · {body}"));
        if self.config.notifications {
            std::thread::spawn(move || {
                let _ = notify_rust::Notification::new()
                    .summary(&title)
                    .body(&body)
                    .appname("chill")
                    .show();
            });
        }
        self.track_focus(Instant::now());
    }

    pub fn setting_value(&self, setting: Setting) -> String {
        let pomodoro = &self.config.pomodoro;
        let toggle = |on: bool| if on { "on" } else { "off" }.to_string();
        match setting {
            Setting::FocusMinutes => format!("{} min", pomodoro.focus_minutes),
            Setting::BreakMinutes => format!("{} min", pomodoro.break_minutes),
            Setting::LongBreakMinutes => format!("{} min", pomodoro.long_break_minutes),
            Setting::LongBreakEvery => format!("{} blocks", pomodoro.long_break_every),
            Setting::AutoStartBreaks => toggle(pomodoro.auto_start_breaks),
            Setting::AutoStartFocus => toggle(pomodoro.auto_start_focus),
            Setting::Chime => toggle(self.config.chime),
            Setting::Notifications => toggle(self.config.notifications),
            Setting::ReduceMotion => toggle(self.config.reduce_motion),
        }
    }

    /// Steps a number by `delta` or flips a toggle, applies it, and writes config.toml.
    fn adjust_setting(&mut self, setting: Setting, delta: i8) {
        let step = |value: u32, by: i32, min: u32, max: u32| {
            value
                .clamp(min, max)
                .saturating_add_signed(by * i32::from(delta.signum()))
                .clamp(min, max)
        };
        let pomodoro = &mut self.config.pomodoro;
        match setting {
            Setting::FocusMinutes => pomodoro.focus_minutes = step(pomodoro.focus_minutes, 5, 5, 180),
            Setting::BreakMinutes => pomodoro.break_minutes = step(pomodoro.break_minutes, 1, 1, 60),
            Setting::LongBreakMinutes => pomodoro.long_break_minutes = step(pomodoro.long_break_minutes, 5, 5, 90),
            Setting::LongBreakEvery => pomodoro.long_break_every = step(pomodoro.long_break_every, 1, 2, 8),
            Setting::AutoStartBreaks => pomodoro.auto_start_breaks = !pomodoro.auto_start_breaks,
            Setting::AutoStartFocus => pomodoro.auto_start_focus = !pomodoro.auto_start_focus,
            Setting::Chime => self.config.chime = !self.config.chime,
            Setting::Notifications => self.config.notifications = !self.config.notifications,
            Setting::ReduceMotion => self.config.reduce_motion = !self.config.reduce_motion,
        }
        self.timer.set_settings(self.config.pomodoro);
        self.save_config();
    }

    fn save_config(&mut self) {
        if let Err(error) = config::save(&self.config_file, &self.config) {
            self.toast(Tone::Error, format!("Could not save settings: {error}"));
        }
    }

    pub fn config_file(&self) -> &std::path::Path {
        &self.config_file
    }

    pub fn session(&self) -> Session {
        Session {
            playback: self.playback(),
            position: if self.current().is_some_and(Item::is_live) {
                0.0
            } else {
                self.position()
            },
            volume: self.volume,
            balance: self.balance,
            levels: self.levels.clone(),
            timer: self.timer.mode(),
            shuffle: self.queue.shuffle,
            repeat: self.queue.repeat,
        }
    }

    fn playback(&self) -> Playback {
        Playback {
            source: self.source.clone(),
            item: self.current().cloned(),
            legacy_item_key: None,
        }
    }

    pub fn shutdown(&mut self) {
        self.inspection = None;
        self.resolution = None;
        self.pending_resolve = None;
        self.save_focus_block(Instant::now());
        let _ = self.store.save_session(&self.session());
    }

    /// Everything that happens without input: finished jobs, audio events, the timer.
    pub fn tick(&mut self, now: Instant) {
        // The loop ticks several times a second, so a long gap means the machine slept. Windows
        // keeps `Instant` running through sleep while macOS doesn't, so the timer pauses over the
        // gap itself, which also starts a new focus row on the day it woke up.
        if now.saturating_duration_since(self.ticked_at) >= Duration::from_secs(10) && self.timer.is_running() {
            self.set_timer_running_at(false, self.ticked_at);
            self.set_timer_running_at(true, now);
        }
        self.ticked_at = now;
        // Each resolve is a yt-dlp process, so skipping through a playlist settles first.
        if let Some((_, _, asked)) = &self.pending_resolve
            && now.duration_since(*asked) >= Duration::from_millis(300)
            && let Some((url, start_secs, _)) = self.pending_resolve.take()
        {
            let (jobs, generation) = (self.jobs.clone(), self.generation);
            self.resolution = Some(youtube::resolve(&url, start_secs, move |result| {
                let _ = jobs.send(Job::Resolved { generation, result });
            }));
        }
        self.retry_reconnect(now);
        // Every seek restarts ffmpeg, so a held key or a scrolled wheel settles first.
        if let Some((at, asked)) = self.pending_seek
            && now.duration_since(asked) >= Duration::from_millis(150)
        {
            self.pending_seek = None;
            self.engine.seek(at);
            self.stream_from = at;
        }
        while let Ok(job) = self.inbox.try_recv() {
            self.handle_job(job);
        }
        for event in self.engine.poll_events() {
            self.handle_engine(event);
        }
        if let Some(ended) = self.timer.tick(now) {
            self.on_phase_ended(ended, true);
        }
        if let Some(block) = &self.focus_block
            && self.timer.is_running()
            && now.duration_since(block.saved_at) >= Duration::from_secs(30)
        {
            self.save_focus_block(now);
        }
        if now.duration_since(self.session_saved_at) >= Duration::from_secs(15) {
            self.session_saved_at = now;
            let _ = self.store.save_session(&self.session());
            let today = Timestamp::now().to_zoned(self.zone.clone()).date();
            if self.focus_days.days.last().is_some_and(|(day, _)| *day != today) {
                self.refresh_stats();
            }
        }
    }

    fn handle_engine(&mut self, event: EngineEvent) {
        match event {
            EngineEvent::Ended if self.ended_early() => {
                if !self.reconnect(false) && !self.stop_reconnecting() {
                    self.track_ended();
                }
            }
            EngineEvent::Ended => self.track_ended(),
            EngineEvent::Failed(message) => {
                if !self.reconnect(true) {
                    self.failed(message);
                }
            }
            EngineEvent::AmbientFailed { id, message } => {
                let label = self.catalog.sound(&id).map_or(id.clone(), |sound| sound.label.clone());
                self.toast(Tone::Error, format!("{label}: {message}"));
            }
            EngineEvent::NoDevice(_) => self.toast(Tone::Error, "No audio output, playing silently"),
        }
    }

    /// A live stream never ends on its own, and a video that stops well short of its length
    /// lost its connection or its URL expired (YouTube's last about six hours).
    fn ended_early(&self) -> bool {
        self.current().is_some_and(|item| {
            item.is_live()
                || item
                    .duration
                    .is_some_and(|length| self.position() + 15.0 < f64::from(length))
        })
    }

    /// Picks a dropped stream up where it stopped. An attempt that can't connect tries again after
    /// a growing pause, so a network outage waits instead of failing the rest of the queue.
    fn reconnect(&mut self, failed: bool) -> bool {
        let played = self.position() - self.stream_from;
        let ongoing = self
            .reconnecting
            .filter(|reconnect| reconnect.generation == self.generation);
        let ended_empty = !failed && played < 1.0;
        let (at, attempts) = match ongoing {
            // Once could be a connection that came back and dropped again; twice is a file that
            // ends there.
            Some(reconnect) if ended_empty && reconnect.ended_empty => {
                self.reconnecting = None;
                return false;
            }
            Some(reconnect) if played < 5.0 => (reconnect.at, reconnect.attempts),
            // Only a stream that played counts as dropped, not one that failed to start from a
            // resume point.
            _ => match self.current() {
                Some(item) if played >= 5.0 => (if item.is_live() { 0.0 } else { self.position() }, 0),
                _ => return false,
            },
        };
        let Some(delay) = RECONNECT_DELAYS.get(attempts) else {
            return false;
        };
        if attempts == 0 {
            self.toast(Tone::Info, "Lost the stream, reconnecting…");
        }
        self.stream = Stream::Idle;
        self.resume_at = Some(at);
        self.reconnecting = Some(Reconnect {
            at,
            attempts: attempts + 1,
            due: Some(Instant::now() + Duration::from_secs(*delay)),
            generation: self.generation,
            ended_empty,
        });
        true
    }

    fn retry_reconnect(&mut self, now: Instant) {
        let Some(reconnect) = self.reconnecting else {
            return;
        };
        if reconnect.generation != self.generation {
            self.reconnecting = None;
        } else if reconnect.due.is_some_and(|due| now >= due) {
            if let Some(item) = self.current().cloned() {
                self.start(item, reconnect.at);
            }
            self.reconnecting = Some(Reconnect {
                due: None,
                generation: self.generation,
                ..reconnect
            });
        } else if reconnect.due.is_none() && self.stream == Stream::Playing && self.position() - self.stream_from > 10.0
        {
            // Playing again, so a later drop starts over.
            self.reconnecting = None;
        }
    }

    fn track_ended(&mut self) {
        self.failures_in_a_row = 0;
        match self.queue.advance().cloned() {
            Some(item) => self.start(item, 0.0),
            None => self.music_ended(),
        }
    }

    fn failed(&mut self, message: String) {
        self.stream = Stream::Idle;
        self.toast(Tone::Error, message);
        if !self.stop_reconnecting() {
            self.after_failure();
        }
    }

    /// A stream still unreachable after every reconnect attempt waits where it stopped, so an
    /// outage doesn't fail the rest of the queue too.
    fn stop_reconnecting(&mut self) -> bool {
        let Some(reconnect) = self
            .reconnecting
            .take()
            .filter(|reconnect| reconnect.generation == self.generation)
        else {
            return false;
        };
        self.music_ended();
        self.resume_at = Some(reconnect.at);
        true
    }

    fn after_failure(&mut self) {
        self.failures_in_a_row += 1;
        if self.failures_in_a_row >= 3 || self.queue.upcoming().next().is_none() {
            self.failures_in_a_row = 0;
            self.music_ended();
            return;
        }
        if let Some(item) = self.queue.next().cloned() {
            self.start(item, 0.0);
        }
    }

    fn handle_job(&mut self, job: Job) {
        match job {
            Job::Catalog {
                url,
                result: Ok(catalog),
            } => {
                if let Some((_, slot)) = self.catalogs.iter_mut().find(|(known, _)| known == &url) {
                    *slot = catalog;
                    self.merge_catalogs();
                }
            }
            // The main catalog falls back to the copy in the binary, so only an added one that
            // never loaded is worth a word.
            Job::Catalog {
                url,
                result: Err(error),
            } => {
                let empty =
                    self.catalogs.iter().skip(1).any(|(known, catalog)| {
                        known == &url && catalog.tracks.is_empty() && catalog.ambient.is_empty()
                    });
                if empty {
                    self.toast(Tone::Error, format!("Could not load the catalog at {url}: {error:#}"));
                }
            }
            Job::CatalogAdded {
                url,
                result: Ok(catalog),
            } => {
                self.adding.retain(|known| known != &url);
                if self.catalogs.iter().any(|(known, _)| known == &url) {
                    return;
                }
                let message = format!(
                    "Added {}: {} tracks, {} sounds",
                    catalog::label(&catalog, &url),
                    catalog.tracks.len(),
                    catalog.ambient.len()
                );
                self.config.catalogs.push(url.clone());
                self.catalogs.push((url, catalog));
                self.save_config();
                self.merge_catalogs();
                self.toast(Tone::Done, message);
            }
            Job::CatalogAdded {
                url,
                result: Err(error),
            } => {
                self.adding.retain(|known| known != &url);
                self.toast(Tone::Error, format!("Could not add that catalog: {error:#}"));
            }
            Job::Inspected { id, result } => {
                if !self.inspection.as_ref().is_some_and(|inspection| inspection.id == id) {
                    return;
                }
                let Some(inspection) = self.inspection.take() else {
                    return;
                };
                self.events.push(Event::DismissToast(inspection.purpose.progress()));
                match inspection.purpose {
                    InspectionPurpose::Open { url, choices } => self.inspected(&url, choices, result),
                    InspectionPurpose::Refresh { id } => self.refreshed_playlist(&id, result),
                }
            }
            Job::Resolved { generation, result } => {
                if generation != self.generation {
                    return;
                }
                self.resolution = None;
                match result {
                    Ok(mut input) => {
                        self.queue.set_current_live(input.live);
                        if let Some(at) = self.resume_at.take()
                            && !input.live
                        {
                            input.start_secs = at;
                        }
                        self.stream_from = if input.live { 0.0 } else { input.start_secs };
                        self.engine.play_stream(input);
                        self.stream = Stream::Playing;
                    }
                    Err(error) => {
                        if !self.reconnect(true) {
                            self.failed(error.to_string());
                        }
                    }
                }
            }
            Job::Cover { url, image } => {
                if let Some(image) = image {
                    self.covers.push((url, image));
                }
            }
            Job::Media(command) => match command {
                MediaCommand::Play if !self.is_playing() => self.toggle_play(),
                MediaCommand::Pause if self.is_playing() => self.toggle_play(),
                MediaCommand::Toggle => self.toggle_play(),
                MediaCommand::Next => self.skip(true),
                MediaCommand::Previous => self.skip(false),
                MediaCommand::SeekBy(delta) => self.seek_to(self.position() + delta),
                MediaCommand::SetPosition(at) => self.seek_to(at),
                MediaCommand::Play | MediaCommand::Pause => {}
            },
            Job::Tools(found) => self.tools_checked(found),
            Job::Crashed => self.toast(
                Tone::Error,
                "Something stopped working in the background. Details are in crash.log in the cache folder.",
            ),
        }
    }
}

pub fn format_clock(seconds: u32) -> String {
    let (hours, minutes, seconds) = (seconds / 3600, seconds / 60 % 60, seconds % 60);
    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes}:{seconds:02}")
    }
}

/// The catalog's sounds, then the noise the engine makes itself, which every catalog gets without
/// listing it, so a catalog that version 0.1.0 also reads never names a sound it can't load.
fn with_noise(mut catalog: Catalog) -> Catalog {
    for noise in Noise::ALL {
        if catalog.sound(noise.id()).is_none() {
            catalog.ambient.push(AmbientSound {
                id: noise.id().to_owned(),
                label: noise.label().to_owned(),
                file: String::new(),
                gain_percent: 100,
                credit: None,
            });
        }
    }
    catalog
}

fn fetch_cover(url: &str) -> Option<DynamicImage> {
    let bytes = ureq::get(url)
        .config()
        .timeout_global(Some(Duration::from_secs(8)))
        .build()
        .call()
        .ok()?
        .body_mut()
        .read_to_vec()
        .ok()?;
    let image = image::load_from_memory(&bytes).ok()?;
    let letterboxed = url.contains("i.ytimg.com") && image.width() * 3 == image.height() * 4;
    Some(if letterboxed {
        let height = image.width() * 9 / 16;
        image.crop_imm(0, (image.height() - height) / 2, image.width(), height)
    } else {
        image
    })
}

/// An app on an in-memory library whose files go to a folder deleted along with it. Nothing listens
/// on port 9, so streams, downloads, and the catalog fetch fail fast instead of reaching the network.
#[cfg(test)]
const TEST_CATALOG_URL: &str = "http://127.0.0.1:9/catalog.json";

/// A fetch of the main catalog that came back with `catalog`.
#[cfg(test)]
fn main_catalog(catalog: Catalog) -> Job {
    Job::Catalog {
        url: TEST_CATALOG_URL.into(),
        result: Ok(catalog),
    }
}

#[cfg(test)]
pub struct TestApp {
    app: App,
    _files: tempfile::TempDir,
}

#[cfg(test)]
impl TestApp {
    pub fn new() -> TestApp {
        let files = tempfile::tempdir().unwrap();
        let cache = files.path().to_path_buf();
        let config = Config {
            catalog_url: TEST_CATALOG_URL.into(),
            chime: false,
            notifications: false,
            ..Config::default()
        };
        let paths = Paths {
            config_file: cache.join("config.toml"),
            database: cache.join("unused.db"),
            cache: cache.clone(),
        };
        let store = Store::open(std::path::Path::new(":memory:")).unwrap();
        TestApp {
            app: App::new(config, paths, store, Engine::start(cache)),
            _files: files,
        }
    }
}

#[cfg(test)]
impl std::ops::Deref for TestApp {
    type Target = App;

    fn deref(&self) -> &App {
        &self.app
    }
}

#[cfg(test)]
impl std::ops::DerefMut for TestApp {
    fn deref_mut(&mut self) -> &mut App {
        &mut self.app
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app() -> TestApp {
        TestApp::new()
    }

    fn playlist() -> Saved {
        Saved {
            id: "ytpl:review".into(),
            url: "https://www.youtube.com/playlist?list=review".into(),
            title: "Study".into(),
            channel: "chill".into(),
            items: vec![Item {
                key: "yt:first".into(),
                title: "First".into(),
                artist: "chill".into(),
                duration: Some(60),
                cover: None,
                play: Playable::YouTube {
                    url: "https://www.youtube.com/watch?v=first".into(),
                    live: false,
                },
            }],
        }
    }

    #[test]
    fn refreshing_a_playlist_updates_the_library_without_requesting_playback() {
        let mut app = app();
        let mut saved = playlist();
        app.store.save(&saved).unwrap();
        app.reload_library();
        let before = (app.session(), app.stream.clone(), app.choices);
        saved.title = "Updated study".into();
        saved.items[0].title = "Updated first".into();

        app.refreshed_playlist(&saved.id, Ok(saved.clone()));

        assert_eq!(app.saved, [saved.clone()]);
        assert_eq!(app.store.saved().unwrap(), [saved]);
        assert_eq!((app.session(), app.stream.clone(), app.choices), before);
    }

    #[test]
    fn failed_refreshes_keep_the_saved_playlist_and_cannot_restore_a_deleted_one() {
        let mut app = app();
        let saved = playlist();
        app.store.save(&saved).unwrap();
        app.reload_library();

        app.refreshed_playlist(&saved.id, Err(anyhow::anyhow!("offline")));
        assert_eq!(app.store.saved().unwrap().as_slice(), std::slice::from_ref(&saved));

        app.remove(Removal::Saved(saved.id.clone()));
        app.refreshed_playlist(&saved.id, Ok(saved.clone()));
        assert!(app.saved.is_empty());
        assert!(app.store.saved().unwrap().is_empty());
    }

    #[test]
    fn scenes_and_sessions_restore_a_queued_item_outside_their_source() {
        let mut app = app();
        let item = playlist().items.remove(0);
        app.store.set_liked(&item, true).unwrap();
        app.load_likes();
        let offset = app.queue.upcoming().count();
        app.queue.enqueue(item.clone());
        app.dispatch(Action::JumpQueue(offset));
        app.dispatch(Action::Submit(Prompt::SaveScene, "Queued study".into()));
        let session = app.session();
        assert_eq!(app.scenes[0].playback, session.playback);

        app.queue.replace(Vec::new(), None);
        app.load_scene(0);
        assert_eq!(app.current(), Some(&item));

        app.resume_at = Some(37.0);
        app.restore_playback(&session.playback);
        assert_eq!(app.current(), Some(&item));
        assert_eq!(app.position(), 37.0);

        app.scenes[0].playback.item = None;
        app.scenes[0].playback.legacy_item_key = Some(item.key.clone());
        app.load_scene(0);
        assert_eq!(app.current(), Some(&item));
    }

    #[test]
    fn an_added_catalog_joins_tracks_and_leaves_when_removed() {
        let mut app = app();
        let url = "http://127.0.0.1:9/friends/catalog.json".to_string();
        let friends = Catalog::parse(
            r#"{"name": "Friends", "tracks": [{"id": "home", "title": "Home", "artist": "B", "file": "home.mp3", "durationSec": 90}], "ambient": []}"#,
            &url,
        )
        .unwrap();

        app.handle_job(Job::CatalogAdded {
            url: url.clone(),
            result: Ok(friends),
        });

        let home = app
            .rows(Tab::Tracks)
            .into_iter()
            .find(|row| row.title == "Home")
            .unwrap();
        assert_eq!(home.detail, "B · Friends");
        assert_eq!(app.config.catalogs, std::slice::from_ref(&url));
        assert_eq!(
            config::load(app.config_file()).unwrap().catalogs,
            std::slice::from_ref(&url)
        );

        app.dispatch(Action::Remove(Removal::Catalog(url)));

        assert!(app.rows(Tab::Tracks).iter().all(|row| row.title != "Home"));
        assert!(app.config.catalogs.is_empty());
    }

    #[test]
    fn catalog_replacement_retires_the_old_current_without_changing_pause_or_timer() {
        for paused in [false, true] {
            let mut app = app();
            let mut updated = app.catalog.clone();
            let mut track = updated.tracks.remove(0);
            track.id = "replacement".into();
            track.file = "replacement.mp3".into();
            track.cover = None;
            updated.tracks = vec![track];
            app.stream = Stream::Resolving;
            app.resume_at = Some(42.0);
            app.engine.set_paused(paused);
            let timer_running = app.timer.is_running();
            let generation = app.generation;

            app.handle_job(main_catalog(updated));

            assert_eq!(app.current().unwrap().key, "r2:replacement");
            assert!(app.generation > generation);
            assert!(app.position() < 1.0);
            assert_eq!(app.engine.is_paused(), paused);
            assert_eq!(app.timer.is_running(), timer_running);
        }
    }

    #[test]
    fn catalog_refresh_updates_a_paused_liked_item_and_its_active_decoder_url() {
        let mut app = app();
        let item = app.current().unwrap().clone();
        app.store.set_liked(&item, true).unwrap();
        app.load_likes();
        app.fill_queue(&Source::Liked, Some(&item.key));
        app.resume_at = Some(42.0);
        let mut updated = app.catalog.clone();
        updated.tracks[0].file = "moved.mp3".into();

        app.handle_job(main_catalog(updated.clone()));

        assert_eq!(app.queue.current(), app.likes.first());
        assert_eq!(app.position(), 42.0);
        assert!(app.engine.is_paused());

        app.stream = Stream::Playing;
        app.pending_seek = Some((42.0, Instant::now()));
        let generation = app.generation;
        updated.tracks[0].file = "moved-again.mp3".into();
        app.handle_job(main_catalog(updated));
        assert!(app.generation > generation);
        assert!(app.position() >= 42.0 && app.position() < 43.0);
        assert!(app.engine.is_paused());
    }

    #[test]
    fn restoring_likes_skips_a_removed_catalog_item_and_clears_its_position() {
        let mut app = app();
        let mut survivor = app.catalog.tracks[0].clone();
        survivor.id = "survivor".into();
        survivor.file = "survivor.mp3".into();
        app.catalog.tracks.push(survivor);
        app.likes = app.items_for(&Source::Tracks).into_iter().take(2).collect();
        let playback = Playback {
            source: Source::Liked,
            item: Some(app.likes[0].clone()),
            legacy_item_key: None,
        };
        let next = app.likes[1].key.clone();
        app.catalog.tracks.remove(0);
        app.resume_at = Some(42.0);

        app.restore_playback(&playback);

        assert_eq!(app.current().unwrap().key, next);
        assert_eq!(app.position(), 0.0);
        assert_eq!(app.likes.len(), 2);
    }

    #[test]
    fn refreshing_the_active_playlist_keeps_queue_edits_and_playback_choices() {
        let mut app = app();
        let mut saved = playlist();
        let mut second = saved.items[0].clone();
        second.key = "yt:second".into();
        let mut third = saved.items[0].clone();
        third.key = "yt:third".into();
        saved.items.extend([second, third.clone()]);
        app.store.save(&saved).unwrap();
        app.reload_library();
        app.fill_queue(&Source::Saved { id: saved.id.clone() }, None);
        app.queue.move_upcoming(1, -1);
        let extra = Item::from_track(&app.catalog, &app.catalog.tracks[0]);
        app.queue.enqueue(extra.clone());
        let before = (app.choices, app.timer.is_running(), app.engine.is_paused());
        let mut added = saved.items[0].clone();
        added.key = "yt:added".into();
        saved.items.remove(1);
        saved.items.push(added);

        app.refreshed_playlist(&saved.id, Ok(saved.clone()));

        let keys: Vec<_> = app.queue.upcoming().map(|item| item.key.as_str()).collect();
        assert_eq!(keys, [third.key.as_str(), extra.key.as_str(), "yt:added"]);
        assert_eq!((app.choices, app.timer.is_running(), app.engine.is_paused()), before);

        saved.items.clear();
        app.refreshed_playlist(&saved.id, Ok(saved.clone()));
        assert!(app.saved[0].items.is_empty());
        assert_eq!(app.current().unwrap().key, extra.key);
        assert_eq!((app.choices, app.timer.is_running(), app.engine.is_paused()), before);
    }

    #[test]
    fn an_unavailable_like_neither_plays_nor_queues() {
        let mut app = app();
        let mut survivor = app.catalog.tracks[0].clone();
        survivor.id = "survivor".into();
        survivor.file = "survivor.mp3".into();
        app.catalog.tracks.push(survivor);
        app.likes = app.items_for(&Source::Tracks).into_iter().take(2).collect();
        app.catalog.tracks.remove(0);
        app.tab = Tab::Liked;
        let before = (app.source.clone(), app.current().cloned(), app.queue.upcoming().count());

        app.activate(0);
        app.enqueue(0);

        assert_eq!(
            (app.source.clone(), app.current().cloned(), app.queue.upcoming().count()),
            before
        );
    }

    #[test]
    fn sleep_starts_a_new_focus_row_when_the_machine_wakes() {
        let mut app = app();
        app.set_timer_running(true);
        let before = app.focus_block.as_ref().unwrap().id;

        let woke = app.ticked_at + Duration::from_secs(3600);
        app.tick(woke);

        assert_ne!(app.focus_block.as_ref().unwrap().id, before);
    }

    #[test]
    fn time_asleep_does_not_count_toward_the_timer() {
        let mut app = app();
        let start = Instant::now();
        app.ticked_at = start;
        app.timer.start(start);
        let length = app.timer.phase_length();

        let woke = start + Duration::from_secs(3600);
        app.tick(woke);

        assert_eq!((app.timer.phase(), app.timer.remaining(woke)), (Phase::Focus, length));
    }

    #[test]
    fn a_track_that_fails_at_its_resume_point_moves_on() {
        let mut app = app();
        let mut next = app.catalog.tracks[0].clone();
        next.id = "next".into();
        app.catalog.tracks.push(next);
        app.fill_queue(&Source::Tracks, None);
        let first = app.current().unwrap().clone();

        app.start(first, 300.0);
        // Holds the playhead at the resume point whether or not ffmpeg is installed.
        app.pending_seek = Some((300.0, Instant::now()));
        app.handle_engine(EngineEvent::Failed("HTTP error 404 Not Found".into()));

        assert_eq!(app.current().unwrap().key, "r2:next");
    }

    #[test]
    fn a_reconnect_that_ends_at_once_gets_one_more_try_before_moving_on() {
        let mut app = app();
        let mut next = app.catalog.tracks[0].clone();
        next.id = "next".into();
        app.catalog.tracks.push(next);
        app.fill_queue(&Source::Tracks, None);
        let first = app.current().unwrap().clone();
        app.stream = Stream::Playing;
        app.pending_seek = Some((120.0, Instant::now()));
        app.handle_engine(EngineEvent::Ended);
        let later = Instant::now() + Duration::from_secs(60);

        app.retry_reconnect(later);
        app.handle_engine(EngineEvent::Ended);
        assert_eq!(app.current(), Some(&first));

        app.retry_reconnect(later);
        app.handle_engine(EngineEvent::Ended);
        assert_eq!(app.current().unwrap().key, "r2:next");
    }

    #[test]
    fn a_seek_while_waiting_gives_the_new_position_its_own_tries() {
        let mut app = app();
        let mut next = app.catalog.tracks[0].clone();
        next.id = "next".into();
        app.catalog.tracks.push(next);
        app.fill_queue(&Source::Tracks, None);
        let first = app.current().unwrap().clone();
        app.stream = Stream::Playing;
        app.pending_seek = Some((120.0, Instant::now()));
        app.handle_engine(EngineEvent::Ended);
        let later = Instant::now() + Duration::from_secs(60);
        app.retry_reconnect(later);
        app.handle_engine(EngineEvent::Ended);

        app.dispatch(Action::SeekTo(30.0));
        app.retry_reconnect(later);
        app.handle_engine(EngineEvent::Ended);

        assert_eq!(app.current(), Some(&first));
    }

    #[test]
    fn previous_while_waiting_to_reconnect_restarts_the_track() {
        let mut app = app();
        let mut next = app.catalog.tracks[0].clone();
        next.id = "next".into();
        app.catalog.tracks.push(next);
        app.fill_queue(&Source::Tracks, None);
        let second = app.queue.next().cloned().unwrap();
        app.stream = Stream::Playing;
        app.pending_seek = Some((120.0, Instant::now()));
        app.handle_engine(EngineEvent::Ended);

        app.dispatch(Action::Previous);
        app.retry_reconnect(Instant::now() + Duration::from_secs(60));

        assert_eq!((app.current(), app.stream_from), (Some(&second), 0.0));
    }

    #[test]
    fn a_seek_while_waiting_to_reconnect_moves_the_retry() {
        let mut app = app();
        app.stream = Stream::Playing;
        app.pending_seek = Some((120.0, Instant::now()));
        app.handle_engine(EngineEvent::Ended);

        app.dispatch(Action::SeekTo(200.0));
        app.retry_reconnect(Instant::now() + Duration::from_secs(60));

        assert_eq!(app.stream_from, 200.0);
    }

    #[test]
    fn retries_that_keep_ending_early_stop_where_the_stream_dropped() {
        let mut app = app();
        let mut next = app.catalog.tracks[0].clone();
        next.id = "next".into();
        app.catalog.tracks.push(next);
        app.fill_queue(&Source::Tracks, None);
        let first = app.current().unwrap().clone();
        app.stream = Stream::Playing;
        app.pending_seek = Some((120.0, Instant::now()));
        app.handle_engine(EngineEvent::Ended);

        let later = Instant::now() + Duration::from_secs(60);
        for _ in RECONNECT_DELAYS {
            app.retry_reconnect(later);
            app.pending_seek = Some((122.0, Instant::now()));
            app.handle_engine(EngineEvent::Ended);
        }

        assert_eq!((app.current(), app.position()), (Some(&first), 120.0));
    }

    #[test]
    fn a_catalog_refresh_that_replaces_the_waiting_track_drops_its_retry() {
        let mut app = app();
        let mut next = app.catalog.tracks[0].clone();
        next.id = "next".into();
        app.catalog.tracks.push(next);
        app.fill_queue(&Source::Tracks, None);
        app.stream = Stream::Playing;
        app.pending_seek = Some((120.0, Instant::now()));
        app.handle_engine(EngineEvent::Ended);

        let mut updated = app.catalog.clone();
        updated.tracks.remove(0);
        app.handle_job(main_catalog(updated));

        assert!(app.reconnecting.is_none());
    }

    #[test]
    fn a_seek_while_a_link_resolves_counts_playback_from_where_it_started() {
        let mut app = app();
        let item = playlist().items.remove(0);
        app.start(item, 300.0);
        app.seek_to(50.0);

        let generation = app.generation;
        app.handle_job(Job::Resolved {
            generation,
            result: Ok(StreamInput {
                url: "http://127.0.0.1:9/first".into(),
                headers: Vec::new(),
                start_secs: 300.0,
                live: false,
            }),
        });

        assert_eq!(app.stream_from, 50.0);
    }

    #[test]
    fn a_stream_that_cannot_reconnect_waits_where_it_stopped() {
        let mut app = app();
        let item = app.current().unwrap().clone();
        app.stream = Stream::Playing;
        app.pending_seek = Some((120.0, Instant::now()));

        app.handle_engine(EngineEvent::Ended);
        let later = Instant::now() + Duration::from_secs(60);
        for _ in RECONNECT_DELAYS {
            app.retry_reconnect(later);
            app.handle_engine(EngineEvent::Failed("Connection refused".into()));
        }

        assert_eq!(app.current(), Some(&item));
        assert_eq!(app.stream, Stream::Idle);
        assert_eq!(app.position(), 120.0);
    }
}
