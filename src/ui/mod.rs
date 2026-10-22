pub mod anim;
pub mod input;
mod overlay;
mod panels;
pub mod picture;
pub mod theme;
pub mod widgets;

use std::collections::HashMap;
use std::time::{Duration, Instant};

use ratatui::Frame;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui_image::picker::Picker;
use ratatui_image::protocol::StatefulProtocol;
use ratatui_image::{FilterType, Resize, StatefulImage};

use crate::action::{Action, Panel, Prompt, Tab};
use crate::app::{App, Event, Tone};
use anim::{Bars, Tween};
use picture::{Scene, Weather};
use theme::Theme;

pub enum Overlay {
    Palette { query: String, selected: usize },
    Prompt { kind: Prompt, input: String },
    Confirm { message: String, action: Action },
    Help,
    Stats,
    Settings { selected: usize },
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
    Balance,
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
    Setting(usize),
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

/// How far the page fades toward the background behind a dialog.
const BACKDROP_DIM: f32 = 0.5;

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
    pub last_click: Option<Hit>,
    pub seek_preview: Option<f64>,
    cover_rect: Option<Rect>,
    dialog_area: Option<Rect>,
    bars: Bars,
    scene: Scene,
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
            last_click: None,
            seek_preview: None,
            cover_rect: None,
            dialog_area: None,
            bars: Bars::default(),
            scene: Scene::default(),
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
        // Without motion a toast doesn't fade, and the slow frame still removes it on time.
        (self.motion && !self.toasts.is_empty())
            || tweens.iter().any(|tween| tween.active(now))
            || self.panel_glow.iter().any(|tween| tween.active(now))
            || self.levels.values().any(|tween| tween.active(now))
            || (self.motion && !self.bars.is_still())
    }

    /// Ends every running transition at its target, for when reduced motion turns on.
    fn settle(&mut self) {
        let tweens = [
            &mut self.tab_x,
            &mut self.tab_width,
            &mut self.volume,
            &mut self.heart,
            &mut self.glow,
            &mut self.overlay_shown,
            &mut self.stats_grow,
            &mut self.title_shown,
        ];
        for tween in tweens
            .into_iter()
            .chain(&mut self.panel_glow)
            .chain(self.levels.values_mut())
        {
            tween.jump(tween.target());
        }
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

    /// The ambience as pictures show it, eased like the sliders.
    fn weather(&self, app: &App, now: Instant) -> Weather {
        Weather::from_sounds(app.catalog.ambient.iter().map(|sound| {
            let level = self.levels.get(&sound.id).map_or(0.0, |tween| tween.value(now));
            (sound.id.as_str(), level)
        }))
    }

    pub fn show_tab(&mut self, app: &mut App, tab: Tab) {
        if app.tab == tab {
            return;
        }
        app.tab = tab;
        app.filter.clear();
        self.filtering = false;
        self.last_click = None;
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
        self.overlay_shown.jump(0.0);
    }

    pub fn hit_at(&self, x: u16, y: u16) -> Option<(Rect, Hit)> {
        self.hits
            .iter()
            .rev()
            .find(|(rect, _)| rect.contains((x, y).into()))
            .cloned()
    }

    fn hit(&mut self, rect: Rect, hit: Hit) {
        self.hits.push((rect, hit));
    }

    fn hovered(&self, rect: Rect) -> bool {
        self.overlay.is_none() && self.hover.is_some_and(|(x, y)| rect.contains((x, y).into()))
    }

    /// Moves focus off a panel that's put away, which a restored session can start on.
    pub fn keep_focus_visible(&mut self, app: &App) {
        if app.panel_hidden(self.focus) {
            self.set_focus(Panel::Queue);
        }
    }

    fn absorb(&mut self, app: &mut App, now: Instant) {
        self.keep_focus_visible(app);
        let motion = !app.config.reduce_motion;
        if self.motion && !motion {
            self.settle();
        }
        self.motion = motion;
        for event in std::mem::take(&mut app.events) {
            match event {
                Event::Toast(tone, message) => self.toast(tone, message),
                Event::DismissToast(message) => self.toasts.retain(|toast| toast.message != message),
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
        if self.motion {
            app.engine.spectrum(self.bars.raw_mut());
            self.bars.update(elapsed.as_secs_f32().min(0.1));
            if app.is_playing() {
                self.scene.advance(elapsed.as_secs_f32().min(0.1));
            }
        }
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
        let split = medium && body.width >= 104;
        let mut clock_shown = false;
        if wide {
            let library_width = if app.library_hidden {
                0
            } else {
                (body.width * 30 / 100).clamp(34, 50)
            };
            let side_width = if app.side_hidden { 0 } else { 40 };
            let [library, center, side] = Layout::horizontal([
                Constraint::Length(library_width),
                Constraint::Fill(1),
                Constraint::Length(side_width),
            ])
            .spacing(1)
            .areas(body);
            let queue_height = (center.height / 5).max(5);
            let [player, queue] =
                Layout::vertical([Constraint::Fill(1), Constraint::Length(queue_height)]).areas(center);
            if !app.library_hidden {
                panels::library(buf, library, app, self, now);
            }
            panels::player(buf, player, app, self, now);
            panels::queue(buf, queue, app, self);
            if !app.side_hidden {
                if app.timer_hidden {
                    panels::ambience(buf, side, app, self, now);
                } else {
                    let [focus, ambience] = Layout::vertical([Constraint::Length(13), Constraint::Fill(1)]).areas(side);
                    clock_shown = panels::focus(buf, focus, app, self, now);
                    panels::ambience(buf, ambience, app, self, now);
                }
            }
        } else if medium {
            let library_width = if app.library_hidden { 0 } else { 36 };
            let [library, center] = Layout::horizontal([Constraint::Length(library_width), Constraint::Fill(1)])
                .spacing(1)
                .areas(body);
            let bottom_height = if app.side_hidden {
                (center.height / 5).max(5)
            } else {
                13
            };
            let [player, bottom] =
                Layout::vertical([Constraint::Fill(1), Constraint::Length(bottom_height)]).areas(center);
            if !app.library_hidden {
                panels::library(buf, library, app, self, now);
            }
            panels::player(buf, player, app, self, now);
            let timer = !app.timer_hidden && !app.side_hidden;
            if app.side_hidden {
                panels::queue(buf, bottom, app, self);
            } else if split && timer {
                let [focus, side] = Layout::horizontal([Constraint::Length(40), Constraint::Fill(1)])
                    .spacing(1)
                    .areas(bottom);
                clock_shown = panels::focus(buf, focus, app, self, now);
                match self.focus {
                    Panel::Queue => panels::queue(buf, side, app, self),
                    _ => panels::ambience(buf, side, app, self, now),
                }
            } else {
                match self.focus {
                    Panel::Library if timer => clock_shown = panels::focus(buf, bottom, app, self, now),
                    Panel::Queue => panels::queue(buf, bottom, app, self),
                    _ => panels::ambience(buf, bottom, app, self, now),
                }
            }
        } else {
            let bottom_height = (body.height / 2).clamp(6, 14);
            let [player, bottom] =
                Layout::vertical([Constraint::Fill(1), Constraint::Length(bottom_height)]).areas(body);
            panels::player(buf, player, app, self, now);
            match self.focus {
                Panel::Library if !app.library_hidden => panels::library(buf, bottom, app, self, now),
                Panel::Ambience if !app.side_hidden => panels::ambience(buf, bottom, app, self, now),
                _ => panels::queue(buf, bottom, app, self),
            }
        }
        let show_timer = !clock_shown && (!app.timer_hidden || app.timer.is_running());
        panels::header(buf, header, app, self, now, show_timer);

        overlay::toasts(buf, footer, self, now);

        if let (Some(rect), Some(cover)) = (self.cover_rect, self.cover.as_mut()) {
            frame.render_stateful_widget(
                StatefulImage::default().resize(Resize::Scale(Some(FilterType::Triangle))),
                rect,
                &mut cover.protocol,
            );
        }
        overlay::draw(frame.buffer_mut(), area, app, self, now);
    }

    fn cover_for(&self, url: Option<&str>) -> Option<f32> {
        let cover = self.cover.as_ref()?;
        (Some(cover.url.as_str()) == url).then_some(cover.aspect)
    }
}

#[cfg(test)]
mod tests {
    use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;

    use super::*;
    use crate::action::Setting;
    use crate::app::TestApp;

    fn offline_app() -> TestApp {
        TestApp::new()
    }

    fn random_event(rng: &mut fastrand::Rng, width: u16, height: u16) -> Event {
        const KEYS: &str = " npfsrtTxmFo:?ic[]12345adjkhlgG/JK0,.+-<>qyzvHL";
        let code = |rng: &mut fastrand::Rng| match rng.u8(..12) {
            0 => KeyCode::Enter,
            1 => KeyCode::Esc,
            2 => KeyCode::Tab,
            3 => KeyCode::BackTab,
            4 => KeyCode::Backspace,
            5 => [KeyCode::Up, KeyCode::Down, KeyCode::Left, KeyCode::Right][rng.usize(..4)],
            6 => [
                KeyCode::PageUp,
                KeyCode::PageDown,
                KeyCode::Home,
                KeyCode::End,
                KeyCode::Delete,
            ][rng.usize(..5)],
            _ => KeyCode::Char(KEYS.chars().nth(rng.usize(..KEYS.chars().count())).unwrap_or(' ')),
        };
        let modifiers = match rng.u8(..10) {
            0 => KeyModifiers::CONTROL,
            1 => KeyModifiers::SHIFT,
            _ => KeyModifiers::NONE,
        };
        let (column, row) = (rng.u16(..width.saturating_add(3)), rng.u16(..height.saturating_add(3)));
        match rng.u8(..10) {
            0..=5 => Event::Key(KeyEvent::new(code(rng), modifiers)),
            6..=8 => {
                let kind = match rng.u8(..6) {
                    0 | 1 => MouseEventKind::Down(MouseButton::Left),
                    2 => MouseEventKind::Down(MouseButton::Right),
                    3 => MouseEventKind::Drag(MouseButton::Left),
                    4 => MouseEventKind::Up(MouseButton::Left),
                    _ => [
                        MouseEventKind::ScrollUp,
                        MouseEventKind::ScrollDown,
                        MouseEventKind::Moved,
                    ][rng.usize(..3)],
                };
                Event::Mouse(MouseEvent {
                    kind,
                    column,
                    row,
                    modifiers,
                })
            }
            _ => {
                let pieces = [
                    "日本語のタイトル",
                    "a",
                    " ",
                    "🎃",
                    "\u{0301}",
                    "long text that keeps going and going",
                    "\t",
                    "",
                ];
                Event::Paste((0..rng.usize(..6)).map(|_| pieces[rng.usize(..pieces.len())]).collect())
            }
        }
    }

    #[test]
    fn settings_wheel_clamps_selection_and_reveals_hidden_rows() {
        let mut app = offline_app();
        let mut ui = Ui::new(Theme::new(None), Picker::halfblocks(), false);
        let volume = app.volume;
        ui.open(Overlay::Settings { selected: 0 });
        ui.hits.push((Rect::new(0, 0, 10, 1), Hit::Slider(Slider::Volume)));
        for kind in [MouseEventKind::ScrollDown, MouseEventKind::ScrollUp] {
            for _ in 0..Setting::ALL.len() + 2 {
                input::handle(
                    &mut app,
                    &mut ui,
                    Event::Mouse(MouseEvent {
                        kind,
                        column: 0,
                        row: 0,
                        modifiers: KeyModifiers::NONE,
                    }),
                );
            }
            let expected = if kind == MouseEventKind::ScrollDown {
                Setting::ALL.len() - 1
            } else {
                0
            };
            assert!(matches!(&ui.overlay, Some(Overlay::Settings { selected }) if *selected == expected));
            let mut terminal = Terminal::new(TestBackend::new(80, 12)).unwrap();
            terminal.draw(|frame| ui.draw(frame, &mut app)).unwrap();
            assert!(ui.hits.iter().any(|(_, hit)| *hit == Hit::Setting(expected)));
        }
        assert_eq!(app.volume, volume);
    }

    #[test]
    fn playlist_refresh_commands_and_footer_use_saved_identity() {
        use crate::model::{Item, Playable, Saved};

        let mut app = offline_app();
        let item = Item {
            key: "yt:video".into(),
            title: "Video".into(),
            artist: String::new(),
            duration: Some(10),
            cover: None,
            play: Playable::YouTube {
                url: "https://youtu.be/video".into(),
                live: false,
            },
        };
        app.saved = [
            ("yt:video", "Video"),
            ("ytpl:study", "Study playlist"),
            ("ytpl:other", "Other playlist"),
        ]
        .into_iter()
        .map(|(id, title)| Saved {
            id: id.into(),
            url: "https://youtube.com/playlist?list=example".into(),
            title: title.into(),
            channel: String::new(),
            items: vec![item.clone()],
        })
        .collect();
        let refreshes: Vec<_> = overlay::commands(&app)
            .into_iter()
            .filter_map(|command| match command.action {
                Action::RefreshSaved(id) => Some(id),
                _ => None,
            })
            .collect();
        assert_eq!(refreshes, ["ytpl:study", "ytpl:other"]);
        app.tab = Tab::YouTube;
        app.filter = "Study".into();
        let mut ui = Ui::new(Theme::new(None), Picker::halfblocks(), false);
        let mut terminal = Terminal::new(TestBackend::new(80, 24)).unwrap();
        terminal.draw(|frame| ui.draw(frame, &mut app)).unwrap();
        assert!(
            ui.hits
                .iter()
                .any(|(_, hit)| { *hit == Hit::Act(Action::RefreshSaved("ytpl:study".into())) })
        );
    }

    #[test]
    fn a_dialog_dims_the_page_in_its_first_frame() {
        let mut app = offline_app();
        let theme = Theme::new(Some(([205, 214, 244], [30, 30, 46])));
        let mut ui = Ui::new(theme, Picker::halfblocks(), false);
        let mut terminal = Terminal::new(TestBackend::new(100, 30)).unwrap();
        let header = |terminal: &Terminal<TestBackend>| terminal.backend().buffer()[(3, 0)].fg;
        terminal.draw(|frame| ui.draw(frame, &mut app)).unwrap();
        let bright = header(&terminal);

        ui.open(Overlay::Help);
        terminal.draw(|frame| ui.draw(frame, &mut app)).unwrap();
        let dimmed = header(&terminal);
        ui.close();
        terminal.draw(|frame| ui.draw(frame, &mut app)).unwrap();

        assert_ne!(dimmed, bright);
        assert_eq!(header(&terminal), bright);
    }

    #[test]
    fn turning_on_reduced_motion_ends_running_transitions() {
        let mut app = offline_app();
        let mut ui = Ui::new(Theme::new(None), Picker::halfblocks(), false);
        app.toast(Tone::Info, "Queued");
        app.events.push(crate::app::Event::TrackChanged);
        let now = Instant::now();
        ui.absorb(&mut app, now);
        assert!(ui.is_animating(now));

        app.config.reduce_motion = true;
        ui.absorb(&mut app, now);

        assert!(!ui.is_animating(now));
    }

    #[test]
    fn hidden_spectrum_settles_after_the_visualizer_no_longer_fits() {
        let mut app = offline_app();
        let mut ui = Ui::new(Theme::new(None), Picker::halfblocks(), false);
        ui.bars.resize(16);
        ui.bars.raw_mut().fill(1.0);
        ui.bars.update(0.1);
        assert!(!ui.bars.is_still());
        let mut terminal = Terminal::new(TestBackend::new(80, 20)).unwrap();
        for _ in 0..30 {
            ui.last_frame = Instant::now() - Duration::from_millis(100);
            terminal.draw(|frame| ui.draw(frame, &mut app)).unwrap();
        }
        assert!(ui.bars.is_still());
        assert!(!ui.is_animating(Instant::now() + Duration::from_secs(1)));
    }

    #[test]
    fn a_hidden_timer_leaves_the_page_and_shows_in_the_header_only_while_running() {
        let mut app = offline_app();
        let mut ui = Ui::new(Theme::new(None), Picker::halfblocks(), false);
        let mut terminal = Terminal::new(TestBackend::new(160, 44)).unwrap();
        let mut draw = |app: &mut TestApp| {
            terminal.draw(|frame| ui.draw(frame, app)).unwrap();
            let buffer = terminal.backend().buffer();
            let row = |y: u16| {
                (0..buffer.area.width)
                    .map(|x| buffer[(x, y)].symbol())
                    .collect::<String>()
            };
            let page: String = (1..buffer.area.height).map(row).collect();
            (row(0).contains("focus "), page.contains(" Focus "))
        };
        assert_eq!(draw(&mut app), (false, true));

        app.dispatch(Action::ToggleTimerPanel);
        assert_eq!(draw(&mut app), (false, false));

        app.dispatch(Action::TimerToggle);
        app.dispatch(Action::ToggleTimerPanel);
        assert_eq!(draw(&mut app), (true, false));
    }

    #[test]
    fn a_hidden_side_never_keeps_the_keys_and_a_tab_key_brings_the_library_back() {
        let mut app = offline_app();
        let mut ui = Ui::new(Theme::new(None), Picker::halfblocks(), false);
        let press = |app: &mut TestApp, ui: &mut Ui, code| {
            input::handle(app, ui, Event::Key(KeyEvent::new(code, KeyModifiers::NONE)));
            ui.focus
        };
        press(&mut app, &mut ui, KeyCode::Char('/'));
        press(&mut app, &mut ui, KeyCode::Char('r'));
        input::apply(&mut app, &mut ui, Action::ToggleLibraryPanel);
        assert!(!ui.filtering && app.filter.is_empty());

        assert_eq!(press(&mut app, &mut ui, KeyCode::Char('L')), Panel::Queue);
        let session = app.session();
        assert!(session.library_hidden && session.side_hidden);
        assert_eq!(press(&mut app, &mut ui, KeyCode::Tab), Panel::Queue);
        assert_eq!(press(&mut app, &mut ui, KeyCode::Esc), Panel::Queue);

        assert_eq!(press(&mut app, &mut ui, KeyCode::Char('2')), Panel::Library);
        assert!(!app.library_hidden);
    }

    #[test]
    fn a_picture_takes_the_place_of_the_cover_and_spectrum_below_the_title() {
        let mut app = offline_app();
        let mut ui = Ui::new(
            Theme::new(Some(([205, 214, 244], [30, 30, 46]))),
            Picker::halfblocks(),
            false,
        );
        let title = app.current().map(|item| item.title.clone()).unwrap_or_default();
        let mut terminal = Terminal::new(TestBackend::new(160, 44)).unwrap();
        let mut draw = |app: &mut TestApp| {
            terminal.draw(|frame| ui.draw(frame, app)).unwrap();
            let buffer = terminal.backend().buffer();
            let page: String = buffer.content().iter().map(|cell| cell.symbol()).collect();
            let dotted = page.chars().any(|ch| ('\u{2801}'..='\u{28ff}').contains(&ch));
            (page.contains(&title), dotted)
        };
        assert_eq!(draw(&mut app), (true, false));

        app.dispatch(Action::SetPicture(picture::Picture::NightLake));
        assert_eq!(draw(&mut app), (true, true));
    }

    #[test]
    fn random_input_at_any_terminal_size_never_panics() {
        let mut rng = fastrand::Rng::with_seed(0x5eed);
        let mut app = offline_app();
        let mut ui = Ui::new(
            Theme::new(Some(([205, 214, 244], [30, 30, 46]))),
            Picker::halfblocks(),
            false,
        );
        let mut terminal = Terminal::new(TestBackend::new(80, 24)).unwrap();
        let edges = [
            (1, 1),
            (2, 3),
            (12, 4),
            (24, 8),
            (40, 12),
            (83, 20),
            (84, 21),
            (117, 21),
            (118, 22),
            (160, 45),
        ];
        for step in 0..3000 {
            if step % 30 == 0 {
                let (width, height) = if rng.bool() {
                    edges[rng.usize(..edges.len())]
                } else {
                    (rng.u16(1..240), rng.u16(1..70))
                };
                terminal.backend_mut().resize(width, height);
                if step % 300 == 0 {
                    ui.theme = Theme::new(None);
                    ui.motion = !ui.motion;
                }
            }
            let area = terminal.size().unwrap();
            let event = random_event(&mut rng, area.width, area.height);
            input::handle(&mut app, &mut ui, event);
            app.quit = false;
            app.tick(Instant::now());
            terminal.draw(|frame| ui.draw(frame, &mut app)).unwrap();
        }
    }
}
