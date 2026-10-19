pub mod anim;
pub mod input;
mod overlay;
mod panels;
pub mod theme;
pub mod widgets;

use std::collections::HashMap;
use std::time::{Duration, Instant};

use ratatui::Frame;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui_image::picker::Picker;
use ratatui_image::protocol::StatefulProtocol;
use ratatui_image::{Resize, StatefulImage};

use crate::action::{Action, Panel, Prompt, Tab};
use crate::app::{App, Event, Tone};
use crate::model::Source;
use anim::{Bars, Tween};
use theme::Theme;

pub enum Overlay {
    Palette { query: String, selected: usize },
    Prompt { kind: Prompt, input: String },
    Confirm { message: String, action: Action },
    Help,
    Stats,
}

struct Toast {
    tone: Tone,
    message: String,
    born: Instant,
    life: Duration,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Slider {
    Volume,
    Level(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Hit {
    Act(Action),
    Row(usize),
    Queue(usize),
    Sound(usize),
    Slider(Slider),
    Seek,
    Palette(usize),
    Backdrop,
    Dialog,
    Toast(usize),
    Panel(Panel),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Drag {
    Slider(Slider, Rect),
    Seek(Rect),
}

struct Cover {
    url: String,
    protocol: StatefulProtocol,
    aspect: f32,
}

pub struct Ui {
    pub theme: Theme,
    motion: bool,
    picker: Picker,
    cover: Option<Cover>,
    pub focus: Panel,
    pub selected: [usize; 5],
    offsets: [usize; 5],
    pub queue_selected: usize,
    queue_offset: usize,
    pub sound_selected: usize,
    sound_offset: usize,
    pub filtering: bool,
    pub overlay: Option<Overlay>,
    overlay_shown: Tween,
    toasts: Vec<Toast>,
    hits: Vec<(Rect, Hit)>,
    pub hover: Option<(u16, u16)>,
    pub drag: Option<Drag>,
    pub seek_preview: Option<f64>,
    cover_rect: Option<Rect>,
    bars: Bars,
    tab_x: Tween,
    tab_width: Tween,
    volume: Tween,
    levels: HashMap<String, Tween>,
    heart: Tween,
    glow: Tween,
    panel_glow: [Tween; 3],
    stats_grow: Tween,
    title_shown: Tween,
    started: Instant,
    last_frame: Instant,
}

const FAST: Duration = Duration::from_millis(180);
const SMOOTH: Duration = Duration::from_millis(320);

impl Ui {
    pub fn new(theme: Theme, picker: Picker, reduce_motion: bool) -> Ui {
        let now = Instant::now();
        Ui {
            theme,
            motion: !reduce_motion,
            picker,
            cover: None,
            focus: Panel::Library,
            selected: [0; 5],
            offsets: [0; 5],
            queue_selected: 0,
            queue_offset: 0,
            sound_selected: 0,
            sound_offset: 0,
            filtering: false,
            overlay: None,
            overlay_shown: Tween::new(0.0),
            toasts: Vec::new(),
            hits: Vec::new(),
            hover: None,
            drag: None,
            seek_preview: None,
            cover_rect: None,
            bars: Bars::default(),
            tab_x: Tween::new(0.0),
            tab_width: Tween::new(0.0),
            volume: Tween::new(0.0),
            levels: HashMap::new(),
            heart: Tween::new(0.0),
            glow: Tween::new(0.0),
            panel_glow: [Tween::new(1.0), Tween::new(0.0), Tween::new(0.0)],
            stats_grow: Tween::new(0.0),
            title_shown: Tween::new(1.0),
            started: now,
            last_frame: now,
        }
    }

    fn duration(&self, duration: Duration) -> Duration {
        if self.motion { duration } else { Duration::ZERO }
    }

    pub fn is_animating(&self, now: Instant) -> bool {
        let tweens = [
            &self.tab_x,
            &self.tab_width,
            &self.volume,
            &self.heart,
            &self.glow,
            &self.overlay_shown,
            &self.stats_grow,
            &self.title_shown,
        ];
        !self.toasts.is_empty()
            || tweens.iter().any(|tween| tween.active(now))
            || self.panel_glow.iter().any(|tween| tween.active(now))
            || self.levels.values().any(|tween| tween.active(now))
            || (self.motion && !self.bars.is_still())
    }

    pub fn toast(&mut self, tone: Tone, message: String) {
        let life = Duration::from_millis(if tone == Tone::Error { 7000 } else { 3800 });
        self.toasts.retain(|toast| toast.message != message);
        self.toasts.push(Toast {
            tone,
            message,
            born: Instant::now(),
            life,
        });
        if self.toasts.len() > 4 {
            self.toasts.remove(0);
        }
    }

    pub fn dismiss_toast(&mut self, index: usize) {
        if index < self.toasts.len() {
            self.toasts.remove(index);
        }
    }

    pub fn set_focus(&mut self, panel: Panel) {
        let now = Instant::now();
        self.focus = panel;
        let duration = self.duration(FAST);
        for (index, glow) in self.panel_glow.iter_mut().enumerate() {
            let on = Self::panel_index(panel) == index;
            glow.set(if on { 1.0 } else { 0.0 }, now, duration);
        }
    }

    fn panel_index(panel: Panel) -> usize {
        match panel {
            Panel::Library => 0,
            Panel::Queue => 1,
            Panel::Ambience => 2,
        }
    }

    pub fn show_tab(&mut self, app: &mut App, tab: Tab) {
        if app.tab == tab {
            return;
        }
        app.tab = tab;
        app.filter.clear();
        self.filtering = false;
    }

    pub fn open(&mut self, overlay: Overlay) {
        let now = Instant::now();
        if matches!(overlay, Overlay::Stats) {
            self.stats_grow
                .play(0.0, 1.0, now, self.duration(Duration::from_millis(700)));
        }
        let was_open = self.overlay.is_some();
        self.overlay = Some(overlay);
        if !was_open {
            self.overlay_shown.play(0.0, 1.0, now, self.duration(FAST));
        }
    }

    pub fn close(&mut self) {
        self.overlay = None;
        self.overlay_shown.set(0.0, Instant::now(), self.duration(FAST));
    }

    pub fn hit_at(&self, x: u16, y: u16) -> Option<(Rect, Hit)> {
        self.hits
            .iter()
            .rev()
            .find(|(rect, _)| rect.contains((x, y).into()))
            .cloned()
    }

    fn hit(&mut self, rect: Rect, hit: Hit) {
        if self.overlay.is_none() || matches!(hit, Hit::Palette(_) | Hit::Backdrop | Hit::Act(_)) {
            self.hits.push((rect, hit));
        }
    }

    fn hovered(&self, rect: Rect) -> bool {
        self.overlay.is_none() && self.hover.is_some_and(|(x, y)| rect.contains((x, y).into()))
    }

    fn absorb(&mut self, app: &mut App, now: Instant) {
        for event in std::mem::take(&mut app.events) {
            match event {
                Event::Toast(tone, message) => self.toast(tone, message),
                Event::TrackChanged => self.title_shown.play(0.0, 1.0, now, self.duration(SMOOTH)),
                Event::PhaseChanged => self
                    .glow
                    .play(1.0, 0.0, now, self.duration(Duration::from_millis(1600))),
                Event::Liked => self
                    .heart
                    .play(1.0, 0.0, now, self.duration(Duration::from_millis(700))),
            }
        }
        let wanted = app.current().and_then(|item| item.cover.clone());
        for (url, image) in std::mem::take(&mut app.covers) {
            if Some(&url) != wanted.as_ref() {
                continue;
            }
            let aspect = image.width() as f32 / image.height().max(1) as f32;
            let protocol = self.picker.new_resize_protocol(image);
            self.cover = Some(Cover { url, protocol, aspect });
        }
        self.volume.set(app.volume, now, self.duration(FAST));
        let duration = self.duration(SMOOTH);
        for sound in &app.catalog.ambient {
            let level = f32::from(app.levels.get(&sound.id).copied().unwrap_or(0)) / 100.0;
            let tween = self.levels.entry(sound.id.clone()).or_insert_with(|| Tween::new(level));
            tween.set(level, now, duration);
        }
    }

    pub fn jump_level(&mut self, id: &str, level: f32) {
        if let Some(tween) = self.levels.get_mut(id) {
            tween.jump(level);
        }
    }

    pub fn jump_volume(&mut self, volume: f32) {
        self.volume.jump(volume);
    }

    pub fn draw(&mut self, frame: &mut Frame, app: &mut App) {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_frame);
        self.last_frame = now;
        self.absorb(app, now);
        self.toasts.retain(|toast| now.duration_since(toast.born) < toast.life);
        self.hits.clear();
        self.cover_rect = None;

        let area = frame.area();
        let [header, body, footer] =
            Layout::vertical([Constraint::Length(1), Constraint::Fill(1), Constraint::Length(1)]).areas(area);
        let buf = frame.buffer_mut();
        panels::footer(buf, footer, app, self);

        let wide = body.width >= 118 && body.height >= 22;
        let medium = !wide && body.width >= 84;
        panels::header(buf, header, app, self, now, !wide && !medium);
        if wide {
            let library_width = (body.width * 30 / 100).clamp(34, 50);
            let [library, center, side] = Layout::horizontal([
                Constraint::Length(library_width),
                Constraint::Fill(1),
                Constraint::Length(40),
            ])
            .spacing(1)
            .areas(body);
            let upcoming = if app.source == Source::Soundscape {
                0
            } else {
                app.queue.upcoming().count()
            };
            let queue_height = (upcoming as u16 + 2).clamp(4, (center.height / 3).max(4));
            let [player, queue] =
                Layout::vertical([Constraint::Fill(1), Constraint::Length(queue_height)]).areas(center);
            let [focus, ambience] = Layout::vertical([Constraint::Length(13), Constraint::Fill(1)]).areas(side);
            panels::library(buf, library, app, self, now);
            panels::player(buf, player, app, self, now, elapsed);
            panels::queue(buf, queue, app, self);
            panels::focus(buf, focus, app, self, now);
            panels::ambience(buf, ambience, app, self, now);
        } else if medium {
            let [library, center] = Layout::horizontal([Constraint::Length(34), Constraint::Fill(1)])
                .spacing(1)
                .areas(body);
            let [player, bottom] = Layout::vertical([Constraint::Fill(1), Constraint::Length(13)]).areas(center);
            let [focus, side] = Layout::horizontal([Constraint::Length(40), Constraint::Fill(1)])
                .spacing(1)
                .areas(bottom);
            panels::library(buf, library, app, self, now);
            panels::player(buf, player, app, self, now, elapsed);
            panels::focus(buf, focus, app, self, now);
            match self.focus {
                Panel::Queue => panels::queue(buf, side, app, self),
                _ => panels::ambience(buf, side, app, self, now),
            }
        } else {
            let bottom_height = (body.height / 2).clamp(6, 14);
            let [player, bottom] =
                Layout::vertical([Constraint::Fill(1), Constraint::Length(bottom_height)]).areas(body);
            panels::player(buf, player, app, self, now, elapsed);
            match self.focus {
                Panel::Library => panels::library(buf, bottom, app, self, now),
                Panel::Queue => panels::queue(buf, bottom, app, self),
                Panel::Ambience => panels::ambience(buf, bottom, app, self, now),
            }
        }

        overlay::toasts(buf, footer, self, now);
        overlay::draw(buf, area, app, self, now);

        if self.overlay.is_none()
            && let (Some(rect), Some(cover)) = (self.cover_rect, self.cover.as_mut())
        {
            frame.render_stateful_widget(
                StatefulImage::default().resize(Resize::Fit(None)),
                rect,
                &mut cover.protocol,
            );
        }
    }

    fn cover_for(&self, url: Option<&str>) -> Option<f32> {
        let cover = self.cover.as_ref()?;
        (Some(cover.url.as_str()) == url).then_some(cover.aspect)
    }
}
