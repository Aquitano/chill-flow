use std::time::Instant;

use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};
use ratatui::buffer::Buffer;
use ratatui::layout::{Margin, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::widgets::{Block, BorderType, Paragraph, Widget, Wrap};
use ratatui_image::picker::ProtocolType;
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

use super::widgets::{self, fill, fit, put, wrap};
use super::{BACKDROP_DIM, Hit, Overlay, Ui};
use crate::action::{Action, Prompt, Removal, Setting};
use crate::app::{App, Tone};
use crate::timer::TimerMode;
use crate::ui::picture::Picture;

pub struct Command {
    pub label: String,
    pub key: &'static str,
    pub action: Action,
}

pub fn commands(app: &App) -> Vec<Command> {
    let command = |label: &str, key: &'static str, action: Action| Command {
        label: label.to_string(),
        key,
        action,
    };
    let mut list = vec![
        command(
            if app.is_playing() { "Pause" } else { "Play" },
            "space",
            Action::TogglePlay,
        ),
        command("Next", "n", Action::Next),
        command("Previous", "p", Action::Previous),
        command("Shuffle", "s", Action::ToggleShuffle),
        command("Repeat", "r", Action::CycleRepeat),
        command("Like what's playing", "f", Action::ToggleLikeCurrent),
        command("Open a link…", "o", Action::OpenPrompt(Prompt::OpenUrl)),
        command("Save scene…", "", Action::OpenPrompt(Prompt::SaveScene)),
        command("Save ambience mix…", "", Action::OpenPrompt(Prompt::SaveMix)),
        command("Timer: start or pause", "t", Action::TimerToggle),
        command("Timer: reset", "T", Action::TimerReset),
        command("Timer: skip to the next phase", "x", Action::TimerSkip),
        command(
            if app.timer_panel_visible() {
                "Timer: hide"
            } else {
                "Timer: show"
            },
            "F",
            Action::ToggleTimerPanel,
        ),
        command(
            if app.library_hidden {
                "Library: show"
            } else {
                "Library: hide"
            },
            "H",
            Action::ToggleLibraryPanel,
        ),
        command(
            if app.side_hidden {
                "Ambience and timer: show"
            } else {
                "Ambience and timer: hide"
            },
            "L",
            Action::ToggleSidePanel,
        ),
    ];
    for picture in Picture::ALL {
        list.push(Command {
            label: format!("Picture: {}", picture.label()),
            key: "",
            action: Action::SetPicture(picture),
        });
    }
    for mode in TimerMode::PRESETS {
        let label = match mode {
            TimerMode::Focus { minutes } => format!("Timer: {minutes} minute focus block"),
            TimerMode::Pomodoro => "Timer: Pomodoro".to_string(),
        };
        list.push(Command {
            label,
            key: "",
            action: Action::SetTimerMode(mode),
        });
    }
    list.push(command("Ambience: off", "", Action::AmbienceOff));
    for (index, mix) in app.mixes.iter().enumerate() {
        list.push(Command {
            label: format!("Ambience: {}", mix.name),
            key: "",
            action: Action::ApplyMix(index),
        });
        list.push(Command {
            label: format!("Soundscape: {} (no music)", mix.name),
            key: "",
            action: Action::PlaySoundscape(index),
        });
    }
    for (index, scene) in app.scenes.iter().enumerate() {
        list.push(Command {
            label: format!("Scene: {}", scene.name),
            key: "",
            action: Action::LoadScene(index),
        });
    }
    for saved in app.saved.iter().filter(|saved| saved.id.starts_with("ytpl:")) {
        list.push(Command {
            label: format!("Refresh playlist: {}", saved.title),
            key: "",
            action: Action::RefreshSaved(saved.id.clone()),
        });
    }
    list.push(command("Add a catalog…", "", Action::OpenPrompt(Prompt::AddCatalog)));
    for (url, name) in app.added_catalogs() {
        list.push(Command {
            label: format!("Remove catalog: {name}"),
            key: "",
            action: Action::Remove(Removal::Catalog(url.to_string())),
        });
    }
    if app.sync_key().is_some() {
        list.push(command("Sync now", "", Action::SyncNow));
        list.push(command("Copy sync key", "", Action::CopySyncKey));
        list.push(command("Turn off sync", "", Action::TurnOffSync));
        list.push(command("Delete sync data…", "", Action::DeleteSyncData));
    } else {
        list.push(command("Turn on sync", "", Action::TurnOnSync));
        list.push(command("Join a sync space…", "", Action::OpenPrompt(Prompt::JoinSync)));
    }
    list.push(command("Recent errors and diagnostics", "D", Action::OpenDiagnostics));
    list.push(command("Focus stats", "i", Action::OpenStats));
    list.push(command("Settings", "c", Action::OpenSettings));
    list.push(command("Keyboard shortcuts", "?", Action::OpenHelp));
    list.push(command("Quit", "q", Action::Quit));
    list
}

/// Commands matching `query`, best first. An empty query keeps the natural order.
pub fn matching(app: &App, query: &str) -> Vec<Command> {
    let all = commands(app);
    if query.trim().is_empty() {
        return all;
    }
    let pattern = Pattern::parse(query, CaseMatching::Ignore, Normalization::Smart);
    let mut matcher = Matcher::new(Config::DEFAULT);
    let mut buffer = Vec::new();
    let mut scored: Vec<(u32, Command)> = all
        .into_iter()
        .filter_map(|command| {
            let score = pattern.score(Utf32Str::new(&command.label, &mut buffer), &mut matcher)?;
            Some((score, command))
        })
        .collect();
    scored.sort_by_key(|(score, _)| std::cmp::Reverse(*score));
    scored.into_iter().map(|(_, command)| command).collect()
}

/// A floating panel on a raised background, with the title and a clickable `esc` on its
/// first row. Returns the area below them for the content.
fn dialog(buf: &mut Buffer, screen: Rect, width: u16, height: u16, top: Option<u16>, title: &str, ui: &mut Ui) -> Rect {
    let theme = ui.theme;
    let width = width.min(screen.width.saturating_sub(4));
    let height = height.min(screen.height.saturating_sub(2));
    let y = top
        .unwrap_or(screen.y + screen.height.saturating_sub(height) / 2)
        .min(screen.bottom().saturating_sub(height + 1));
    let area = Rect::new(screen.x + (screen.width - width) / 2, y, width, height).intersection(screen);
    fill(buf, area, Style::new().bg(theme.panel()));
    if !theme.has_rgb() {
        Block::bordered()
            .border_type(BorderType::Rounded)
            .border_style(Style::new().fg(theme.line()))
            .render(area, buf);
    }
    let inner = area.inner(Margin {
        horizontal: 3,
        vertical: 1,
    });
    put(
        buf,
        inner.x,
        inner.y,
        &fit(title, usize::from(inner.width.saturating_sub(5))),
        Style::new().fg(theme.text()).add_modifier(Modifier::BOLD),
    );
    let esc = Rect::new(inner.right().saturating_sub(3), inner.y, 3, 1);
    let esc_color = if ui.hovered(esc) { theme.text() } else { theme.muted() };
    put(buf, esc.x, esc.y, "esc", Style::new().fg(esc_color));
    ui.hits.push((area, Hit::Dialog));
    ui.hits.push((esc, Hit::Backdrop));
    ui.dialog_area = Some(area);
    Rect::new(inner.x, inner.y + 2, inner.width, inner.height.saturating_sub(2))
}

/// A one-line text field with a block cursor, scrolled so the end of long text stays visible.
fn field(buf: &mut Buffer, area: Rect, text: &str, placeholder: &str, ui: &Ui) {
    let theme = ui.theme;
    let background = theme.raised();
    fill(buf, area, Style::new().bg(background));
    let start = put(buf, area.x + 1, area.y, "›", Style::new().fg(theme.accent)) + 1;
    let room = usize::from(area.right().saturating_sub(start + 2));
    let cursor = if text.is_empty() {
        put(
            buf,
            start,
            area.y,
            &fit(placeholder, room),
            Style::new().fg(theme.faint()),
        );
        start
    } else {
        let mut width = 0;
        let mut first = text.len();
        for (index, ch) in text.char_indices().rev() {
            width += ch.width().unwrap_or(0);
            if width > room {
                break;
            }
            first = index;
        }
        put(buf, start, area.y, &text[first..], Style::new().fg(theme.text()))
    };
    if let Some(cell) = buf.cell_mut((cursor, area.y)) {
        cell.set_bg(theme.text()).set_fg(background);
    }
}

/// Key hints in the footer's style: the key, then what it does.
fn key_hints(buf: &mut Buffer, x: u16, y: u16, hints: &[(&str, &str)], ui: &Ui) {
    let theme = ui.theme;
    let mut x = x;
    for (key, label) in hints {
        x = put(buf, x, y, key, Style::new().fg(theme.text()));
        x = put(buf, x + 1, y, label, Style::new().fg(theme.muted())) + 3;
    }
}

pub fn draw(buf: &mut Buffer, screen: Rect, app: &App, ui: &mut Ui, now: Instant) {
    let Some(mut overlay) = ui.overlay.take() else { return };
    // The page dims in one frame: fading it recolors every cell on every frame. Art drawn by a
    // graphics protocol can't be recolored like cells, and swapping in a darkened copy re-sends
    // the whole image, which flickers, so it stays as it is.
    let graphics = ui.picker.protocol_type() != ProtocolType::Halfblocks;
    widgets::dim(buf, screen, BACKDROP_DIM, &ui.theme, ui.cover_rect.filter(|_| graphics));
    ui.hits.push((screen, Hit::Backdrop));
    if screen.width < 30 || screen.height < 10 {
        ui.overlay = Some(overlay);
        return;
    }
    // Dialogs draw on their own layer and only their panel is copied back, so content that
    // a short terminal can't fit is cut at the panel's edge instead of spilling over the page.
    let mut layer = Buffer::empty(buf.area);
    let first_hit = ui.hits.len();
    match &mut overlay {
        Overlay::Palette { query, selected } => palette(&mut layer, screen, app, ui, query, *selected),
        Overlay::Prompt { kind, input } => prompt(&mut layer, screen, ui, *kind, input),
        Overlay::Confirm { message, .. } => confirm(&mut layer, screen, ui, message),
        Overlay::Help { scroll } => help(&mut layer, screen, app, ui, scroll),
        Overlay::Diagnostics { selected, scroll } => diagnostics(&mut layer, screen, app, ui, *selected, scroll),
        Overlay::Stats => stats(&mut layer, screen, app, ui, now),
        Overlay::Settings { selected, query } => settings(&mut layer, screen, app, ui, *selected, query.as_deref()),
    }
    if let Some(area) = ui.dialog_area.take() {
        for y in area.top()..area.bottom() {
            for x in area.left()..area.right() {
                buf[(x, y)] = layer[(x, y)].clone();
            }
        }
        let hits = ui.hits.split_off(first_hit);
        ui.hits.extend(hits.into_iter().filter_map(|(rect, hit)| {
            let rect = rect.intersection(area);
            (!rect.is_empty()).then_some((rect, hit))
        }));
        widgets::dim(buf, area, 1.0 - ui.overlay_shown.value(now), &ui.theme, None);
    }
    ui.overlay = Some(overlay);
}

fn palette(buf: &mut Buffer, screen: Rect, app: &App, ui: &mut Ui, query: &str, selected: usize) {
    let theme = ui.theme;
    let entries = matching(app, query);
    let rows = entries.len().clamp(1, 12) as u16;
    let top = screen.y + screen.height / 6;
    let content = dialog(buf, screen, 68, rows + 6, Some(top), "Commands", ui);
    let search = Rect::new(content.x, content.y, content.width, 1);
    field(buf, search, query, "search commands", ui);
    let list = Rect::new(
        content.x,
        content.y + 2,
        content.width,
        content.height.saturating_sub(2),
    );
    if entries.is_empty() {
        put(
            buf,
            list.x + 2,
            list.y,
            "No matching command",
            Style::new().fg(theme.muted()),
        );
        return;
    }
    let selected = selected.min(entries.len() - 1);
    let offset = selected.saturating_sub(usize::from(list.height).saturating_sub(1));
    for (index, entry) in entries.iter().enumerate().skip(offset).take(usize::from(list.height)) {
        let y = list.y + (index - offset) as u16;
        let rect = Rect::new(list.x, y, list.width, 1);
        if index == selected {
            fill(buf, rect, Style::new().bg(theme.raised()));
        } else if ui.hovered(rect) {
            fill(buf, rect, Style::new().bg(theme.mix(0.09)));
        }
        let key_width = entry.key.width() as u16;
        put(
            buf,
            rect.right().saturating_sub(key_width + 1),
            y,
            entry.key,
            Style::new().fg(theme.muted()),
        );
        let available = usize::from(rect.width.saturating_sub(key_width + 4));
        let color = if index == selected { theme.text() } else { theme.muted() };
        put(
            buf,
            rect.x + 1,
            y,
            &fit(&entry.label, available),
            Style::new().fg(color),
        );
        ui.hits.push((rect, Hit::Palette(index)));
    }
}

fn prompt(buf: &mut Buffer, screen: Rect, ui: &mut Ui, kind: Prompt, input: &str) {
    let theme = ui.theme;
    let lines = wrap(kind.hint(), 58, 2);
    let content = dialog(buf, screen, 64, lines.len() as u16 + 8, None, kind.title(), ui);
    field(
        buf,
        Rect::new(content.x, content.y, content.width, 1),
        input,
        kind.placeholder(),
        ui,
    );
    for (offset, line) in lines.iter().enumerate() {
        put(
            buf,
            content.x,
            content.y + 2 + offset as u16,
            line,
            Style::new().fg(theme.muted()),
        );
    }
    key_hints(
        buf,
        content.x,
        content.bottom().saturating_sub(1),
        &[("enter", kind.verb()), ("esc", "cancel")],
        ui,
    );
}

fn confirm(buf: &mut Buffer, screen: Rect, ui: &mut Ui, message: &str) {
    let theme = ui.theme;
    let width = (message.width() as u16 + 8).clamp(44, 72);
    let lines = wrap(message, usize::from(width - 6), 2);
    let content = dialog(buf, screen, width, lines.len() as u16 + 6, None, "Remove", ui);
    for (offset, line) in lines.iter().enumerate() {
        put(
            buf,
            content.x,
            content.y + offset as u16,
            line,
            Style::new().fg(theme.text()),
        );
    }
    key_hints(
        buf,
        content.x,
        content.y + lines.len() as u16 + 1,
        &[("enter", "remove"), ("esc", "keep")],
        ui,
    );
}

const KEYS: [(&str, &str); 32] = [
    ("space", "play or pause the sound"),
    ("n / p", "next / previous"),
    (", / .", "back / forward 10 s"),
    ("- / +", "volume"),
    ("< / >", "louder music / ambience"),
    ("f", "like what's playing"),
    ("s / r", "shuffle / repeat"),
    ("t / T", "start or pause / reset timer"),
    ("x", "skip to the next phase"),
    ("m", "next timer preset"),
    ("F", "show or hide the timer"),
    ("H / L", "show or hide left / right"),
    ("v", "next picture in the player"),
    ("o", "open or paste a YouTube link"),
    ("tab", "move between panels"),
    ("1-5", "library tabs"),
    ("↑↓ / j k", "move"),
    ("← → / h l", "tabs, or a sound's level"),
    ("enter", "play the selection"),
    ("a", "queue the selection"),
    ("R", "refresh a YouTube playlist"),
    ("right click", "add a row to the queue"),
    ("d", "remove the selection"),
    ("J / K", "move a queued item"),
    ("[ / ]", "previous / next ambience mix"),
    ("0", "mute the selected sound"),
    ("/", "filter the library"),
    ("^p or :", "command palette"),
    ("i", "focus stats"),
    ("c", "settings"),
    ("esc", "close or clear"),
    ("q", "quit"),
];

/// Each key with the longest description beside it, which two columns need side by side.
const KEY_COLUMN: u16 = 44;

/// Two columns of keys when the window is wide enough, one otherwise, and the rows that don't
/// fit scroll.
fn help(buf: &mut Buffer, screen: Rect, app: &App, ui: &mut Ui, scroll: &mut usize) {
    let theme = ui.theme;
    let (text, muted, faint) = (
        Style::new().fg(theme.text()),
        Style::new().fg(theme.muted()),
        Style::new().fg(theme.faint()),
    );
    let width = 2 * KEY_COLUMN + 6;
    let columns = if screen.width.saturating_sub(4) >= width { 2 } else { 1 };
    let per_column = KEYS.len().div_ceil(columns);
    let mut rows: Vec<Vec<(u16, String, Style)>> = (0..per_column)
        .map(|row| {
            (0..columns)
                .filter_map(|column| {
                    KEYS.get(row + column * per_column)
                        .map(|key| (column as u16 * KEY_COLUMN, key))
                })
                .flat_map(|(x, (key, what))| [(x, format!("{key:>11}"), text), (x + 13, what.to_string(), muted)])
                .collect()
        })
        .collect();
    let credits: Vec<String> = app
        .catalog
        .ambient
        .iter()
        .filter_map(|sound| sound.credit.as_ref().map(|credit| format!("{}: {credit}", sound.label)))
        .collect();
    if !credits.is_empty() {
        rows.push(Vec::new());
        rows.push(vec![(0, "Ambient recordings".to_owned(), text)]);
        rows.extend(credits.into_iter().map(|credit| vec![(0, credit, faint)]));
    }
    let content = dialog(buf, screen, width, rows.len() as u16 + 6, None, "Keys", ui);
    let view = usize::from(content.height.saturating_sub(2));
    *scroll = (*scroll).min(rows.len().saturating_sub(view));
    for (y, row) in (content.y..).zip(rows.iter().skip(*scroll).take(view)) {
        for (index, (x, words, style)) in row.iter().enumerate() {
            let room = row
                .get(index + 1)
                .map_or(content.width, |(next, ..)| next.saturating_sub(2))
                .saturating_sub(*x);
            put(buf, content.x + x, y, &fit(words, usize::from(room)), *style);
        }
    }
    let hint = if rows.len() > view {
        "↑↓ scroll   esc close"
    } else {
        "Mouse works too: click, drag the sliders, scroll the lists."
    };
    if content.height >= 2 {
        put(
            buf,
            content.x,
            content.bottom() - 1,
            &fit(hint, usize::from(content.width)),
            muted,
        );
    }
}

fn stats(buf: &mut Buffer, screen: Rect, app: &App, ui: &mut Ui, now: Instant) {
    let theme = ui.theme;
    let content = dialog(buf, screen, 66, 19, None, "Focus", ui);
    let days = &app.focus_days.days;
    let week: u32 = days.iter().map(|(_, minutes)| *minutes).sum();
    let x = put(buf, content.x, content.y, "today ", Style::new().fg(theme.muted()));
    let x = put(
        buf,
        x,
        content.y,
        &widgets::long_minutes(app.focus_days.today()),
        Style::new().fg(theme.text()).add_modifier(Modifier::BOLD),
    );
    let x = put(buf, x + 4, content.y, "last 7 days ", Style::new().fg(theme.muted()));
    put(
        buf,
        x,
        content.y,
        &widgets::long_minutes(week),
        Style::new().fg(theme.text()),
    );
    let bars: Vec<(String, u32, bool)> = days
        .iter()
        .enumerate()
        .map(|(index, (date, minutes))| (date.strftime("%a").to_string(), *minutes, index + 1 == days.len()))
        .collect();
    let chart = Rect::new(
        content.x,
        content.y + 2,
        content.width,
        content.height.saturating_sub(4),
    );
    widgets::bar_chart(buf, chart, &bars, ui.stats_grow.value(now), &theme);
    put(
        buf,
        content.x,
        content.bottom().saturating_sub(1),
        "Counts every minute a focus block ran. Breaks never count.",
        Style::new().fg(theme.muted()),
    );
}

/// The settings whose group and label hold every word of `query`, in their usual order.
pub fn matching_settings(query: &str) -> Vec<usize> {
    let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
    Setting::ALL
        .iter()
        .enumerate()
        .filter(|(_, setting)| {
            let text = format!("{} {}", setting.group(), setting.label()).to_lowercase();
            words.iter().all(|word| text.contains(word.as_str()))
        })
        .map(|(index, _)| index)
        .collect()
}

fn settings(buf: &mut Buffer, screen: Rect, app: &App, ui: &mut Ui, selected: usize, query: Option<&str>) {
    enum Line {
        Group(&'static str),
        Gap,
        Row(usize, Setting),
    }
    let theme = ui.theme;
    let lines_for = |shown: &[usize]| {
        let mut lines = Vec::new();
        let mut group = None;
        for &index in shown {
            let setting = Setting::ALL[index];
            if group != Some(setting.group()) {
                if group.is_some() {
                    lines.push(Line::Gap);
                }
                lines.push(Line::Group(setting.group()));
                group = Some(setting.group());
            }
            lines.push(Line::Row(index, setting));
        }
        lines
    };
    // Sized for every setting, so the dialog holds still while a search narrows the list.
    let every: Vec<usize> = (0..Setting::ALL.len()).collect();
    let height = lines_for(&every).len() as u16 + 8;
    let lines = lines_for(&matching_settings(query.unwrap_or_default()));
    let content = dialog(buf, screen, 64, height, None, "Settings", ui);
    // On a short terminal the path line gives up its rows and the list scrolls to the selection.
    let fits = usize::from(content.height) >= usize::from(height) - 4;
    let view = usize::from(content.height.saturating_sub(if fits { 4 } else { 2 }));
    let selected_line = lines
        .iter()
        .position(|line| matches!(line, Line::Row(index, _) if *index == selected))
        .unwrap_or(0);
    let offset = (selected_line + 1).saturating_sub(view);
    for (row, line) in lines.iter().skip(offset).take(view).enumerate() {
        let y = content.y + row as u16;
        let (index, setting) = match line {
            Line::Gap => continue,
            Line::Group(name) => {
                put(buf, content.x, y, name, Style::new().fg(theme.muted()));
                continue;
            }
            Line::Row(index, setting) => (*index, *setting),
        };
        let rect = Rect::new(content.x, y, content.width, 1);
        let is_selected = index == selected;
        if is_selected {
            fill(buf, rect, Style::new().bg(theme.raised()));
        } else if ui.hovered(rect) {
            fill(buf, rect, Style::new().bg(theme.mix(0.09)));
        }
        let label_color = if is_selected { theme.text() } else { theme.muted() };
        put(buf, rect.x + 1, y, setting.label(), Style::new().fg(label_color));
        ui.hits.push((rect, Hit::Setting(index)));

        let value = app.setting_value(setting);
        let more = Rect::new(rect.right().saturating_sub(2), y, 1, 1);
        let value_x = more.x.saturating_sub(value.width() as u16 + 1);
        if setting.is_toggle() {
            let color = if value == "on" { theme.accent } else { theme.muted() };
            put(buf, value_x, y, &value, Style::new().fg(color));
        } else {
            let arrow = |hovered: bool| Style::new().fg(if hovered { theme.accent } else { theme.faint() });
            let less = Rect::new(value_x.saturating_sub(2), y, 1, 1);
            put(buf, less.x, y, "‹", arrow(ui.hovered(less)));
            put(buf, value_x, y, &value, Style::new().fg(theme.text()));
            put(buf, more.x, y, "›", arrow(ui.hovered(more)));
            ui.hits.push((less, Hit::Act(Action::AdjustSetting(setting, -1))));
            ui.hits.push((more, Hit::Act(Action::AdjustSetting(setting, 1))));
        }
    }
    let path = crate::config::display_path(app.config_file());
    if fits {
        put(
            buf,
            content.x,
            content.bottom().saturating_sub(3),
            &fit(&format!("Changes save to {path}"), usize::from(content.width)),
            Style::new().fg(theme.muted()),
        );
    }
    if lines.is_empty() {
        put(
            buf,
            content.x + 1,
            content.y,
            "No setting matches",
            Style::new().fg(theme.muted()),
        );
    }
    let bottom = content.bottom().saturating_sub(1);
    match query {
        Some(query) => field(
            buf,
            Rect::new(content.x, bottom, content.width, 1),
            query,
            "search settings",
            ui,
        ),
        None => key_hints(
            buf,
            content.x,
            bottom,
            &[("↑↓", "choose"), ("←→", "change"), ("/", "search")],
            ui,
        ),
    }
}

pub fn toasts(buf: &mut Buffer, footer: Rect, ui: &mut Ui, now: Instant) {
    let theme = ui.theme;
    let mut bottom = footer.y.saturating_sub(1);
    let count = ui.toasts.len();
    for index in (0..count).rev() {
        let toast = &ui.toasts[index];
        let age = now.duration_since(toast.born).as_secs_f32();
        let remaining = toast.life.as_secs_f32() - age;
        let fade = if ui.motion {
            (1.0 - age / 0.2).max(1.0 - remaining / 0.4).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let width = (toast.message.width() as u16 + 6)
            .min(64)
            .min(footer.width.saturating_sub(4))
            .max(12);
        let room = usize::from(width.saturating_sub(6));
        let lines = wrap(&toast.message, room, 2);
        let height = lines.len() as u16 + 2;
        let x = footer.right().saturating_sub(width + 2);
        let y = bottom.saturating_sub(height);
        if y < 1 {
            break;
        }
        let area = Rect::new(x, y, footer.right().saturating_sub(x + 2).min(width), height);
        let color = match toast.tone {
            Tone::Info => theme.calm,
            Tone::Done => theme.rest,
            Tone::Error | Tone::Warning => theme.alert,
        };
        fill(buf, area, Style::new().bg(theme.raised()));
        if !theme.has_rgb() {
            Block::bordered()
                .border_type(BorderType::Rounded)
                .border_style(Style::new().fg(theme.line()))
                .render(area, buf);
        }
        put(buf, area.x + 2, y + 1, "●", Style::new().fg(color));
        for (offset, line) in lines.iter().enumerate() {
            put(
                buf,
                area.x + 4,
                y + 1 + offset as u16,
                line,
                Style::new().fg(theme.text()),
            );
        }
        widgets::dim(buf, area, fade, &theme, None);
        ui.hits.push((area, Hit::Toast(index)));
        bottom = y;
    }
}

pub fn diagnostic_notice(buf: &mut Buffer, area: Rect, app: &App, ui: &mut Ui) {
    let theme = ui.theme;
    fill(buf, area, Style::new().bg(theme.raised()));
    let pending = app.diagnostics.pending();
    let heading = if app.diagnostics.log_error.is_some() {
        "D diagnostics: log unavailable".to_owned()
    } else {
        format!("D diagnostics ({pending})")
    };
    put(
        buf,
        area.x + 1,
        area.y,
        &fit(&heading, usize::from(area.width.saturating_sub(2))),
        Style::new().fg(theme.alert),
    );
    ui.hit(area, Hit::Act(Action::OpenDiagnostics));
    let message = app
        .diagnostics
        .log_error
        .as_deref()
        .or_else(|| app.diagnostics.latest_pending().map(|entry| entry.message.as_str()))
        .unwrap_or("More failures occurred while the history was full. Open diagnostics for the count.");
    put(
        buf,
        area.x + 1,
        area.y + 1,
        &fit(message, usize::from(area.width.saturating_sub(2))),
        Style::new().fg(theme.text()),
    );
}

fn diagnostics(buf: &mut Buffer, screen: Rect, app: &App, ui: &mut Ui, selected: usize, scroll: &mut usize) {
    let theme = ui.theme;
    let content = dialog(buf, screen, 88, 23, None, "Recent errors and diagnostics", ui);
    let entries = app.diagnostics.entries();
    let selected_entry = entries.iter().enumerate().find(|(_, entry)| entry.id == selected);
    let mut lines = Vec::new();
    if let Some((index, entry)) = selected_entry {
        lines.push(format!(
            "{} of {} · {} · seen {} times",
            index + 1,
            entries.len(),
            if entry.dismissed { "dismissed" } else { "unresolved" },
            entry.occurrences
        ));
        lines.push(format!("Last seen: {}", entry.last_seen));
        lines.push(String::new());
        lines.push(entry.message.clone());
    } else if entries.is_empty() {
        lines.push("No recent errors or dependency notices.".into());
    } else {
        lines.push("This entry is no longer in the history. Use left or right to select another.".into());
    }
    if app.diagnostics.omitted() > 0 {
        lines.push(format!(
            "{} additional failures omitted while all 100 entries were unresolved. Press x to dismiss this count.",
            app.diagnostics.omitted()
        ));
    }
    if let Some(error) = &app.diagnostics.log_error {
        lines.push(error.clone());
    }
    lines.push(String::new());
    lines.push(format!("Log: {}", crate::config::display_path(&app.diagnostics.path)));
    lines.push("URLs and sync keys are redacted. Run chill doctor for dependency details.".into());
    let details = Paragraph::new(lines.join("\n"))
        .wrap(Wrap { trim: false })
        .style(Style::new().fg(theme.text()));
    let height = content.height.saturating_sub(2);
    *scroll = (*scroll).min(details.line_count(content.width).saturating_sub(usize::from(height)));
    details
        .scroll((*scroll as u16, 0))
        .render(Rect { height, ..content }, buf);
    let controls = [
        ("←", Hit::DiagnosticEntry(-1)),
        ("→", Hit::DiagnosticEntry(1)),
        ("↑", Hit::DiagnosticScroll(-1)),
        ("↓", Hit::DiagnosticScroll(1)),
        ("enter dismiss", Hit::Act(Action::DismissDiagnostic(selected))),
    ];
    let y = content.bottom().saturating_sub(1);
    let mut x = content.x;
    for (label, hit) in controls {
        if selected_entry.is_none() && matches!(hit, Hit::Act(Action::DismissDiagnostic(_))) {
            continue;
        }
        let width = label.width() as u16;
        put(buf, x, y, label, Style::new().fg(theme.muted()));
        ui.hit(Rect::new(x, y, width, 1), hit);
        x += width + 2;
    }
    if app.diagnostics.omitted() > 0 && content.height >= 2 {
        let label = "x dismiss overflow count";
        let y = y.saturating_sub(1);
        put(buf, content.x, y, label, Style::new().fg(theme.muted()));
        ui.hit(
            Rect::new(content.x, y, content.width, 1),
            Hit::Act(Action::DismissDiagnosticOverflow),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::TestApp;
    use crate::ui::theme::Theme;
    use ratatui_image::picker::Picker;

    #[test]
    fn help_scrolls_inside_a_small_window_and_fits_two_columns_in_a_wide_one() {
        let app = TestApp::new();
        let mut ui = Ui::new(Theme::new(None), Picker::halfblocks(), true);
        let mut draw = |width, height, scroll: &mut usize| {
            let screen = Rect::new(0, 0, width, height);
            let mut buffer = Buffer::empty(screen);
            help(&mut buffer, screen, &app, &mut ui, scroll);
            let area = ui.dialog_area.take().unwrap();
            let page: String = buffer.content().iter().map(|cell| cell.symbol()).collect();
            (page, buffer[(area.x + 1, area.bottom() - 1)].symbol().to_owned())
        };

        let (top, border) = draw(60, 20, &mut 0);
        assert!(top.contains("↑↓ scroll") && !top.contains("Ambient recordings"));
        assert_eq!(border, "─");
        let mut seen = String::new();
        for requested in 0.. {
            let mut scroll = requested;
            let (page, border) = draw(60, 20, &mut scroll);
            assert_eq!(border, "─");
            seen.push_str(&page);
            if scroll < requested {
                break;
            }
        }
        for (_, what) in KEYS {
            assert!(seen.contains(what), "{what} never shows");
        }
        assert!(seen.contains("Ambient recordings"));

        let (wide, _) = draw(160, 45, &mut 0);
        assert!(wide.contains("play or pause the sound") && wide.contains("quit") && wide.contains("Mouse works too"));
        assert!(!wide.contains('…'));
    }

    #[test]
    fn diagnostic_details_keep_long_words_and_log_paths_through_scroll() {
        let mut app = TestApp::new();
        let detail = format!("Could not read /{}final-error", "資料/recordings/".repeat(20));
        app.toast(Tone::Error, &detail);
        let log_path = format!("/{}diagnostics.json", "long-cache-directory/".repeat(20));
        app.diagnostics.path = log_path.clone().into();
        let mut ui = Ui::new(Theme::new(None), Picker::halfblocks(), true);
        let screen = Rect::new(0, 0, 40, 12);
        let mut rendered = String::new();
        for requested in 0..crate::diagnostics::MESSAGE_LIMIT {
            let mut buffer = Buffer::empty(screen);
            let mut scroll = requested;
            diagnostics(&mut buffer, screen, &app, &mut ui, 0, &mut scroll);
            if scroll < requested {
                break;
            }
            let area = ui.dialog_area.unwrap();
            let x = area.x + 3;
            let y = area.y + 3;
            for column in x..area.right() - 3 {
                rendered.push_str(buffer[(column, y)].symbol());
            }
        }
        let compact = |text: &str| text.chars().filter(|ch| !ch.is_whitespace()).collect::<String>();
        assert!(compact(&rendered).contains(&compact(&detail)));
        assert!(compact(&rendered).contains(&compact(&log_path)));
        assert!(!rendered.contains('…'));
    }
}
