use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};
use ratatui::{Terminal, backend::TestBackend, style::Modifier, symbols::pixel::OCTANTS};
use ratatui_image::picker::Picker;
use serde::Serialize;

use crate::action::{Action, Tab};
use crate::app::TestApp;
use crate::catalog::Catalog;
use crate::timer::{Timer, TimerMode};
use crate::ui::{
    Ui, input,
    picture::{Look, Picture},
    theme::Theme,
};

use super::{BACKGROUND, FOREGROUND, color};

#[derive(Serialize)]
struct Recording {
    columns: u16,
    rows: u16,
    fps: u32,
    styles: Vec<(String, String, u8)>,
    frames: Vec<Vec<(usize, String, usize)>>,
    inputs: Vec<(u32, String)>,
    octants: Vec<char>,
}

#[test]
#[ignore = "exports the offline app walkthrough for the product film"]
fn export_walkthrough() -> std::io::Result<()> {
    capture(false)
}

#[test]
#[ignore = "exports the feature sequence for timing prototypes"]
fn export_edit_walkthrough() -> std::io::Result<()> {
    capture(true)
}

fn capture(links: bool) -> std::io::Result<()> {
    let mut app = TestApp::offline();
    app.catalog = Catalog::parse(include_str!("../catalog.json"), "capture://offline/catalog.json").unwrap();
    for track in &mut app.catalog.tracks {
        track.cover = None;
    }
    app.mixes.clear();
    app.levels.clear();
    app.focus_days.days.clear();
    app.tab = Tab::Tracks;
    app.config.picture = Picture::FujiDawn;
    app.config.look = Look::Pixels;
    app.config.reduce_motion = false;
    app.timer = Timer::new(TimerMode::Pomodoro, app.config.pomodoro);
    let mut ui = Ui::new(Theme::new(Some((FOREGROUND, BACKGROUND))), Picker::halfblocks(), false);
    let start = Instant::now();
    ui.started = start;
    ui.last_frame = start;
    let mut terminal = Terminal::new(TestBackend::new(144, 40)).unwrap();
    let mut recording = Recording {
        columns: 144,
        rows: 40,
        fps: 15,
        styles: vec![],
        frames: vec![],
        inputs: vec![],
        octants: OCTANTS.to_vec(),
    };
    let mut styles = BTreeMap::new();
    let mut previous = Vec::new();
    let play_tick = if links { 27 } else { 33 };
    for tick in 0..if links { 360_u32 } else { 396_u32 } {
        let key = if links {
            match tick {
                8 => Some((KeyCode::Char('/'), "/")),
                12 => Some((KeyCode::Char('r'), "r")),
                14 => Some((KeyCode::Char('e'), "e")),
                16 => Some((KeyCode::Char('l'), "l")),
                18 => Some((KeyCode::Char('a'), "a")),
                20 => Some((KeyCode::Char('x'), "x")),
                27 => Some((KeyCode::Enter, "Enter")),
                62 => Some((KeyCode::Char('o'), "o")),
                107 => Some((KeyCode::Esc, "Esc")),
                120 | 126 => Some((KeyCode::Tab, "Tab")),
                138 | 144 | 150 | 156 | 162 => Some((KeyCode::Right, "Right")),
                199 => Some((KeyCode::Char('t'), "t")),
                273 => Some((KeyCode::Char('H'), "Shift H")),
                282 => Some((KeyCode::Char('L'), "Shift L")),
                _ => None,
            }
        } else {
            match tick {
                12 => Some((KeyCode::Char('/'), "/")),
                16 => Some((KeyCode::Char('r'), "r")),
                18 => Some((KeyCode::Char('e'), "e")),
                20 => Some((KeyCode::Char('l'), "l")),
                22 => Some((KeyCode::Char('a'), "a")),
                24 => Some((KeyCode::Char('x'), "x")),
                33 => Some((KeyCode::Enter, "Enter")),
                68 | 76 => Some((KeyCode::Tab, "Tab")),
                86 | 92 | 98 | 104 | 110 => Some((KeyCode::Right, "Right")),
                151 => Some((KeyCode::Char('t'), "t")),
                282 => Some((KeyCode::Char('H'), "Shift H")),
                293 => Some((KeyCode::Char('L'), "Shift L")),
                _ => None,
            }
        };
        if links && tick == 72 {
            input::handle(
                &mut app,
                &mut ui,
                Event::Paste("https://www.youtube.com/watch?v=jfKfPfyJRdk".into()),
            );
            recording.inputs.push((tick, "Paste".into()));
        }
        let now = start + Duration::from_secs_f64(f64::from(tick) / 15.0);
        if let Some((code, label)) = key {
            input::handle(&mut app, &mut ui, Event::Key(KeyEvent::new(code, KeyModifiers::NONE)));
            recording.inputs.push((tick, label.into()));
            if code == KeyCode::Enter {
                // Offline audio is mixed in Remotion; keep the real selection and playback state.
                app.engine.stop_stream();
                assert!(app.is_playing());
                assert_eq!(app.current().unwrap().title, "Relax & Recharge");
            }
            if code == KeyCode::Char('t') {
                assert!(app.timer.is_running());
                app.timer.reset();
                app.timer.start(now);
            }
        }
        if tick >= play_tick {
            app.dispatch(Action::SeekTo(f64::from(tick - play_tick) / 15.0));
        }
        terminal.draw(|frame| ui.draw_at(frame, &mut app, now)).unwrap();
        let mut changed = vec![];
        let cells = terminal.backend().buffer().content();
        for (index, cell) in cells.iter().enumerate() {
            let mut fg = color(cell.fg, FOREGROUND);
            let mut bg = color(cell.bg, BACKGROUND);
            if cell.modifier.contains(Modifier::REVERSED) {
                std::mem::swap(&mut fg, &mut bg);
            }
            let flags = u8::from(cell.modifier.contains(Modifier::BOLD))
                | (u8::from(cell.modifier.contains(Modifier::ITALIC)) << 1)
                | (u8::from(cell.modifier.contains(Modifier::DIM)) << 2)
                | (u8::from(cell.modifier.contains(Modifier::UNDERLINED)) << 3);
            let style = (fg, bg, flags);
            let next = recording.styles.len();
            let style_id = *styles.entry(style.clone()).or_insert_with(|| {
                recording.styles.push(style);
                next
            });
            let symbol = if cell.modifier.contains(Modifier::HIDDEN) {
                " "
            } else {
                cell.symbol()
            };
            let cell = (index, symbol.to_string(), style_id);
            if previous.get(index) != Some(&cell) {
                changed.push(cell);
            }
        }
        if previous.is_empty() {
            previous = changed.clone();
        } else {
            for cell in &changed {
                previous[cell.0] = cell.clone();
            }
        }
        recording.frames.push(changed);
    }
    assert_eq!(app.levels.get("rain-soft"), Some(&50));
    assert!(app.library_hidden && app.side_hidden);
    assert_eq!(app.config.picture, Picture::FujiDawn);
    assert!(app.timer.remaining(start + Duration::from_secs(25)).as_secs() < 1500);
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(if links {
        "video/assets/feature-walkthrough.json"
    } else {
        "video/assets/walkthrough.json"
    });
    std::fs::write(&path, serde_json::to_vec(&recording)?)?;
    println!("Exported {} frames to {}", recording.frames.len(), path.display());
    Ok(())
}
