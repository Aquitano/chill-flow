use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::{Duration, Instant};

use anyhow::Result;
use image::DynamicImage;
use jiff::Timestamp;
use jiff::tz::TimeZone;

use crate::action::{Action, Prompt, Removal, Tab};
use crate::audio::{Engine, EngineEvent, StreamInput};
use crate::catalog::{Catalog, Levels, Mix};
use crate::config::Config;
use crate::media::MediaCommand;
use crate::model::{Item, Playable, Saved, Scene, Session, Source};
use crate::queue::Queue;
use crate::store::{FocusDays, Store};
use crate::timer::{Phase, PhaseEnded, Timer, TimerMode};
use crate::youtube;

pub enum Job {
    Catalog(Result<Catalog>),
    Inspected {
        url: String,
        play: bool,
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

struct FocusBlock {
    id: i64,
    saved_at: Instant,
}

pub struct App {
    pub config: Config,
    cache_dir: PathBuf,
    store: Store,
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
    pub timer: Timer,
    pub focus_days: FocusDays,
    focus_block: Option<FocusBlock>,
    timer_follows_play: bool,
    pub stream: Stream,
    generation: u64,
    failures_in_a_row: u32,
    resume_at: Option<f64>,
    pub jobs: Sender<Job>,
    inbox: Receiver<Job>,
    pub events: Vec<Event>,
    pub covers: Vec<(String, DynamicImage)>,
    pub filter: String,
    pub tab: Tab,
    zone: TimeZone,
    session_saved_at: Instant,
    pub quit: bool,
}

/// Things the UI should react to (toasts, glows, transitions), drained once per frame.
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Toast(Tone, String),
    TrackChanged,
    PhaseChanged,
    Liked,
}

impl App {
    pub fn new(config: Config, cache_dir: PathBuf, store: Store, engine: Engine) -> App {
        let (jobs, inbox) = mpsc::channel();
        let session = store.session();
        let catalog = Catalog::offline(&cache_dir, &config.catalog_url);
        let zone = TimeZone::system();
        let mut app = App {
            timer: Timer::new(session.timer, config.pomodoro),
            focus_days: store.focus_days(7, &zone).unwrap_or(FocusDays { days: Vec::new() }),
            saved: store.saved().unwrap_or_default(),
            likes: store.likes().unwrap_or_default(),
            scenes: store.scenes().unwrap_or_default(),
            mixes: Vec::new(),
            config,
            cache_dir,
            store,
            catalog,
            engine,
            queue: Queue::new(session.shuffle, session.repeat),
            source: session.source.clone(),
            levels: Levels::new(),
            mix_name: None,
            volume: session.volume.clamp(0.0, 1.0),
            focus_block: None,
            timer_follows_play: true,
            stream: Stream::Idle,
            generation: 0,
            failures_in_a_row: 0,
            resume_at: (session.position > 1.0).then_some(session.position),
            jobs,
            inbox,
            events: Vec::new(),
            covers: Vec::new(),
            filter: String::new(),
            tab: Tab::Tracks,
            zone,
            session_saved_at: Instant::now(),
            quit: false,
        };
        app.refresh_mixes();
        app.engine.set_volume(app.volume);
        app.apply_levels(&session.levels);
        app.mix_name = app.matching_mix_name();
        app.fill_queue(&session.source, session.item_key.as_deref());
        app.fetch_catalog();
        app
    }

    /// `chill <url>` or `chill <scene>`: start that instead of the paused resume.
    pub fn launch(&mut self, target: &str) {
        if youtube::looks_like_url(target) {
            self.open_url(target.trim(), true);
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

    fn fetch_catalog(&self) {
        let jobs = self.jobs.clone();
        let (cache, url) = (self.cache_dir.clone(), self.config.catalog_url.clone());
        std::thread::spawn(move || {
            let _ = jobs.send(Job::Catalog(Catalog::fetch(&cache, &url)));
        });
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

    pub fn position(&self) -> f64 {
        match self.stream {
            Stream::Playing => self.engine.position(),
            _ => self.resume_at.unwrap_or(0.0),
        }
    }

    pub fn is_liked(&self, key: &str) -> bool {
        self.likes.iter().any(|item| item.key == key)
    }

    pub fn source_label(&self) -> String {
        match &self.source {
            Source::Tracks => "Tracks".into(),
            Source::Liked => "Liked".into(),
            Source::Saved { id } => self
                .saved
                .iter()
                .find(|saved| &saved.id == id)
                .map_or_else(|| "YouTube".into(), |saved| saved.title.clone()),
            Source::Soundscape => self.mix_name.clone().unwrap_or_else(|| "Soundscape".into()),
        }
    }

    pub fn rows(&self, tab: Tab) -> Vec<Row> {
        let duration = |seconds: Option<u32>| seconds.map(format_clock).unwrap_or_default();
        let rows: Vec<Row> = match tab {
            Tab::Tracks => self
                .catalog
                .tracks
                .iter()
                .enumerate()
                .map(|(index, track)| Row {
                    title: track.title.clone(),
                    detail: track.artist.clone(),
                    meta: duration(Some(track.duration_sec)),
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
                    detail: mix
                        .levels
                        .keys()
                        .filter_map(|id| self.catalog.sound(id).map(|sound| sound.label.clone()))
                        .collect::<Vec<_>>()
                        .join(" · "),
                    meta: if mix.id.starts_with("saved:") {
                        "yours".into()
                    } else {
                        String::new()
                    },
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
        let source = match &scene.source {
            Source::Tracks => "Tracks".to_string(),
            Source::Liked => "Liked".to_string(),
            Source::Saved { id } => self
                .saved
                .iter()
                .find(|saved| &saved.id == id)
                .map_or_else(|| "YouTube".to_string(), |saved| saved.title.clone()),
            Source::Soundscape => "Ambience only".to_string(),
        };
        let sounds = scene
            .levels
            .keys()
            .filter_map(|id| self.catalog.sound(id).map(|sound| sound.label.as_str()))
            .collect::<Vec<_>>();
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
            Source::Liked => self.likes.clone(),
            Source::Saved { id } => self
                .saved
                .iter()
                .find(|saved| &saved.id == id)
                .map(|saved| saved.items.clone())
                .unwrap_or_default(),
            Source::Soundscape => Vec::new(),
        }
    }

    fn fill_queue(&mut self, source: &Source, start_key: Option<&str>) {
        self.source = source.clone();
        let items = self.items_for(source);
        self.queue.replace(items, start_key);
        self.events.push(Event::TrackChanged);
        self.load_cover();
    }

    fn play_source(&mut self, source: Source, start_key: Option<&str>) {
        self.fill_queue(&source, start_key);
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
                let (jobs, generation) = (self.jobs.clone(), self.generation);
                std::thread::spawn(move || {
                    let result = youtube::resolve(&url, start_secs);
                    let _ = jobs.send(Job::Resolved { generation, result });
                });
            }
        }
    }

    fn stop_stream(&mut self) {
        self.generation += 1;
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
        self.stop_stream();
        self.queue.replace(Vec::new(), None);
        self.source = Source::Soundscape;
        self.events.push(Event::TrackChanged);
        self.resume();
    }

    fn load_cover(&self) {
        let Some(url) = self.current().and_then(|item| item.cover.clone()) else {
            return;
        };
        let jobs = self.jobs.clone();
        std::thread::spawn(move || {
            let image = fetch_cover(&url);
            let _ = jobs.send(Job::Cover { url, image });
        });
    }

    fn resume(&mut self) {
        self.engine.set_paused(false);
        if self.timer_follows_play {
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
        let now = Instant::now();
        if running {
            self.timer.start(now);
            self.track_focus(now);
        } else {
            self.timer.pause(now);
            self.save_focus_block(now, false);
        }
    }

    fn skip(&mut self, forward: bool) {
        self.failures_in_a_row = 0;
        if !forward && self.position() > 3.0 && self.stream == Stream::Playing {
            self.engine.seek(0.0);
            return;
        }
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
            Action::ToggleShuffle => {
                self.queue.set_shuffle(!self.queue.shuffle);
                let state = if self.queue.shuffle { "on" } else { "off" };
                self.toast(Tone::Info, format!("Shuffle {state}"));
            }
            Action::CycleRepeat => {
                self.queue.repeat = self.queue.repeat.cycled();
                let label = format!("Repeat {:?}", self.queue.repeat).to_lowercase();
                self.toast(Tone::Info, label);
            }
            Action::ToggleLikeCurrent => {
                if let Some(item) = self.current().cloned() {
                    self.toggle_like(item);
                }
            }
            Action::ToggleLikeRow(index) => {
                if let Some(item) = self.row_item(self.tab, index) {
                    self.toggle_like(item);
                }
            }
            Action::Activate(index) => self.activate(index),
            Action::Enqueue(index) => self.enqueue(index),
            Action::Remove(removal) => self.remove(removal),
            Action::JumpQueue(offset) => {
                if let Some(item) = self.queue.jump(offset).cloned() {
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
                self.save_focus_block(Instant::now(), false);
                self.focus_block = None;
                self.timer.reset();
                self.timer_follows_play = true;
            }
            Action::TimerSkip => {
                let now = Instant::now();
                self.save_focus_block(now, false);
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
            Action::Quit => self.quit = true,
            Action::ShowTab(_)
            | Action::RemoveRow(_)
            | Action::Focus(_)
            | Action::OpenPrompt(_)
            | Action::OpenPalette
            | Action::OpenHelp
            | Action::OpenStats => {}
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
            Stream::Playing => self.engine.seek(seconds),
            _ => self.resume_at = Some(seconds),
        }
    }

    fn set_volume(&mut self, volume: f32) {
        self.volume = volume.clamp(0.0, 1.0);
        self.engine.set_volume(self.volume);
    }

    fn set_timer_mode(&mut self, mode: TimerMode) {
        let now = Instant::now();
        let was_running = self.timer.is_running();
        self.save_focus_block(now, false);
        self.focus_block = None;
        self.timer.set_mode(mode, self.config.pomodoro);
        if was_running {
            self.timer.start(now);
            self.track_focus(now);
        }
    }

    fn set_level(&mut self, id: &str, level: u8) {
        let Some(sound) = self.catalog.sound(id) else { return };
        let level = level.min(100);
        let url = self.catalog.url(&sound.file);
        let gain = sound.gain_percent as f32 / 100.0;
        self.engine.set_ambient(id, &url, f32::from(level) / 100.0, gain);
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
        self.apply_levels(&scene.levels);
        self.mix_name = self.matching_mix_name();
        self.timer_follows_play = true;
        if scene.source == Source::Soundscape {
            self.enter_soundscape();
        } else if self.items_for(&scene.source).is_empty() {
            self.enter_soundscape();
            self.toast(
                Tone::Error,
                format!("The music in \"{}\" is gone, playing its ambience only", scene.name),
            );
            return;
        } else {
            self.play_source(scene.source, scene.item_key.as_deref());
        }
        self.toast(Tone::Done, format!("Scene \"{}\"", scene.name));
    }

    pub fn row_item(&self, tab: Tab, index: usize) -> Option<Item> {
        let row = self.rows(tab).into_iter().nth(index)?;
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
        self.likes = self.store.likes().unwrap_or_default();
        if liked {
            self.events.push(Event::Liked);
        }
    }

    fn activate(&mut self, index: usize) {
        let Some(row) = self.rows(self.tab).into_iter().nth(index) else {
            return;
        };
        match row.target {
            Target::Track(i) => {
                let key = self.catalog.tracks.get(i).map(|track| format!("r2:{}", track.id));
                self.play_source(Source::Tracks, key.as_deref());
            }
            Target::Liked(i) => {
                let key = self.likes.get(i).map(|item| item.key.clone());
                self.play_source(Source::Liked, key.as_deref());
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

    fn enqueue(&mut self, index: usize) {
        let Some(row) = self.rows(self.tab).into_iter().nth(index) else {
            return;
        };
        let items = match row.target {
            Target::Saved(i) => self.saved.get(i).map(|saved| saved.items.clone()).unwrap_or_default(),
            Target::Mix(i) => return self.apply_mix(i),
            Target::Scene(_) => return,
            _ => self.row_item(self.tab, index).into_iter().collect(),
        };
        if self.source == Source::Soundscape {
            return self.activate(index);
        }
        let count = items.len();
        for item in items {
            self.queue.enqueue(item);
        }
        let noun = if count == 1 { "item" } else { "items" };
        self.toast(Tone::Done, format!("Added {count} {noun} to the queue"));
    }

    /// The identity and title behind a library row, for a delete that waits on confirmation.
    pub fn removal(&self, index: usize) -> Option<(Removal, String)> {
        let row = self.rows(self.tab).into_iter().nth(index)?;
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
        };
        match result {
            Ok(()) => self.reload_library(),
            Err(error) => self.toast(Tone::Error, format!("Could not remove it: {error}")),
        }
    }

    fn reload_library(&mut self) {
        self.saved = self.store.saved().unwrap_or_default();
        self.likes = self.store.likes().unwrap_or_default();
        self.scenes = self.store.scenes().unwrap_or_default();
        self.refresh_mixes();
        self.mix_name = self.matching_mix_name();
    }

    fn submit(&mut self, prompt: Prompt, text: &str) {
        if text.is_empty() {
            return;
        }
        match prompt {
            Prompt::OpenUrl => self.open_url(text, true),
            Prompt::SaveScene => {
                let scene = Scene {
                    name: text.to_string(),
                    source: self.source.clone(),
                    item_key: self.current().map(|item| item.key.clone()),
                    levels: self.levels.clone(),
                    timer: self.timer.mode(),
                };
                match self.store.save_scene(&scene) {
                    Ok(()) => {
                        self.reload_library();
                        self.toast(
                            Tone::Done,
                            format!("Saved scene \"{text}\", start it with `chill {text}`"),
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

    pub fn open_url(&mut self, url: &str, play: bool) {
        self.toast(Tone::Info, "Looking up that link…");
        let (jobs, url) = (self.jobs.clone(), url.to_string());
        std::thread::spawn(move || {
            let result = youtube::inspect(&url);
            let _ = jobs.send(Job::Inspected { url, play, result });
        });
    }

    fn track_focus(&mut self, now: Instant) {
        if self.timer.phase() != Phase::Focus || !self.timer.is_running() || self.focus_block.is_some() {
            return;
        }
        let started = Timestamp::now() - jiff::SignedDuration::try_from(self.timer.elapsed(now)).unwrap_or_default();
        let planned = self.timer.phase_length().as_secs();
        if let Ok(id) = self.store.begin_focus_block(started, planned) {
            self.focus_block = Some(FocusBlock { id, saved_at: now });
        }
    }

    fn save_focus_block(&mut self, now: Instant, completed: bool) {
        if self.timer.phase() != Phase::Focus {
            return;
        }
        let Some(block) = self.focus_block.as_mut() else { return };
        block.saved_at = now;
        let focused = self.timer.elapsed(now).as_secs();
        let _ = self.store.update_focus_block(block.id, focused, completed);
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
                let _ = self.store.update_focus_block(block.id, ended.length.as_secs(), true);
            }
            self.refresh_stats();
        }
        self.focus_block = None;
        self.events.push(Event::PhaseChanged);
        if !natural {
            self.track_focus(Instant::now());
            return;
        }
        self.engine.chime();
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
        std::thread::spawn(move || {
            let _ = notify_rust::Notification::new()
                .summary(&title)
                .body(&body)
                .appname("chill")
                .show();
        });
        self.track_focus(Instant::now());
    }

    pub fn session(&self) -> Session {
        Session {
            source: self.source.clone(),
            item_key: self.queue.current().map(|item| item.key.clone()),
            position: if self.current().is_some_and(Item::is_live) {
                0.0
            } else {
                self.position()
            },
            volume: self.volume,
            levels: self.levels.clone(),
            timer: self.timer.mode(),
            shuffle: self.queue.shuffle,
            repeat: self.queue.repeat,
        }
    }

    pub fn shutdown(&mut self) {
        self.save_focus_block(Instant::now(), false);
        let _ = self.store.save_session(&self.session());
    }

    /// Everything that happens without input: finished jobs, audio events, the timer.
    pub fn tick(&mut self, now: Instant) {
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
            self.save_focus_block(now, false);
        }
        if now.duration_since(self.session_saved_at) >= Duration::from_secs(15) {
            self.session_saved_at = now;
            let _ = self.store.save_session(&self.session());
        }
    }

    fn handle_engine(&mut self, event: EngineEvent) {
        match event {
            EngineEvent::Ended => {
                self.failures_in_a_row = 0;
                match self.queue.advance().cloned() {
                    Some(item) => self.start(item, 0.0),
                    None => self.music_ended(),
                }
            }
            EngineEvent::Failed(message) => {
                self.stream = Stream::Idle;
                self.toast(Tone::Error, message);
                self.after_failure();
            }
            EngineEvent::AmbientFailed { id, message } => {
                let label = self.catalog.sound(&id).map_or(id.clone(), |sound| sound.label.clone());
                self.toast(Tone::Error, format!("{label}: {message}"));
            }
            EngineEvent::NoDevice(reason) => {
                self.toast(Tone::Error, format!("No audio output ({reason}), playing silently"))
            }
        }
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
            Job::Catalog(Ok(catalog)) => {
                self.catalog = catalog;
                self.refresh_mixes();
                if self.source == Source::Tracks && self.stream == Stream::Idle {
                    let key = self.queue.current().map(|item| item.key.clone());
                    self.fill_queue(&Source::Tracks, key.as_deref());
                }
            }
            Job::Catalog(Err(_)) => {}
            Job::Inspected { url, play, result } => match result {
                Ok(saved) => {
                    let title = saved.title.clone();
                    let source = Source::Saved { id: saved.id.clone() };
                    if let Err(error) = self.store.save(&saved) {
                        self.toast(Tone::Error, format!("Could not save it: {error}"));
                    }
                    self.reload_library();
                    if play {
                        self.timer_follows_play = self.timer.is_running() || self.timer_follows_play;
                        self.play_source(source, youtube::start_key(&url).as_deref());
                    }
                    self.toast(Tone::Done, format!("Added \"{title}\" to YouTube"));
                }
                Err(error) => self.toast(Tone::Error, error.to_string()),
            },
            Job::Resolved { generation, result } => {
                if generation != self.generation {
                    return;
                }
                match result {
                    Ok(mut input) => {
                        if let Some(at) = self.resume_at.take()
                            && !input.live
                        {
                            input.start_secs = at;
                        }
                        self.engine.play_stream(input);
                        self.stream = Stream::Playing;
                    }
                    Err(error) => {
                        self.stream = Stream::Idle;
                        self.toast(Tone::Error, error.to_string());
                        self.after_failure();
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
