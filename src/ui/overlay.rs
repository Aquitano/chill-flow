use std::time::Instant;

use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};
use ratatui::buffer::Buffer;
use ratatui::layout::{Margin, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::widgets::{Block, BorderType, Widget};
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

use super::widgets::{self, fill, fit, put, wrap};
use super::{BACKDROP_DIM, Hit, Overlay, Ui};
use crate::action::{Action, Prompt, Setting};
use crate::app::{App, Tone};
use crate::timer::TimerMode;

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
    ];
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
    let esc_color = if ui.hovered(esc) { theme.text() } else { theme.faint() };
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
        x = put(buf, x, y, key, Style::new().fg(theme.muted()));
        x = put(buf, x + 1, y, label, Style::new().fg(theme.faint())) + 3;
    }
}

pub fn draw(buf: &mut Buffer, screen: Rect, app: &App, ui: &mut Ui, now: Instant) {
    let shown = ui.overlay_shown.value(now);
    widgets::dim(buf, screen, shown * BACKDROP_DIM, &ui.theme, ui.cover_rect);
    let Some(overlay) = ui.overlay.take() else { return };
    ui.hits.push((screen, Hit::Backdrop));
    if screen.width < 30 || screen.height < 10 {
        ui.overlay = Some(overlay);
        return;
    }
    // Dialogs draw on their own layer and only their panel is copied back, so content that
    // a short terminal can't fit is cut at the panel's edge instead of spilling over the page.
    let mut layer = Buffer::empty(buf.area);
    let first_hit = ui.hits.len();
    match &overlay {
        Overlay::Palette { query, selected } => palette(&mut layer, screen, app, ui, query, *selected),
        Overlay::Prompt { kind, input } => prompt(&mut layer, screen, ui, *kind, input),
        Overlay::Confirm { message, .. } => confirm(&mut layer, screen, ui, message),
        Overlay::Help => help(&mut layer, screen, app, ui),
        Overlay::Stats => stats(&mut layer, screen, app, ui, now),
        Overlay::Settings { selected } => settings(&mut layer, screen, app, ui, *selected),
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
        widgets::dim(buf, area, 1.0 - shown, &ui.theme, None);
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
            Style::new().fg(theme.faint()),
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
            Style::new().fg(theme.faint()),
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
            Style::new().fg(theme.faint()),
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

const KEYS: [(&str, &str); 29] = [
    ("space", "play or pause everything"),
    ("n / p", "next / previous"),
    (", / .", "back / forward 10 s"),
    ("- / +", "volume"),
    ("< / >", "louder music / ambience"),
    ("f", "like what's playing"),
    ("s / r", "shuffle / repeat"),
    ("t / T", "start or pause / reset timer"),
    ("x", "skip to the next phase"),
    ("m", "next timer preset"),
    ("o", "open or paste a YouTube link"),
    ("tab", "move between panels"),
    ("1-5", "library tabs"),
    ("↑↓ / j k", "move"),
    ("← → / h l", "tabs, or a sound's level"),
    ("enter", "play the selection"),
    ("a", "queue the selection"),
    ("R", "refresh the selected YouTube playlist"),
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

fn help(buf: &mut Buffer, screen: Rect, app: &App, ui: &mut Ui) {
    let theme = ui.theme;
    let half = KEYS.len().div_ceil(2);
    let credits: Vec<String> = app
        .catalog
        .ambient
        .iter()
        .filter_map(|sound| sound.credit.as_ref().map(|credit| format!("{}: {credit}", sound.label)))
        .collect();
    let credit_rows = if credits.is_empty() {
        0
    } else {
        credits.len() as u16 + 2
    };
    let content = dialog(buf, screen, 94, half as u16 + credit_rows + 6, None, "Keys", ui);
    let column = content.width / 2;
    for (index, (key, what)) in KEYS.iter().enumerate() {
        let (x, y) = if index < half {
            (content.x, content.y + index as u16)
        } else {
            (content.x + column, content.y + (index - half) as u16)
        };
        put(buf, x, y, &format!("{key:>11}"), Style::new().fg(theme.text()));
        put(
            buf,
            x + 13,
            y,
            &fit(what, usize::from(column.saturating_sub(15))),
            Style::new().fg(theme.muted()),
        );
    }
    let mut y = content.y + half as u16 + 1;
    if !credits.is_empty() && content.height >= half as u16 + credit_rows + 2 {
        put(buf, content.x, y, "Ambient recordings", Style::new().fg(theme.text()));
        for credit in credits {
            y += 1;
            put(
                buf,
                content.x,
                y,
                &fit(&credit, usize::from(content.width)),
                Style::new().fg(theme.faint()),
            );
        }
    }
    if content.height >= half as u16 + 2 {
        put(
            buf,
            content.x,
            content.bottom().saturating_sub(1),
            "Mouse works too: click, drag the sliders, scroll the lists.",
            Style::new().fg(theme.faint()),
        );
    }
}

fn stats(buf: &mut Buffer, screen: Rect, app: &App, ui: &mut Ui, now: Instant) {
    let theme = ui.theme;
    let content = dialog(buf, screen, 66, 19, None, "Focus", ui);
    let days = &app.focus_days.days;
    let week: u32 = days.iter().map(|(_, minutes)| *minutes).sum();
    let x = put(buf, content.x, content.y, "today ", Style::new().fg(theme.faint()));
    let x = put(
        buf,
        x,
        content.y,
        &widgets::long_minutes(app.focus_days.today()),
        Style::new().fg(theme.text()).add_modifier(Modifier::BOLD),
    );
    let x = put(buf, x + 4, content.y, "last 7 days ", Style::new().fg(theme.faint()));
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
        Style::new().fg(theme.faint()),
    );
}

fn settings(buf: &mut Buffer, screen: Rect, app: &App, ui: &mut Ui, selected: usize) {
    enum Line {
        Group(&'static str),
        Gap,
        Row(usize, Setting),
    }
    let theme = ui.theme;
    let mut lines = Vec::new();
    for (index, setting) in Setting::ALL.into_iter().enumerate() {
        if index == 0 || setting.group() != Setting::ALL[index - 1].group() {
            if index > 0 {
                lines.push(Line::Gap);
            }
            lines.push(Line::Group(setting.group()));
        }
        lines.push(Line::Row(index, setting));
    }
    let content = dialog(buf, screen, 64, lines.len() as u16 + 8, None, "Settings", ui);
    // On a short terminal the path line gives up its rows and the list scrolls to the selection.
    let fits = usize::from(content.height) >= lines.len() + 4;
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
                put(buf, content.x, y, name, Style::new().fg(theme.faint()));
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
            let color = if value == "on" { theme.accent } else { theme.faint() };
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
            Style::new().fg(theme.faint()),
        );
    }
    key_hints(
        buf,
        content.x,
        content.bottom().saturating_sub(1),
        &[("↑↓", "choose"), ("←→", "change")],
        ui,
    );
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
            Tone::Error => theme.alert,
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
