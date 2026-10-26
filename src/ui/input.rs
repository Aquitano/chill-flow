use crossterm::event::{Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
use ratatui::layout::Rect;

use super::overlay;
use super::{Drag, Hit, Overlay, Slider, Ui};
use crate::action::{Action, Panel, Prompt, Removal, Setting, Tab};
use crate::app::{App, Tone};
use crate::youtube;

/// Folds a burst of plain characters into one paste. Windows consoles deliver a paste as
/// separate keypresses, which would otherwise fire a shortcut per character.
pub fn coalesce(events: Vec<Event>) -> Vec<Event> {
    const PASTE_MIN: usize = 8;
    let mut out = Vec::with_capacity(events.len());
    let mut run = String::new();
    let flush = |run: &mut String, out: &mut Vec<Event>| {
        let first = run.chars().next();
        // A held key repeats one character, and a stalled frame must not turn that into a paste.
        if run.chars().count() >= PASTE_MIN && run.chars().any(|ch| Some(ch) != first) {
            out.push(Event::Paste(std::mem::take(run)));
        } else {
            out.extend(
                run.drain(..)
                    .map(|ch| Event::Key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE))),
            );
        }
    };
    for event in events {
        match event {
            Event::Key(KeyEvent {
                kind: KeyEventKind::Release,
                ..
            }) => {}
            Event::Key(KeyEvent {
                code: KeyCode::Char(ch),
                modifiers,
                ..
            }) if (modifiers - KeyModifiers::SHIFT).is_empty() => {
                run.push(ch);
            }
            other => {
                flush(&mut run, &mut out);
                out.push(other);
            }
        }
    }
    flush(&mut run, &mut out);
    out
}

pub fn handle(app: &mut App, ui: &mut Ui, event: Event) {
    match event {
        Event::Key(key) if key.kind != KeyEventKind::Release => key_pressed(app, ui, key),
        Event::Mouse(mouse) => mouse_event(app, ui, mouse),
        Event::Paste(text) => pasted(app, ui, &text),
        _ => {}
    }
}

/// Runs an action, keeping the UI-only ones (focus, overlays, tabs) on this side.
pub fn apply(app: &mut App, ui: &mut Ui, action: Action) {
    match action {
        Action::ShowTab(tab) => {
            app.library_hidden = false;
            ui.show_tab(app, tab);
            ui.set_focus(Panel::Library);
        }
        Action::ToggleLibraryPanel | Action::ToggleSidePanel => {
            let panel = if action == Action::ToggleLibraryPanel {
                Panel::Library
            } else {
                Panel::Ambience
            };
            app.dispatch(action);
            if app.library_hidden && ui.filtering {
                ui.filtering = false;
                app.filter.clear();
            }
            // Where panels share one place, only the focused one shows, so a side that comes back
            // takes the focus.
            if app.panel_hidden(panel) {
                ui.keep_focus_visible(app);
            } else {
                ui.set_focus(panel);
            }
        }
        Action::Focus(panel) if !app.panel_hidden(panel) => ui.set_focus(panel),
        Action::Focus(_) => {}
        Action::OpenPrompt(kind) => ui.open(Overlay::Prompt {
            kind,
            input: String::new(),
        }),
        Action::OpenPalette => ui.open(Overlay::Palette {
            query: String::new(),
            selected: 0,
        }),
        Action::OpenHelp => ui.open(Overlay::Help { scroll: 0 }),
        Action::OpenDiagnostics => ui.open(Overlay::Diagnostics {
            selected: app
                .diagnostics
                .latest_pending()
                .or_else(|| app.diagnostics.entries().last())
                .map_or(0, |entry| entry.id),
            scroll: 0,
        }),
        Action::OpenStats => ui.open(Overlay::Stats),
        Action::OpenSettings => ui.open(Overlay::Settings { selected: 0 }),
        Action::RemoveRow(index) => {
            if let Some((removal, title)) = app.removal(index) {
                let message = format!("Remove \"{title}\" from {}?", app.tab.label());
                ui.open(Overlay::Confirm {
                    message,
                    action: Action::Remove(removal),
                });
            }
        }
        Action::TurnOffSync => ui.open(Overlay::Confirm {
            message: "Turn off sync? This machine keeps its library and stops syncing.".into(),
            action: Action::LeaveSync,
        }),
        Action::DeleteSyncData => ui.open(Overlay::Confirm {
            message:
                "Delete everything sync keeps on the server? Every machine stops syncing; each keeps its own library."
                    .into(),
            action: Action::EraseSyncData,
        }),
        Action::CopySyncKey => {
            if let Some(key) = app.sync_key().map(str::to_string) {
                // OSC 52 reaches the system clipboard in Ghostty and Windows Terminal; the toast
                // shows the key too, for terminals that ignore it.
                let _ = crossterm::execute!(
                    std::io::stdout(),
                    crossterm::clipboard::CopyToClipboard::to_clipboard_from(&key)
                );
                app.toast(Tone::Done, format!("Copied the sync key: {key}"));
            }
        }
        Action::Remove(Removal::Catalog(url)) => {
            let name = app
                .added_catalogs()
                .find(|(known, _)| *known == url)
                .map_or_else(|| url.clone(), |(_, name)| name);
            ui.open(Overlay::Confirm {
                message: format!("Remove the catalog \"{name}\"? Its tracks leave Tracks."),
                action: Action::Remove(Removal::Catalog(url)),
            });
        }
        action => app.dispatch(action),
    }
}

fn pasted(app: &mut App, ui: &mut Ui, text: &str) {
    match &mut ui.overlay {
        Some(Overlay::Prompt { input, .. }) => input.push_str(text.trim()),
        Some(Overlay::Palette { query, selected }) => {
            query.push_str(text.trim());
            *selected = 0;
        }
        Some(_) => {}
        None if ui.filtering => app.filter.push_str(text.trim()),
        None if youtube::looks_like_url(text) => app.open_url(text.trim()),
        None => {}
    }
}

/// Ctrl without Alt. Windows reports AltGr as Ctrl+Alt, and AltGr only types characters.
fn chord(key: &KeyEvent) -> bool {
    key.modifiers.contains(KeyModifiers::CONTROL) && !key.modifiers.contains(KeyModifiers::ALT)
}

fn key_pressed(app: &mut App, ui: &mut Ui, key: KeyEvent) {
    let ctrl = chord(&key);
    if ctrl && key.code == KeyCode::Char('c') {
        app.quit = true;
        return;
    }
    if ui.overlay.is_some() {
        overlay_key(app, ui, key);
        return;
    }
    if ui.filtering {
        filter_key(app, ui, key);
        return;
    }
    if ctrl && key.code == KeyCode::Char('p') {
        return apply(app, ui, Action::OpenPalette);
    }
    if ctrl {
        return;
    }
    if key.code == KeyCode::Char('/') {
        app.library_hidden = false;
        ui.set_focus(Panel::Library);
        ui.filtering = true;
        return;
    }
    let global = match key.code {
        KeyCode::Char(' ') => Some(Action::TogglePlay),
        KeyCode::Char('q') => Some(Action::Quit),
        KeyCode::Char('n') => Some(Action::Next),
        KeyCode::Char('p') => Some(Action::Previous),
        KeyCode::Char(',') => Some(Action::SeekBy(-10.0)),
        KeyCode::Char('.') => Some(Action::SeekBy(10.0)),
        KeyCode::Char('+') | KeyCode::Char('=') => Some(Action::VolumeBy(0.05)),
        KeyCode::Char('-') => Some(Action::VolumeBy(-0.05)),
        KeyCode::Char('<') => Some(Action::BalanceBy(-0.1)),
        KeyCode::Char('>') => Some(Action::BalanceBy(0.1)),
        KeyCode::Char('f') => Some(Action::ToggleLikeCurrent),
        KeyCode::Char('s') => Some(Action::ToggleShuffle),
        KeyCode::Char('r') => Some(Action::CycleRepeat),
        KeyCode::Char('t') => Some(Action::TimerToggle),
        KeyCode::Char('T') => Some(Action::TimerReset),
        KeyCode::Char('x') => Some(Action::TimerSkip),
        KeyCode::Char('m') => Some(Action::CycleTimerMode),
        KeyCode::Char('M') => Some(Action::ToggleMusic),
        KeyCode::Char('F') => Some(Action::ToggleTimerPanel),
        KeyCode::Char('H') => Some(Action::ToggleLibraryPanel),
        KeyCode::Char('L') => Some(Action::ToggleSidePanel),
        KeyCode::Char('v') => Some(Action::AdjustSetting(Setting::Picture, 1)),
        KeyCode::Char('o') => Some(Action::OpenPrompt(Prompt::OpenUrl)),
        KeyCode::Char(':') => Some(Action::OpenPalette),
        KeyCode::Char('?') => Some(Action::OpenHelp),
        KeyCode::Char('i') => Some(Action::OpenStats),
        KeyCode::Char('D') => Some(Action::OpenDiagnostics),
        KeyCode::Char('c') => Some(Action::OpenSettings),
        KeyCode::Char('[') => Some(Action::CycleMix(-1)),
        KeyCode::Char(']') => Some(Action::CycleMix(1)),
        KeyCode::Char(digit @ '1'..='5') => Tab::ALL
            .get(digit as usize - '1' as usize)
            .map(|tab| Action::ShowTab(*tab)),
        KeyCode::Tab => Some(Action::Focus(next_panel(app, ui.focus, 1))),
        KeyCode::BackTab => Some(Action::Focus(next_panel(app, ui.focus, -1))),
        _ => None,
    };
    if let Some(action) = global {
        return apply(app, ui, action);
    }
    match ui.focus {
        Panel::Library => library_key(app, ui, key),
        Panel::Queue => queue_key(app, ui, key),
        Panel::Ambience => ambience_key(app, ui, key),
    }
}

/// The next panel that's showing; the queue always is.
fn next_panel(app: &App, panel: Panel, step: isize) -> Panel {
    const ORDER: [Panel; 3] = [Panel::Library, Panel::Queue, Panel::Ambience];
    let index = ORDER.iter().position(|candidate| *candidate == panel).unwrap_or(0) as isize;
    (1..=3)
        .map(|offset| ORDER[(index + step * offset).rem_euclid(3) as usize])
        .find(|panel| !app.panel_hidden(*panel))
        .unwrap_or(Panel::Queue)
}

fn moved(current: usize, len: usize, key: KeyCode) -> Option<usize> {
    let last = len.checked_sub(1)?;
    Some(match key {
        KeyCode::Up | KeyCode::Char('k') => current.saturating_sub(1),
        KeyCode::Down | KeyCode::Char('j') => (current + 1).min(last),
        KeyCode::PageUp => current.saturating_sub(10),
        KeyCode::PageDown => (current + 10).min(last),
        KeyCode::Home | KeyCode::Char('g') => 0,
        KeyCode::End | KeyCode::Char('G') => last,
        _ => return None,
    })
}

fn library_key(app: &mut App, ui: &mut Ui, key: KeyEvent) {
    let tab = app.tab.index();
    let len = app.rows(app.tab).len();
    if let Some(index) = moved(ui.selected[tab], len, key.code) {
        ui.selected[tab] = index;
        return;
    }
    let selected = ui.selected[tab];
    let action = match key.code {
        KeyCode::Left | KeyCode::Char('h') => Action::ShowTab(Tab::ALL[(tab + 4) % 5]),
        KeyCode::Right | KeyCode::Char('l') => Action::ShowTab(Tab::ALL[(tab + 1) % 5]),
        KeyCode::Enter => Action::Activate(selected),
        KeyCode::Char('a') => Action::Enqueue(selected),
        KeyCode::Char('R') => {
            let Some(saved) = app.playlist_for_row(selected) else {
                return;
            };
            Action::RefreshSaved(saved.id.clone())
        }
        KeyCode::Char('d') | KeyCode::Delete if len > 0 => Action::RemoveRow(selected),
        KeyCode::Esc => {
            app.filter.clear();
            return;
        }
        _ => return,
    };
    apply(app, ui, action);
}

fn filter_key(app: &mut App, ui: &mut Ui, key: KeyEvent) {
    let tab = app.tab.index();
    match key.code {
        KeyCode::Esc => {
            ui.filtering = false;
            app.filter.clear();
        }
        KeyCode::Enter => {
            ui.filtering = false;
            if app.rows(app.tab).len() == 1 {
                apply(app, ui, Action::Activate(0));
            }
        }
        KeyCode::Backspace => {
            app.filter.pop();
        }
        KeyCode::Up | KeyCode::Down => {
            let len = app.rows(app.tab).len();
            if let Some(index) = moved(ui.selected[tab], len, key.code) {
                ui.selected[tab] = index;
            }
        }
        KeyCode::Char(ch) if !chord(&key) => {
            app.filter.push(ch);
            ui.selected[tab] = 0;
        }
        _ => {}
    }
}

fn queue_key(app: &mut App, ui: &mut Ui, key: KeyEvent) {
    let len = app.queue.upcoming().count();
    let selected = ui.queue_selected;
    let action = match key.code {
        KeyCode::Char('K') => Action::MoveQueued(selected, -1),
        KeyCode::Char('J') => Action::MoveQueued(selected, 1),
        KeyCode::Up if key.modifiers.contains(KeyModifiers::SHIFT) => Action::MoveQueued(selected, -1),
        KeyCode::Down if key.modifiers.contains(KeyModifiers::SHIFT) => Action::MoveQueued(selected, 1),
        KeyCode::Enter if len > 0 => Action::JumpQueue(selected),
        KeyCode::Char('d') | KeyCode::Delete if len > 0 => Action::RemoveQueued(selected),
        KeyCode::Esc => Action::Focus(Panel::Library),
        code => {
            if let Some(index) = moved(selected, len, code) {
                ui.queue_selected = index;
            }
            return;
        }
    };
    if let Action::MoveQueued(offset, delta) = action {
        ui.queue_selected = offset.saturating_add_signed(delta).min(len.saturating_sub(1));
    }
    apply(app, ui, action);
}

fn ambience_key(app: &mut App, ui: &mut Ui, key: KeyEvent) {
    let len = app.catalog.ambient.len();
    let Some(sound) = app.catalog.ambient.get(ui.sound_selected.min(len.saturating_sub(1))) else {
        return;
    };
    let id = sound.id.clone();
    let action = match key.code {
        KeyCode::Left | KeyCode::Char('h') => Action::LevelBy(id, -10),
        KeyCode::Right | KeyCode::Char('l') => Action::LevelBy(id, 10),
        KeyCode::Char('0') | KeyCode::Backspace => Action::SetLevel(id, 0),
        KeyCode::Esc => Action::Focus(Panel::Library),
        code => {
            if let Some(index) = moved(ui.sound_selected, len, code) {
                ui.sound_selected = index;
            }
            return;
        }
    };
    apply(app, ui, action);
}

fn overlay_key(app: &mut App, ui: &mut Ui, key: KeyEvent) {
    let ctrl = chord(&key);
    let Some(overlay) = ui.overlay.as_mut() else { return };
    match overlay {
        Overlay::Palette { query, selected } => {
            let last = overlay::matching(app, query).len().saturating_sub(1);
            match key.code {
                KeyCode::Esc => ui.close(),
                KeyCode::Enter => {
                    let chosen = overlay::matching(app, query).into_iter().nth(*selected);
                    ui.close();
                    if let Some(command) = chosen {
                        apply(app, ui, command.action);
                    }
                }
                KeyCode::Up => *selected = selected.saturating_sub(1),
                KeyCode::Char('p') if ctrl => *selected = selected.saturating_sub(1),
                KeyCode::Down => *selected = (*selected + 1).min(last),
                KeyCode::Char('n') if ctrl => *selected = (*selected + 1).min(last),
                KeyCode::Backspace => {
                    query.pop();
                    *selected = 0;
                }
                KeyCode::Char(ch) if !ctrl => {
                    query.push(ch);
                    *selected = 0;
                }
                _ => {}
            }
        }
        Overlay::Prompt { kind, input } => match key.code {
            KeyCode::Esc => ui.close(),
            KeyCode::Enter => {
                let action = Action::Submit(*kind, std::mem::take(input));
                ui.close();
                apply(app, ui, action);
            }
            KeyCode::Backspace => {
                input.pop();
            }
            KeyCode::Char('u') if ctrl => input.clear(),
            KeyCode::Char(ch) if !ctrl => input.push(ch),
            _ => {}
        },
        Overlay::Confirm { action, .. } => match key.code {
            KeyCode::Enter | KeyCode::Char('y') => {
                let action = action.clone();
                ui.close();
                app.dispatch(action);
            }
            KeyCode::Esc | KeyCode::Char('n') => ui.close(),
            _ => {}
        },
        Overlay::Help { scroll } => match key.code {
            KeyCode::Up | KeyCode::Char('k') => *scroll = scroll.saturating_sub(1),
            KeyCode::Down | KeyCode::Char('j') => *scroll += 1,
            KeyCode::Esc | KeyCode::Enter | KeyCode::Char('q' | '?' | 'i') => ui.close(),
            _ => {}
        },
        Overlay::Stats => {
            if matches!(key.code, KeyCode::Esc | KeyCode::Enter | KeyCode::Char('q' | '?' | 'i')) {
                ui.close();
            }
        }
        Overlay::Diagnostics { selected, scroll } => match key.code {
            KeyCode::Esc | KeyCode::Char('q' | 'D') => ui.close(),
            KeyCode::Enter | KeyCode::Char('d') => app.dispatch(Action::DismissDiagnostic(*selected)),
            KeyCode::Char('x') => app.dispatch(Action::DismissDiagnosticOverflow),
            KeyCode::Left | KeyCode::Char('h') => {
                *selected = app.diagnostics.adjacent_entry(*selected, -1).unwrap_or(*selected);
                *scroll = 0;
            }
            KeyCode::Right | KeyCode::Char('l') => {
                *selected = app.diagnostics.adjacent_entry(*selected, 1).unwrap_or(*selected);
                *scroll = 0;
            }
            KeyCode::Up | KeyCode::Char('k') => *scroll = scroll.saturating_sub(1),
            KeyCode::Down | KeyCode::Char('j') => *scroll = (*scroll + 1).min(crate::diagnostics::MESSAGE_LIMIT),
            _ => {}
        },
        Overlay::Settings { selected } => {
            let setting = Setting::ALL[(*selected).min(Setting::ALL.len() - 1)];
            match key.code {
                KeyCode::Esc | KeyCode::Char('q' | 'c') => ui.close(),
                KeyCode::Up | KeyCode::Char('k') => *selected = selected.saturating_sub(1),
                KeyCode::Down | KeyCode::Char('j') => *selected = (*selected + 1).min(Setting::ALL.len() - 1),
                KeyCode::Left | KeyCode::Char('h') => app.dispatch(Action::AdjustSetting(setting, -1)),
                KeyCode::Right | KeyCode::Char('l') | KeyCode::Enter | KeyCode::Char(' ') => {
                    app.dispatch(Action::AdjustSetting(setting, 1))
                }
                _ => {}
            }
        }
    }
}

fn slider_value(rect: Rect, column: u16) -> f32 {
    if rect.width <= 1 {
        return 0.0;
    }
    let last = rect.width - 1;
    let offset = column.saturating_sub(rect.x).min(last);
    f32::from(offset) / f32::from(last)
}

fn set_slider(app: &mut App, ui: &mut Ui, slider: &Slider, value: f32) {
    match slider {
        Slider::Volume => {
            app.dispatch(Action::SetVolume(value));
            ui.jump_volume(value);
        }
        Slider::Balance => app.dispatch(Action::SetBalance(value)),
        Slider::Level(id) => {
            let level = (value * 100.0).round() as u8;
            app.dispatch(Action::SetLevel(id.clone(), level));
            ui.jump_level(id, f32::from(level) / 100.0);
        }
    }
}

fn seek_fraction(app: &App, fraction: f32) -> Option<f64> {
    let duration = app.current()?.duration?;
    Some(f64::from(fraction) * f64::from(duration))
}

fn mouse_event(app: &mut App, ui: &mut Ui, mouse: MouseEvent) {
    let (x, y) = (mouse.column, mouse.row);
    ui.hover = Some((x, y));
    match mouse.kind {
        MouseEventKind::Down(MouseButton::Left) => {
            let Some((rect, hit)) = ui.hit_at(x, y) else { return };
            click(app, ui, rect, hit, x);
        }
        MouseEventKind::Down(MouseButton::Right) => {
            if let Some((_, Hit::Row(index))) = ui.hit_at(x, y) {
                apply(app, ui, Action::Enqueue(index));
            }
        }
        MouseEventKind::Drag(MouseButton::Left) => match ui.drag.clone() {
            Some(Drag::Slider(slider, rect)) => set_slider(app, ui, &slider, slider_value(rect, x)),
            Some(Drag::Seek(rect)) => ui.seek_preview = seek_fraction(app, slider_value(rect, x)),
            None => {}
        },
        MouseEventKind::Up(MouseButton::Left) => {
            if let (Some(Drag::Seek(_)), Some(at)) = (ui.drag.take(), ui.seek_preview.take()) {
                app.dispatch(Action::SeekTo(at));
            }
            ui.drag = None;
        }
        MouseEventKind::ScrollUp | MouseEventKind::ScrollDown => {
            let step: isize = if mouse.kind == MouseEventKind::ScrollUp { -1 } else { 1 };
            scrolled(app, ui, x, y, step);
        }
        _ => {}
    }
}

fn click(app: &mut App, ui: &mut Ui, rect: Rect, hit: Hit, x: u16) {
    // A row plays on its second click, not on the first click of a row that was only
    // selected by default or by keyboard.
    let again = ui.last_click.replace(hit.clone()) == Some(hit.clone());
    match hit {
        Hit::Act(action) => apply(app, ui, action),
        Hit::Row(index) => {
            let tab = app.tab.index();
            ui.selected[tab] = index;
            ui.set_focus(Panel::Library);
            if again {
                ui.last_click = None;
                apply(app, ui, Action::Activate(index));
            }
        }
        Hit::Queue(index) => {
            ui.queue_selected = index;
            ui.set_focus(Panel::Queue);
            if again {
                ui.last_click = None;
                apply(app, ui, Action::JumpQueue(index));
            }
        }
        Hit::Sound(index) => {
            ui.sound_selected = index;
            ui.set_focus(Panel::Ambience);
        }
        Hit::Slider(slider) => {
            if let Slider::Level(id) = &slider
                && let Some(index) = app.catalog.ambient.iter().position(|sound| &sound.id == id)
            {
                ui.sound_selected = index;
                ui.set_focus(Panel::Ambience);
            }
            set_slider(app, ui, &slider, slider_value(rect, x));
            ui.drag = Some(Drag::Slider(slider, rect));
        }
        Hit::Seek => {
            ui.seek_preview = seek_fraction(app, slider_value(rect, x));
            ui.drag = Some(Drag::Seek(rect));
        }
        Hit::Palette(index) => {
            let Some(Overlay::Palette { query, .. }) = &ui.overlay else {
                return;
            };
            let chosen = overlay::matching(app, query).into_iter().nth(index);
            ui.close();
            if let Some(command) = chosen {
                apply(app, ui, command.action);
            }
        }
        Hit::Setting(index) => {
            if let Some(Overlay::Settings { selected }) = &mut ui.overlay {
                *selected = index;
            }
            if let Some(setting) = Setting::ALL.get(index).filter(|setting| setting.is_toggle()) {
                app.dispatch(Action::AdjustSetting(*setting, 1));
            }
        }
        Hit::Backdrop => ui.close(),
        Hit::Dialog => {}
        Hit::Toast(index) => ui.dismiss_toast(index),
        Hit::DiagnosticEntry(step) => {
            if let Some(Overlay::Diagnostics { selected, scroll }) = &mut ui.overlay {
                *selected = app.diagnostics.adjacent_entry(*selected, step).unwrap_or(*selected);
                *scroll = 0;
            }
        }
        Hit::DiagnosticScroll(step) => {
            if let Some(Overlay::Diagnostics { scroll, .. }) = &mut ui.overlay {
                *scroll = scroll
                    .saturating_add_signed(step)
                    .min(crate::diagnostics::MESSAGE_LIMIT);
            }
        }
        Hit::Panel(panel) => ui.set_focus(panel),
    }
}

fn scrolled(app: &mut App, ui: &mut Ui, x: u16, y: u16, step: isize) {
    if let Some(overlay) = &mut ui.overlay {
        match overlay {
            Overlay::Palette { query, selected } => {
                let last = overlay::matching(app, query).len().saturating_sub(1);
                *selected = selected.saturating_add_signed(step).min(last);
            }
            Overlay::Diagnostics { scroll, .. } => {
                *scroll = scroll
                    .saturating_add_signed(step)
                    .min(crate::diagnostics::MESSAGE_LIMIT);
            }
            Overlay::Help { scroll } => *scroll = scroll.saturating_add_signed(step),
            Overlay::Settings { selected } => {
                *selected = selected.saturating_add_signed(step).min(Setting::ALL.len() - 1);
            }
            _ => {}
        }
        return;
    }
    let hit = ui.hit_at(x, y).map(|(_, hit)| hit);
    match hit {
        Some(Hit::Slider(slider)) => {
            let current = match &slider {
                Slider::Volume => app.volume,
                Slider::Balance => app.balance,
                Slider::Level(id) => f32::from(app.levels.get(id).copied().unwrap_or(0)) / 100.0,
            };
            set_slider(app, ui, &slider, (current - step as f32 * 0.05).clamp(0.0, 1.0));
        }
        Some(Hit::Row(_) | Hit::Panel(Panel::Library)) => {
            let tab = app.tab.index();
            let len = app.rows(app.tab).len();
            ui.selected[tab] = ui.selected[tab].saturating_add_signed(step).min(len.saturating_sub(1));
        }
        Some(Hit::Queue(_) | Hit::Panel(Panel::Queue)) => {
            let len = app.queue.upcoming().count();
            ui.queue_selected = ui.queue_selected.saturating_add_signed(step).min(len.saturating_sub(1));
        }
        Some(Hit::Sound(_) | Hit::Panel(Panel::Ambience)) => {
            let len = app.catalog.ambient.len();
            ui.sound_selected = ui.sound_selected.saturating_add_signed(step).min(len.saturating_sub(1));
        }
        Some(Hit::Seek) => app.dispatch(Action::SeekBy(-(step as f64) * 10.0)),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(text: &str) -> Vec<Event> {
        text.chars()
            .map(|ch| Event::Key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE)))
            .collect()
    }

    #[test]
    fn a_burst_of_characters_becomes_a_paste_but_a_keypress_stays_a_key() {
        assert_eq!(
            coalesce(keys("https://youtu.be/abc")),
            [Event::Paste("https://youtu.be/abc".into())]
        );
        assert_eq!(coalesce(keys("n")), keys("n"));
        assert_eq!(coalesce(keys("jjjjjjjjjj")), keys("jjjjjjjjjj"));
    }
}
