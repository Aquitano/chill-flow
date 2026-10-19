use std::time::Instant;

use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Widget};
use unicode_width::UnicodeWidthStr;

use super::widgets::{self, fill, fit, put};
use super::{Hit, Overlay, Ui};
use crate::action::{Action, Prompt};
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
        command("Open a YouTube link…", "o", Action::OpenPrompt(Prompt::OpenUrl)),
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
    list.push(command("Focus stats", "i", Action::OpenStats));
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

fn dialog(buf: &mut Buffer, screen: Rect, width: u16, height: u16, top: Option<u16>, title: &str, ui: &mut Ui) -> Rect {
    let theme = ui.theme;
    let width = width.min(screen.width.saturating_sub(4));
    let height = height.min(screen.height.saturating_sub(2));
    let y = top.unwrap_or(screen.y + screen.height.saturating_sub(height) / 2);
    let area = Rect::new(screen.x + (screen.width - width) / 2, y, width, height).intersection(screen);
    fill(buf, area, Style::new().bg(theme.background()));
    let block = Block::bordered()
        .border_type(BorderType::Rounded)
        .border_style(Style::new().fg(theme.mix(0.42)))
        .style(Style::new().bg(theme.background()))
        .title(Line::from(vec![
            Span::raw(" "),
            Span::styled(
                title.to_string(),
                Style::new().fg(theme.text()).add_modifier(Modifier::BOLD),
            ),
            Span::raw(" "),
        ]));
    let inner = block.inner(area);
    block.render(area, buf);
    ui.hits.push((area, Hit::Dialog));
    inner
}

pub fn draw(buf: &mut Buffer, screen: Rect, app: &App, ui: &mut Ui, now: Instant) {
    let shown = ui.overlay_shown.value(now);
    widgets::dim(buf, screen, shown * 0.6, &ui.theme, None);
    let Some(overlay) = ui.overlay.take() else { return };
    ui.hits.push((screen, Hit::Backdrop));
    if screen.width < 30 || screen.height < 10 {
        ui.overlay = Some(overlay);
        return;
    }
    match &overlay {
        Overlay::Palette { query, selected } => palette(buf, screen, app, ui, query, *selected),
        Overlay::Prompt { kind, input } => prompt(buf, screen, ui, *kind, input),
        Overlay::Confirm { message, .. } => confirm(buf, screen, ui, message),
        Overlay::Help => help(buf, screen, app, ui),
        Overlay::Stats => stats(buf, screen, app, ui, now),
    }
    ui.overlay = Some(overlay);
}

fn palette(buf: &mut Buffer, screen: Rect, app: &App, ui: &mut Ui, query: &str, selected: usize) {
    let theme = ui.theme;
    let entries = matching(app, query);
    let rows = entries.len().clamp(1, 12) as u16;
    let top = screen.y + screen.height / 6;
    let inner = dialog(buf, screen, 66, rows + 4, Some(top), "Commands", ui);
    let x = put(buf, inner.x + 1, inner.y, "› ", Style::new().fg(theme.accent));
    if query.is_empty() {
        put(buf, x, inner.y, "type to search", Style::new().fg(theme.faint()));
    } else {
        let end = put(buf, x, inner.y, query, Style::new().fg(theme.text()));
        put(buf, end, inner.y, "▏", Style::new().fg(theme.accent));
    }
    let list = Rect::new(inner.x, inner.y + 2, inner.width, inner.height.saturating_sub(2));
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
            fill(buf, rect, Style::new().bg(theme.surface()));
            put(buf, rect.x, y, "▎", Style::new().fg(theme.accent));
        } else if ui.hover.is_some_and(|(hx, hy)| rect.contains((hx, hy).into())) {
            fill(buf, rect, Style::new().bg(theme.hover()));
        }
        let key_width = entry.key.width() as u16;
        put(
            buf,
            rect.right().saturating_sub(key_width + 2),
            y,
            entry.key,
            Style::new().fg(theme.faint()),
        );
        let available = usize::from(rect.width.saturating_sub(key_width + 6));
        put(
            buf,
            rect.x + 2,
            y,
            &fit(&entry.label, available),
            Style::new().fg(theme.text()),
        );
        ui.hits.push((rect, Hit::Palette(index)));
    }
}

fn prompt(buf: &mut Buffer, screen: Rect, ui: &mut Ui, kind: Prompt, input: &str) {
    let theme = ui.theme;
    let inner = dialog(buf, screen, 64, 5, None, kind.title(), ui);
    let y = inner.y + 1;
    let x = put(buf, inner.x + 1, y, "› ", Style::new().fg(theme.accent));
    let room = usize::from(inner.width.saturating_sub(5));
    if input.is_empty() {
        put(buf, x, y, kind.placeholder(), Style::new().fg(theme.faint()));
    } else {
        let visible: String = {
            let skip = input.width().saturating_sub(room);
            input.chars().skip(skip).collect()
        };
        let end = put(buf, x, y, &visible, Style::new().fg(theme.text()));
        put(buf, end, y, "▏", Style::new().fg(theme.accent));
    }
    put(
        buf,
        inner.x + 1,
        inner.bottom() - 1,
        "enter to confirm · esc to cancel",
        Style::new().fg(theme.faint()),
    );
}

fn confirm(buf: &mut Buffer, screen: Rect, ui: &mut Ui, message: &str) {
    let theme = ui.theme;
    let width = (message.width() as u16 + 6).clamp(40, 70);
    let inner = dialog(buf, screen, width, 5, None, "Are you sure?", ui);
    put(
        buf,
        inner.x + 1,
        inner.y + 1,
        &fit(message, usize::from(inner.width.saturating_sub(2))),
        Style::new().fg(theme.text()),
    );
    put(
        buf,
        inner.x + 1,
        inner.bottom() - 1,
        "enter to confirm · esc to cancel",
        Style::new().fg(theme.faint()),
    );
}

const KEYS: [(&str, &str); 24] = [
    ("space", "play or pause everything"),
    ("n / p", "next / previous"),
    (", / .", "back / forward 10 s"),
    ("- / +", "volume"),
    ("f", "like what's playing"),
    ("s / r", "shuffle / repeat"),
    ("t / T", "timer start-pause / reset"),
    ("x", "skip to the next phase"),
    ("m", "next timer preset"),
    ("o", "open a YouTube link (or paste)"),
    ("tab", "move between panels"),
    ("1-5", "library tabs"),
    ("↑↓ / j k", "move"),
    ("← → / h l", "tabs, or a sound's level"),
    ("enter", "play the selection"),
    ("a", "add the selection to the queue"),
    ("d", "remove the selection"),
    ("J / K", "move a queued item"),
    ("[ / ]", "previous / next ambience mix"),
    ("/", "filter the library"),
    ("^p or :", "command palette"),
    ("i", "focus stats"),
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
    let height = half as u16
        + 5
        + if credits.is_empty() {
            0
        } else {
            credits.len() as u16 + 2
        };
    let inner = dialog(buf, screen, 92, height, None, "Keys", ui);
    let column = inner.width / 2;
    for (index, (key, what)) in KEYS.iter().enumerate() {
        let (x, y) = if index < half {
            (inner.x + 2, inner.y + 1 + index as u16)
        } else {
            (inner.x + column + 1, inner.y + 1 + (index - half) as u16)
        };
        put(buf, x, y, &format!("{key:>10}"), Style::new().fg(theme.accent));
        put(
            buf,
            x + 12,
            y,
            &fit(what, usize::from(column.saturating_sub(15))),
            Style::new().fg(theme.muted()),
        );
    }
    let mut y = inner.y + half as u16 + 2;
    if !credits.is_empty() {
        put(buf, inner.x + 2, y, "Ambient recordings", Style::new().fg(theme.text()));
        y += 1;
        for credit in credits {
            y += 1;
            put(
                buf,
                inner.x + 2,
                y,
                &fit(&credit, usize::from(inner.width.saturating_sub(4))),
                Style::new().fg(theme.faint()),
            );
        }
    }
    put(
        buf,
        inner.x + 2,
        inner.bottom() - 1,
        "Mouse works too: click, drag the sliders, scroll the lists.",
        Style::new().fg(theme.faint()),
    );
}

fn stats(buf: &mut Buffer, screen: Rect, app: &App, ui: &mut Ui, now: Instant) {
    let theme = ui.theme;
    let inner = dialog(buf, screen, 64, 18, None, "Focus", ui);
    let days = &app.focus_days.days;
    let week: u32 = days.iter().map(|(_, minutes)| *minutes).sum();
    let x = put(buf, inner.x + 2, inner.y + 1, "today ", Style::new().fg(theme.faint()));
    let x = put(
        buf,
        x,
        inner.y + 1,
        &widgets::long_minutes(app.focus_days.today()),
        Style::new().fg(theme.text()).add_modifier(Modifier::BOLD),
    );
    let x = put(buf, x + 4, inner.y + 1, "last 7 days ", Style::new().fg(theme.faint()));
    put(
        buf,
        x,
        inner.y + 1,
        &widgets::long_minutes(week),
        Style::new().fg(theme.text()),
    );
    let bars: Vec<(String, u32, bool)> = days
        .iter()
        .enumerate()
        .map(|(index, (date, minutes))| {
            let label = date.strftime("%a").to_string();
            (label, *minutes, index + 1 == days.len())
        })
        .collect();
    let chart = Rect::new(
        inner.x + 2,
        inner.y + 3,
        inner.width.saturating_sub(4),
        inner.height.saturating_sub(5),
    );
    widgets::bar_chart(buf, chart, &bars, ui.stats_grow.value(now), &theme);
    put(
        buf,
        inner.x + 2,
        inner.bottom() - 1,
        "Counts every minute a focus block ran. Breaks never count.",
        Style::new().fg(theme.faint()),
    );
}

pub fn toasts(buf: &mut Buffer, footer: Rect, ui: &mut Ui, now: Instant) {
    let theme = ui.theme;
    let mut bottom = footer.y;
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
        let x = footer.right().saturating_sub(width + 1);
        let y = bottom.saturating_sub(3);
        if y < 1 {
            break;
        }
        let area = Rect::new(x, y, footer.right().saturating_sub(x + 1).min(width), 3);
        let color = match toast.tone {
            Tone::Info => theme.calm,
            Tone::Done => theme.rest,
            Tone::Error => theme.alert,
        };
        fill(buf, area, Style::new().bg(theme.background()));
        Block::bordered()
            .border_type(BorderType::Rounded)
            .border_style(Style::new().fg(theme.mix(0.3)))
            .render(area, buf);
        put(buf, area.x + 2, y + 1, "●", Style::new().fg(color));
        let message = fit(&toast.message, usize::from(area.width.saturating_sub(6)));
        put(buf, area.x + 4, y + 1, &message, Style::new().fg(theme.text()));
        widgets::dim(buf, area, fade, &theme, None);
        ui.hits.push((area, Hit::Toast(index)));
        bottom = y;
    }
}
