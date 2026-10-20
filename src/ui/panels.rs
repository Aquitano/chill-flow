use std::time::{Duration, Instant};

use ratatui::buffer::Buffer;
use ratatui::layout::{Margin, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Widget};
use unicode_width::UnicodeWidthStr;

use super::widgets::{self, fill, fit, meter, put, wrap};
use super::{Hit, Slider, Ui};
use crate::action::{Action, Panel, Prompt, Tab};
use crate::app::{App, Stream, format_clock};
use crate::model::{Repeat, Source};
use crate::timer::{Phase, TimerMode};

const TAB_SLIDE: Duration = Duration::from_millis(220);

fn panel(buf: &mut Buffer, area: Rect, title: &str, glow: f32, ui: &Ui) -> Rect {
    let theme = &ui.theme;
    let mut title_style = Style::new().fg(theme.emphasis(glow));
    if glow > 0.5 {
        title_style = title_style.add_modifier(Modifier::BOLD);
    }
    let block = Block::bordered()
        .border_type(BorderType::Rounded)
        .border_style(Style::new().fg(theme.mix(0.2 + 0.28 * glow)))
        .title(Line::from(vec![
            Span::raw(" "),
            Span::styled(title.to_string(), title_style),
            Span::raw(" "),
        ]));
    let inner = block.inner(area);
    block.render(area, buf);
    inner
}

fn centered(buf: &mut Buffer, area: Rect, y: u16, text: &str, style: Style) {
    let text = fit(text, usize::from(area.width));
    let x = area.x + area.width.saturating_sub(text.width() as u16) / 2;
    put(buf, x, y, &text, style);
}

fn scroll(selected: usize, offset: &mut usize, height: usize) {
    if height == 0 {
        return;
    }
    if selected < *offset {
        *offset = selected;
    } else if selected >= *offset + height {
        *offset = selected + 1 - height;
    }
}

pub fn header(buf: &mut Buffer, area: Rect, app: &App, ui: &mut Ui, now: Instant, show_timer: bool) {
    let theme = ui.theme;
    let minutes: Vec<u32> = app.focus_days.days.iter().map(|(_, minutes)| *minutes).collect();
    let today = widgets::long_minutes(app.focus_days.today());
    let spark = widgets::sparkline(&minutes);
    let width = (6 + today.width() + 2 + spark.width() + 1) as u16;
    let start = area.right().saturating_sub(width);
    let rect = Rect::new(start, area.y, width, 1);
    let label = if ui.hovered(rect) { theme.muted() } else { theme.faint() };
    let mut x = put(buf, start, area.y, "today ", Style::new().fg(label));
    x = put(buf, x, area.y, &today, Style::new().fg(theme.text()));
    x += 2;
    let count = spark.chars().count();
    for (index, ch) in spark.chars().enumerate() {
        let color = if index + 1 == count {
            theme.accent
        } else {
            theme.mix(0.45)
        };
        x = put(buf, x, area.y, &ch.to_string(), Style::new().fg(color));
    }
    ui.hit(rect, Hit::Act(Action::OpenStats));

    let mut right_edge = start;
    if show_timer {
        let timer = &app.timer;
        let remaining = timer.remaining(now).as_secs_f64().ceil() as u64;
        let label = format!("{} {:02}:{:02}", timer.phase().label(), remaining / 60, remaining % 60);
        let timer_x = start.saturating_sub(label.width() as u16 + 4);
        let color = match (timer.is_running(), timer.phase()) {
            (false, _) => theme.muted(),
            (true, Phase::Focus) => theme.accent,
            (true, Phase::Break) => theme.rest,
            (true, Phase::LongBreak) => theme.calm,
        };
        put(buf, timer_x, area.y, &label, Style::new().fg(color));
        ui.hit(
            Rect::new(timer_x, area.y, label.width() as u16, 1),
            Hit::Act(Action::TimerToggle),
        );
        right_edge = timer_x;
    }

    let glyph = match (app.is_playing(), ui.motion) {
        (true, true) => ["◐", "◓", "◑", "◒"][(now.duration_since(ui.started).as_millis() / 300) as usize % 4],
        (true, false) => "●",
        (false, _) => "○",
    };
    let mut x = put(buf, area.x + 1, area.y, glyph, Style::new().fg(theme.accent));
    x = put(
        buf,
        x + 1,
        area.y,
        "chill",
        Style::new().fg(theme.text()).add_modifier(Modifier::BOLD),
    );
    let room = |x: u16| usize::from(right_edge.saturating_sub(x + 2));
    if room(x + 3) < 8 {
        return;
    }
    x = put(
        buf,
        x + 3,
        area.y,
        &fit(&app.source_label(), room(x + 3)),
        Style::new().fg(theme.muted()),
    );
    if app.source != Source::Soundscape
        && let Some(mix) = &app.mix_name
    {
        put(
            buf,
            x,
            area.y,
            &fit(&format!(" + {mix}"), room(x)),
            Style::new().fg(theme.faint()),
        );
    }
}

pub fn footer(buf: &mut Buffer, area: Rect, app: &App, ui: &mut Ui) {
    let theme = ui.theme;
    let play = if app.is_playing() { "pause" } else { "play " };
    let mut hints: Vec<(&str, &str, Option<Action>)> = vec![
        ("space", play, Some(Action::TogglePlay)),
        ("n", "next", Some(Action::Next)),
        ("t", "timer", Some(Action::TimerToggle)),
    ];
    hints.extend(match ui.focus {
        Panel::Library => [("enter", "play", None), ("a", "queue", None), ("/", "filter", None)],
        Panel::Queue => [("enter", "jump", None), ("J/K", "move", None), ("d", "remove", None)],
        Panel::Ambience => [
            ("h/l", "level", None),
            ("0", "mute", None),
            ("[ ]", "mix", Some(Action::CycleMix(1))),
        ],
    });
    if ui.focus == Panel::Library
        && let Some(saved) = app.playlist_for_row(ui.selected[app.tab.index()])
    {
        hints.insert(0, ("R", "refresh", Some(Action::RefreshSaved(saved.id.clone()))));
    }
    hints.push(("o", "open link", Some(Action::OpenPrompt(Prompt::OpenUrl))));
    let mut pinned = vec![
        ("^p", "commands", Action::OpenPalette),
        ("c", "settings", Action::OpenSettings),
        ("?", "keys", Action::OpenHelp),
    ];
    if area.width < 80 {
        pinned.drain(..2);
    }
    // Typing goes into the filter, so the usual keys would only add letters to it.
    if ui.filtering {
        hints = vec![("enter", "done", None), ("esc", "clear", None), ("↑↓", "move", None)];
        pinned.clear();
    }

    let mut draw = |x: u16, (key, label, action): (&str, &str, Option<Action>), ui: &mut Ui| {
        let width = (key.width() + 1 + label.width()) as u16;
        let rect = Rect::new(x, area.y, width, 1);
        let label_color = if action.is_some() && ui.hovered(rect) {
            theme.text()
        } else {
            theme.faint()
        };
        let next = put(buf, x, area.y, key, Style::new().fg(theme.muted()));
        put(buf, next + 1, area.y, label, Style::new().fg(label_color));
        if let Some(action) = action {
            ui.hit(rect, Hit::Act(action));
        }
        width
    };
    let pinned_width: u16 = pinned
        .iter()
        .map(|(key, label, _)| (key.width() + 1 + label.width()) as u16 + 3)
        .sum();
    let mut right = area.right().saturating_sub(pinned_width);
    let limit = right;
    for (key, label, action) in pinned {
        right += draw(right, (key, label, Some(action)), ui) + 3;
    }
    let mut x = area.x + 1;
    for hint in hints {
        let width = (hint.0.width() + 1 + hint.1.width()) as u16;
        if x + width + 2 >= limit {
            break;
        }
        x += draw(x, hint, ui) + 3;
    }
}

pub fn library(buf: &mut Buffer, area: Rect, app: &App, ui: &mut Ui, now: Instant) {
    let theme = ui.theme;
    let glow = ui.panel_glow[0].value(now);
    let inner = panel(buf, area, "Library", glow, ui);
    ui.hit(area, Hit::Panel(Panel::Library));
    if inner.height < 4 {
        return;
    }

    let labels: usize = Tab::ALL.iter().map(|tab| tab.label().width()).sum();
    let gap = if labels + 2 * (Tab::ALL.len() - 1) < usize::from(inner.width) {
        2
    } else {
        1
    };
    let mut x = inner.x + if gap == 2 { 1 } else { 0 };
    for tab in Tab::ALL {
        let width = tab.label().width() as u16;
        if x + width > inner.right() {
            break;
        }
        let rect = Rect::new(x, inner.y, width, 1);
        let style = if app.tab == tab {
            Style::new().fg(theme.text()).add_modifier(Modifier::BOLD)
        } else if ui.hovered(rect) {
            Style::new().fg(theme.muted())
        } else {
            Style::new().fg(theme.faint())
        };
        put(buf, x, inner.y, tab.label(), style);
        ui.hit(rect, Hit::Act(Action::ShowTab(tab)));
        if app.tab == tab {
            let duration = ui.duration(TAB_SLIDE);
            if ui.tab_width.target() == 0.0 {
                ui.tab_x.jump(f32::from(x));
                ui.tab_width.jump(f32::from(width));
            }
            ui.tab_x.set(f32::from(x), now, duration);
            ui.tab_width.set(f32::from(width), now, duration);
        }
        x += width + gap;
    }
    let rule = Rect::new(inner.x, inner.y + 1, inner.width, 1);
    for column in rule.left()..rule.right() {
        put(buf, column, rule.y, "─", Style::new().fg(theme.line()));
    }
    let start = ui.tab_x.value(now).round() as u16;
    let width = ui.tab_width.value(now).round() as u16;
    for column in start..(start + width).min(rule.right()) {
        put(buf, column, rule.y, "━", Style::new().fg(theme.accent));
    }

    let show_filter = ui.filtering || !app.filter.is_empty();
    let list = Rect::new(
        inner.x,
        inner.y + 2,
        inner.width,
        inner.height - 2 - u16::from(show_filter),
    );
    if show_filter {
        let y = inner.bottom() - 1;
        let x = put(buf, inner.x + 1, y, "/ ", Style::new().fg(theme.accent));
        let x = put(buf, x, y, &app.filter, Style::new().fg(theme.text()));
        if ui.filtering {
            put(buf, x, y, "▏", Style::new().fg(theme.accent));
        }
    }

    let rows = app.rows(app.tab);
    let tab = app.tab.index();
    if rows.is_empty() {
        let message = match (app.tab, app.filter.is_empty()) {
            (_, false) => "Nothing matches the filter",
            (Tab::Tracks, _) => "The catalog has no tracks yet",
            (Tab::Liked, _) => "Press f while something plays to keep it here",
            (Tab::YouTube, _) => "Paste a YouTube link anywhere, or press o",
            (Tab::Sounds, _) => "No ambient sounds in the catalog",
            (Tab::Scenes, _) => "Save what plays as a scene from the command palette (^p)",
        };
        let lines = wrap(message, usize::from(list.width.saturating_sub(4)), 3);
        for (offset, line) in lines.iter().enumerate() {
            centered(
                buf,
                list,
                list.y + list.height / 3 + offset as u16,
                line,
                Style::new().fg(theme.faint()),
            );
        }
        return;
    }
    ui.selected[tab] = ui.selected[tab].min(rows.len() - 1);
    let selected = ui.selected[tab];
    scroll(selected, &mut ui.offsets[tab], usize::from(list.height));
    let focused = ui.focus == Panel::Library;

    for (index, row) in rows
        .iter()
        .enumerate()
        .skip(ui.offsets[tab])
        .take(usize::from(list.height))
    {
        let y = list.y + (index - ui.offsets[tab]) as u16;
        let rect = Rect::new(list.x, y, list.width, 1);
        let is_selected = index == selected;
        let hovered = ui.hovered(rect);
        let background = match (is_selected, focused, hovered) {
            (true, true, _) => Some(theme.surface()),
            (true, false, _) | (false, _, true) => Some(theme.hover()),
            _ => None,
        };
        if let Some(background) = background {
            fill(buf, rect, Style::new().bg(background));
        }
        if is_selected {
            put(
                buf,
                rect.x,
                y,
                "▎",
                Style::new().fg(if focused { theme.accent } else { theme.faint() }),
            );
        }
        let is_current = row.current;

        let meta_width = row.meta.width() as u16;
        let meta_x = rect.right().saturating_sub(meta_width + 1);
        put(buf, meta_x, y, &row.meta, Style::new().fg(theme.faint()));
        let heart_x = meta_x.saturating_sub(2);
        ui.hit(rect, Hit::Row(index));
        if let Some(key) = &row.like_key {
            let heart_rect = Rect::new(heart_x, y, 1, 1);
            let liked = app.is_liked(key);
            let (symbol, color) = match (liked, is_selected || hovered) {
                (true, _) => ("♥", theme.accent),
                (false, true) => (
                    "♡",
                    if ui.hovered(heart_rect) {
                        theme.text()
                    } else {
                        theme.faint()
                    },
                ),
                (false, false) => (" ", theme.faint()),
            };
            put(buf, heart_x, y, symbol, Style::new().fg(color));
            ui.hit(heart_rect, Hit::Act(Action::ToggleLikeRow(index)));
        }

        let text_x = rect.x + 2;
        let available = usize::from(heart_x.saturating_sub(text_x + 1));
        let mut title_style = Style::new().fg(if is_current { theme.accent } else { theme.text() });
        if is_selected && focused {
            title_style = title_style.add_modifier(Modifier::BOLD);
        }
        let title = fit(&row.title, available);
        let after = put(buf, text_x, y, &title, title_style);
        let room = available.saturating_sub(title.width() + 2);
        if room > 8 && !row.detail.is_empty() {
            put(
                buf,
                after + 2,
                y,
                &fit(&row.detail, room),
                Style::new().fg(theme.faint()),
            );
        }
    }
}

pub fn player(buf: &mut Buffer, area: Rect, app: &mut App, ui: &mut Ui, now: Instant) {
    let theme = ui.theme;
    let inner = area.inner(Margin {
        horizontal: 2,
        vertical: 1,
    });
    if inner.height < 7 || inner.width < 30 {
        return;
    }
    let item = app.current().cloned();
    let soundscape = app.source == Source::Soundscape;

    let controls_y = inner.bottom() - 1;
    let progress_y = controls_y.saturating_sub(2);
    let cover_height = (inner.height * 3 / 10)
        .clamp(5, 12)
        .min(progress_y.saturating_sub(inner.y + 1));
    let aspect = ui.cover_for(item.as_ref().and_then(|item| item.cover.as_deref()));
    let cover_width = ((f32::from(cover_height) * 2.0 * aspect.unwrap_or(1.0)).round() as u16).min(inner.width / 2);
    let cover = Rect::new(inner.x, inner.y, cover_width, cover_height);
    fill(buf, cover, Style::new().bg(theme.surface()));
    let (glyph, glyph_color) = if soundscape {
        ("≋", theme.calm)
    } else {
        ("♪", theme.faint())
    };
    put(
        buf,
        cover.x + cover.width / 2,
        cover.y + cover.height / 2,
        glyph,
        Style::new().fg(glyph_color).bg(theme.surface()),
    );
    if aspect.is_some() {
        ui.cover_rect = Some(cover);
    }

    let meta_x = cover.right() + 3;
    let meta_width = inner.right().saturating_sub(meta_x);
    let meta_y = cover.y + cover.height.saturating_sub(5) / 2;
    let width = usize::from(meta_width);
    let (title, artist, detail) = match (&item, soundscape) {
        (_, true) => {
            let sounds = app.sound_labels(&app.levels);
            let detail = if sounds.is_empty() {
                "turn a sound up on the right".into()
            } else {
                sounds.join(" · ")
            };
            (
                app.mix_name.clone().unwrap_or_else(|| "Ambience".into()),
                "ambience only".into(),
                detail,
            )
        }
        (Some(item), false) => {
            let mut detail = item.origin().to_string();
            if let Some(duration) = item.duration {
                detail.push_str(&format!(" · {}", format_clock(duration)));
            }
            (item.title.clone(), item.artist.clone(), detail)
        }
        (None, false) => (
            "Nothing playing".into(),
            "Pick something in the library, or paste a YouTube link".into(),
            String::new(),
        ),
    };
    let shown = ui.title_shown.value(now);
    put(
        buf,
        meta_x,
        meta_y,
        &fit(&title, width),
        Style::new().fg(theme.emphasis(shown)).add_modifier(Modifier::BOLD),
    );
    put(
        buf,
        meta_x,
        meta_y + 1,
        &fit(&artist, width),
        Style::new().fg(theme.muted()),
    );
    put(
        buf,
        meta_x,
        meta_y + 2,
        &fit(&detail, width),
        Style::new().fg(theme.faint()),
    );

    let status_y = meta_y + 4;
    let mut x = meta_x;
    if let Some(item) = item.as_ref().filter(|_| !soundscape && status_y < progress_y) {
        let liked = app.is_liked(&item.key);
        let pop = ui.heart.value(now);
        let heart_rect = Rect::new(meta_x, status_y, 2, 1);
        let (symbol, mut style) = if liked {
            ("♥", Style::new().fg(theme.accent))
        } else {
            (
                "♡",
                Style::new().fg(if ui.hovered(heart_rect) {
                    theme.text()
                } else {
                    theme.faint()
                }),
            )
        };
        if pop > 0.2 {
            style = style.add_modifier(Modifier::BOLD);
        }
        x = put(buf, x, status_y, symbol, style);
        if pop > 0.05 {
            let sparkle = if pop > 0.6 { "✦" } else { "·" };
            put(
                buf,
                x,
                status_y.saturating_sub(1),
                sparkle,
                Style::new().fg(theme.accent),
            );
        }
        ui.hit(heart_rect, Hit::Act(Action::ToggleLikeCurrent));
        x += 2;
    }
    let spin = if ui.motion {
        widgets::spinner(ui.started, now)
    } else {
        "…"
    };
    let status: Option<(String, Style)> = match (&item, soundscape) {
        (Some(_), false) if app.stream == Stream::Resolving => {
            Some((format!("{spin} finding the stream"), Style::new().fg(theme.muted())))
        }
        (Some(_), false) if app.engine.is_buffering() && app.is_playing() => {
            Some((format!("{spin} buffering"), Style::new().fg(theme.muted())))
        }
        (Some(item), false) if item.is_live() => Some(("● live".into(), Style::new().fg(theme.alert))),
        _ if !app.is_playing() => Some(("paused".into(), Style::new().fg(theme.faint()))),
        _ => None,
    };
    if let Some((text, style)) = status.filter(|_| status_y < progress_y) {
        put(buf, x, status_y, &text, style);
    }

    let viz_top = cover.bottom() + 1;
    let viz = Rect::new(inner.x, viz_top, inner.width, progress_y.saturating_sub(viz_top + 1));
    if ui.motion && viz.height >= 2 {
        let count = usize::from((viz.width / 3).clamp(8, 64));
        ui.bars.resize(count);
        widgets::spectrum(buf, viz, &ui.bars.levels, &ui.bars.peaks, &theme);
    }

    match &item {
        Some(item) if !soundscape => {
            let left = Rect::new(inner.x, progress_y, inner.width, 1);
            if item.is_live() {
                let label = format!("live · {}", format_clock(app.position() as u32));
                put(buf, left.x, progress_y, &label, Style::new().fg(theme.muted()));
                let bar = Rect::new(
                    left.x + label.width() as u16 + 2,
                    progress_y,
                    inner.width.saturating_sub(label.width() as u16 + 2),
                    1,
                );
                meter(
                    buf,
                    bar,
                    1.0,
                    Style::new().fg(theme.mix(0.4)),
                    Style::new().fg(theme.line()),
                );
            } else {
                let position = ui.seek_preview.unwrap_or_else(|| app.position());
                let total = item.duration.map_or(0.0, f64::from);
                let elapsed_label = format_clock(position as u32);
                let total_label = item.duration.map(format_clock).unwrap_or_else(|| "--:--".into());
                let bar_x = left.x + 7;
                let bar_width = inner.width.saturating_sub(14);
                put(
                    buf,
                    left.x,
                    progress_y,
                    &format!("{elapsed_label:>5}"),
                    Style::new().fg(theme.muted()),
                );
                put(
                    buf,
                    bar_x + bar_width + 2,
                    progress_y,
                    &total_label,
                    Style::new().fg(theme.faint()),
                );
                let bar = Rect::new(bar_x, progress_y, bar_width, 1);
                let fraction = if total > 0.0 { position / total } else { 0.0 };
                let filled = if ui.hovered(bar) || ui.seek_preview.is_some() {
                    theme.text()
                } else {
                    theme.accent
                };
                meter(
                    buf,
                    bar,
                    fraction,
                    Style::new().fg(filled),
                    Style::new().fg(theme.line()),
                );
                ui.hit(bar, Hit::Seek);
            }
        }
        _ => {}
    }

    controls(buf, inner, controls_y, app, ui);
}

fn controls(buf: &mut Buffer, inner: Rect, y: u16, app: &App, ui: &mut Ui) {
    let theme = ui.theme;
    let repeat_label = match app.queue.repeat {
        Repeat::One => "repeat 1",
        _ => "repeat  ",
    };
    // Each pill is padded evenly around its glyph; the slot keeps the row still when the
    // narrower play pill replaces pause.
    let play = if app.is_playing() { " ❚❚ " } else { " ▶ " };
    let play_slot = 4;
    let buttons: [(&str, Action, bool); 5] = [
        ("shuffle", Action::ToggleShuffle, app.queue.shuffle),
        ("◂◂", Action::Previous, false),
        (play, Action::TogglePlay, true),
        ("▸▸", Action::Next, false),
        (repeat_label, Action::CycleRepeat, app.queue.repeat != Repeat::Off),
    ];
    let gap = if inner.width >= 80 { 4 } else { 3 };
    let slot = |index: usize, label: &str| if index == 2 { play_slot } else { label.width() as u16 };
    let total: u16 = buttons
        .iter()
        .enumerate()
        .map(|(index, (label, ..))| slot(index, label))
        .sum::<u16>()
        + gap * 4;
    let volume_width = 22;
    let start = if inner.width >= total + 2 * (volume_width + 2) {
        inner.x + (inner.width - total) / 2
    } else {
        inner.x
    };
    let soundscape = app.source == Source::Soundscape;
    let mut x = start;
    for (index, (label, action, on)) in buttons.into_iter().enumerate() {
        let rect = Rect::new(x, y, label.width() as u16, 1);
        if soundscape && index != 2 {
            put(buf, x, y, label, Style::new().fg(theme.line()));
            x += slot(index, label) + gap;
            continue;
        }
        let hovered = ui.hovered(rect);
        let style = match index {
            2 => {
                let background = if hovered { theme.mix(0.16) } else { theme.surface() };
                Style::new()
                    .fg(theme.accent)
                    .bg(background)
                    .add_modifier(Modifier::BOLD)
            }
            1 | 3 => Style::new().fg(if hovered { theme.accent } else { theme.text() }),
            _ => Style::new().fg(match (on, hovered) {
                (true, _) => theme.accent,
                (false, true) => theme.muted(),
                (false, false) => theme.faint(),
            }),
        };
        put(buf, x, y, label, style);
        ui.hit(rect, Hit::Act(action));
        x += slot(index, label) + gap;
    }

    let bar_width = inner.right().saturating_sub(x + 11).min(13);
    if bar_width >= 4 {
        let volume_x = inner.right().saturating_sub(bar_width + 9);
        let label_end = put(buf, volume_x, y, "vol ", Style::new().fg(theme.faint()));
        let bar = Rect::new(label_end, y, bar_width, 1);
        let shown = ui.volume.value(Instant::now());
        let filled = if ui.hovered(bar) { theme.text() } else { theme.muted() };
        meter(
            buf,
            bar,
            f64::from(shown),
            Style::new().fg(filled),
            Style::new().fg(theme.line()),
        );
        put(
            buf,
            bar.right() + 1,
            y,
            &format!("{:>3}", (app.volume * 100.0).round()),
            Style::new().fg(theme.faint()),
        );
        ui.hit(bar, Hit::Slider(Slider::Volume));
    }
}

pub fn queue(buf: &mut Buffer, area: Rect, app: &App, ui: &mut Ui) {
    let theme = ui.theme;
    let glow = ui.panel_glow[1].value(Instant::now());
    let upcoming: Vec<_> = if app.source == Source::Soundscape {
        Vec::new()
    } else {
        app.queue.upcoming().collect()
    };
    let title = if upcoming.is_empty() {
        "Up next".to_string()
    } else {
        format!("Up next · {}", upcoming.len())
    };
    let inner = panel(buf, area, &title, glow, ui);
    ui.hit(area, Hit::Panel(Panel::Queue));
    if upcoming.is_empty() {
        let message = if app.source == Source::Soundscape {
            "Pick a track to bring the music back"
        } else {
            "Nothing up next"
        };
        centered(
            buf,
            inner,
            inner.y + inner.height / 2,
            message,
            Style::new().fg(theme.faint()),
        );
        return;
    }
    ui.queue_selected = ui.queue_selected.min(upcoming.len() - 1);
    scroll(ui.queue_selected, &mut ui.queue_offset, usize::from(inner.height));
    let focused = ui.focus == Panel::Queue;
    for (index, item) in upcoming
        .iter()
        .enumerate()
        .skip(ui.queue_offset)
        .take(usize::from(inner.height))
    {
        let y = inner.y + (index - ui.queue_offset) as u16;
        let rect = Rect::new(inner.x, y, inner.width, 1);
        let is_selected = focused && index == ui.queue_selected;
        if is_selected {
            fill(buf, rect, Style::new().bg(theme.surface()));
            put(buf, rect.x, y, "▎", Style::new().fg(theme.accent));
        } else if ui.hovered(rect) {
            fill(buf, rect, Style::new().bg(theme.hover()));
        }
        let duration = if item.is_live() {
            "live".to_string()
        } else {
            item.duration.map(format_clock).unwrap_or_default()
        };
        let duration_x = rect.right().saturating_sub(duration.width() as u16 + 1);
        put(buf, duration_x, y, &duration, Style::new().fg(theme.faint()));
        let x = put(
            buf,
            rect.x + 2,
            y,
            &format!("{:>2}", index + 1),
            Style::new().fg(theme.faint()),
        );
        let available = usize::from(duration_x.saturating_sub(x + 3));
        let title = fit(&item.title, available);
        let after = put(buf, x + 2, y, &title, Style::new().fg(theme.text()));
        let room = available.saturating_sub(title.width() + 2);
        if room > 8 && !item.artist.is_empty() {
            put(
                buf,
                after + 2,
                y,
                &fit(&item.artist, room),
                Style::new().fg(theme.faint()),
            );
        }
        ui.hit(rect, Hit::Queue(index));
    }
}

/// Returns whether the clock fit, since the header shows the timer when it didn't.
pub fn focus(buf: &mut Buffer, area: Rect, app: &App, ui: &mut Ui, now: Instant) -> bool {
    let theme = ui.theme;
    let timer = &app.timer;
    let glow = ui.glow.value(now).max(if timer.is_running() { 0.25 } else { 0.0 });
    let inner = panel(buf, area, "Focus", glow, ui);
    if inner.height < 8 || inner.width < 34 {
        return false;
    }
    let phase_color = match timer.phase() {
        Phase::Focus => theme.accent,
        Phase::Break => theme.rest,
        Phase::LongBreak => theme.calm,
    };

    let remaining = timer.remaining(now).as_secs_f64().ceil() as u64;
    let clock = format!("{:02}:{:02}", remaining / 60, remaining % 60);
    let width = widgets::clock_width(&clock);
    let clock_x = inner.x + inner.width.saturating_sub(width) / 2;
    let clock_y = inner.y + 1;
    let digits = if timer.is_running() {
        theme.text()
    } else {
        theme.muted()
    };
    let blink_off = ui.motion && timer.is_running() && now.duration_since(ui.started).as_millis() % 1000 >= 500;
    let colon = if blink_off { theme.mix(0.4) } else { digits };
    widgets::big_clock(
        buf,
        clock_x,
        clock_y,
        &clock,
        Style::new().fg(digits),
        Style::new().fg(colon),
    );

    let label = match timer.cycle() {
        Some((block, of)) => format!("{} · {block} of {of}", timer.phase().label()),
        None => format!(
            "{} · {} min",
            timer.phase().label(),
            timer.phase_length().as_secs() / 60
        ),
    };
    let label_color = if timer.is_running() { phase_color } else { theme.muted() };
    centered(buf, inner, clock_y + 4, &label, Style::new().fg(label_color));
    let bar_width = inner.width.saturating_sub(8);
    let bar = Rect::new(inner.x + (inner.width - bar_width) / 2, clock_y + 5, bar_width, 1);
    meter(
        buf,
        bar,
        timer.progress(now),
        Style::new().fg(phase_color),
        Style::new().fg(theme.line()),
    );

    let buttons_y = inner.bottom().saturating_sub(3);
    let [start, pause] = ["▶ start ", "❚❚ pause"];
    let start_label = if timer.is_running() { pause } else { start };
    let buttons = [
        (start_label, Action::TimerToggle),
        ("↺ reset", Action::TimerReset),
        ("skip ▸▸", Action::TimerSkip),
    ];
    let total: u16 = buttons.iter().map(|(label, _)| label.width() as u16 + 2).sum::<u16>() + 4;
    let mut x = inner.x + inner.width.saturating_sub(total) / 2;
    for (index, (label, action)) in buttons.into_iter().enumerate() {
        let rect = Rect::new(x, buttons_y, label.width() as u16 + 2, 1);
        let hovered = ui.hovered(rect);
        let mut style = Style::new().fg(if index == 0 { theme.text() } else { theme.muted() });
        if hovered || index == 0 {
            style = style.bg(if hovered { theme.mix(0.16) } else { theme.surface() });
        }
        put(buf, x, buttons_y, &format!(" {label} "), style);
        ui.hit(rect, Hit::Act(action));
        x += rect.width + 2;
    }

    let presets_y = inner.bottom() - 1;
    let labels: Vec<(TimerMode, String)> = TimerMode::PRESETS.iter().map(|mode| (*mode, mode.label())).collect();
    let total: u16 = labels.iter().map(|(_, label)| label.width() as u16).sum::<u16>() + 3 * (labels.len() as u16 - 1);
    let mut x = inner.x + inner.width.saturating_sub(total) / 2;
    for (mode, label) in labels {
        let rect = Rect::new(x, presets_y, label.width() as u16, 1);
        let style = if mode == timer.mode() {
            Style::new().fg(theme.accent).add_modifier(Modifier::BOLD)
        } else if ui.hovered(rect) {
            Style::new().fg(theme.text())
        } else {
            Style::new().fg(theme.faint())
        };
        put(buf, x, presets_y, &label, style);
        ui.hit(rect, Hit::Act(Action::SetTimerMode(mode)));
        x += rect.width + 3;
    }
    true
}

pub fn ambience(buf: &mut Buffer, area: Rect, app: &App, ui: &mut Ui, now: Instant) {
    let theme = ui.theme;
    let glow = ui.panel_glow[2].value(now);
    let inner = panel(buf, area, "Ambience", glow, ui);
    ui.hit(area, Hit::Panel(Panel::Ambience));
    if inner.height < 3 || inner.width < 20 {
        return;
    }
    let name = match (&app.mix_name, app.levels.is_empty()) {
        (Some(name), _) => name.clone(),
        (None, true) => "silence".into(),
        (None, false) => "your mix".into(),
    };
    let name_color = if app.mix_name.is_some() {
        theme.text()
    } else {
        theme.muted()
    };
    centered(buf, inner, inner.y, &name, Style::new().fg(name_color));
    for (symbol, x, step) in [("‹", inner.x + 1, -1), ("›", inner.right() - 2, 1)] {
        let rect = Rect::new(x.saturating_sub(1), inner.y, 3, 1);
        let color = if ui.hovered(rect) { theme.accent } else { theme.muted() };
        put(buf, x, inner.y, symbol, Style::new().fg(color));
        ui.hit(rect, Hit::Act(Action::CycleMix(step)));
    }

    let show_balance = inner.height >= 8 && inner.width >= 30;
    if show_balance {
        balance(buf, Rect::new(inner.x, inner.y + 2, inner.width, 1), app, ui);
    }
    let top = if show_balance { 4 } else { 2 };
    let list = Rect::new(inner.x, inner.y + top, inner.width, inner.height.saturating_sub(top));
    let count = app.catalog.ambient.len();
    if count == 0 || list.height == 0 {
        return;
    }
    ui.sound_selected = ui.sound_selected.min(count - 1);
    scroll(ui.sound_selected, &mut ui.sound_offset, usize::from(list.height));
    let focused = ui.focus == Panel::Ambience;
    for (index, sound) in app
        .catalog
        .ambient
        .iter()
        .enumerate()
        .skip(ui.sound_offset)
        .take(usize::from(list.height))
    {
        let y = list.y + (index - ui.sound_offset) as u16;
        let rect = Rect::new(list.x, y, list.width, 1);
        let is_selected = focused && index == ui.sound_selected;
        if is_selected {
            fill(buf, rect, Style::new().bg(theme.surface()));
            put(buf, rect.x, y, "▎", Style::new().fg(theme.accent));
        }
        let level = app.levels.get(&sound.id).copied().unwrap_or(0);
        let shown = ui
            .levels
            .get(&sound.id)
            .map_or(f32::from(level) / 100.0, |tween| tween.value(now));
        let label_color = if level > 0 { theme.text() } else { theme.muted() };
        let label_width = (rect.width / 3).clamp(6, 12);
        put(
            buf,
            rect.x + 2,
            y,
            &fit(&sound.label, usize::from(label_width)),
            Style::new().fg(label_color),
        );
        let slider_x = rect.x + label_width + 3;
        let slider = Rect::new(slider_x, y, rect.right().saturating_sub(slider_x + 5), 1);
        let filled = if ui.hovered(slider) { theme.text() } else { theme.calm };
        meter(
            buf,
            slider,
            f64::from(shown),
            Style::new().fg(filled),
            Style::new().fg(theme.line()),
        );
        if level > 0 {
            put(
                buf,
                slider.right() + 1,
                y,
                &format!("{level:>3}"),
                Style::new().fg(theme.faint()),
            );
        }
        ui.hit(rect, Hit::Sound(index));
        ui.hit(slider, Hit::Slider(Slider::Level(sound.id.clone())));
    }
}

/// Music on the left, ambience on the right. A soundscape has no music to weigh against, so the
/// row rests there.
fn balance(buf: &mut Buffer, row: Rect, app: &App, ui: &mut Ui) {
    let theme = ui.theme;
    let width = row.width.saturating_sub(21);
    let slider = Rect::new(row.x + 9, row.y, width.saturating_sub(1 - width % 2), 1);
    let active = app.source != Source::Soundscape;
    let hovered = active && ui.hovered(slider);
    let label = Style::new().fg(match (active, hovered) {
        (false, _) => theme.line(),
        (true, true) => theme.text(),
        (true, false) => theme.muted(),
    });
    put(buf, row.x + 2, row.y, "music", label);
    put(buf, row.right().saturating_sub(10), row.y, "ambience", label);
    let (knob, filled) = if active {
        (theme.text(), if hovered { theme.text() } else { theme.calm })
    } else {
        (theme.line(), theme.line())
    };
    widgets::balance(
        buf,
        slider,
        app.balance,
        Style::new().fg(knob),
        Style::new().fg(filled),
        Style::new().fg(theme.line()),
    );
    if active {
        ui.hit(slider, Hit::Slider(Slider::Balance));
    }
}
