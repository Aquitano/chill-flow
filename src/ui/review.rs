use std::fmt::Write;
use std::time::{Duration, Instant};

use ratatui::Terminal;
use ratatui::backend::TestBackend;
use ratatui::buffer::Buffer;
use ratatui::style::{Color, Modifier};
use ratatui_image::picker::Picker;
use unicode_width::UnicodeWidthStr;

use super::{Ui, picture::Picture, theme::Theme};
use crate::app::TestApp;
use crate::catalog::{AmbientSound, Catalog, CatalogTrack};
use crate::model::Item;
use crate::store::FocusDays;
use crate::timer::{Timer, TimerMode};

const FOREGROUND: [u8; 3] = [205, 214, 244];
const BACKGROUND: [u8; 3] = [30, 30, 46];
const ANSI: [[u8; 3]; 16] = [
    [30, 30, 46],
    [243, 139, 168],
    [166, 227, 161],
    [249, 226, 175],
    [137, 180, 250],
    [203, 166, 247],
    [148, 226, 213],
    [186, 194, 222],
    [88, 91, 112],
    [243, 139, 168],
    [166, 227, 161],
    [249, 226, 175],
    [137, 180, 250],
    [203, 166, 247],
    [148, 226, 213],
    [205, 214, 244],
];

#[derive(Clone, Copy)]
struct Layout {
    name: &'static str,
    width: u16,
    height: u16,
    timer_hidden: bool,
    library_hidden: bool,
    side_hidden: bool,
    paused: bool,
    picture: Picture,
}

const WIDE: Layout = Layout {
    name: "wide",
    width: 160,
    height: 44,
    timer_hidden: false,
    library_hidden: false,
    side_hidden: false,
    paused: false,
    picture: Picture::Cover,
};
const LAYOUTS: [Layout; 10] = [
    WIDE,
    Layout {
        name: "medium-split",
        width: 110,
        height: 32,
        ..WIDE
    },
    Layout {
        name: "medium-stacked",
        width: 96,
        height: 30,
        ..WIDE
    },
    Layout {
        name: "narrow",
        width: 64,
        height: 24,
        ..WIDE
    },
    Layout {
        name: "timer-hidden",
        timer_hidden: true,
        ..WIDE
    },
    Layout {
        name: "library-hidden",
        library_hidden: true,
        ..WIDE
    },
    Layout {
        name: "side-hidden",
        side_hidden: true,
        ..WIDE
    },
    Layout {
        name: "both-sides-hidden",
        library_hidden: true,
        side_hidden: true,
        ..WIDE
    },
    Layout {
        name: "night-lake",
        picture: Picture::NightLake,
        library_hidden: true,
        side_hidden: true,
        ..WIDE
    },
    Layout {
        name: "compact-paused",
        width: 44,
        height: 24,
        paused: true,
        timer_hidden: true,
        ..WIDE
    },
];

fn render(layout: Layout) -> Buffer {
    let mut app = TestApp::offline();
    let mut rng = fastrand::Rng::with_seed(0x5eed);
    app.catalog = Catalog {
        tracks: ["Morning light", "Quiet streets", "After the rain"]
            .into_iter()
            .enumerate()
            .map(|(i, title)| CatalogTrack {
                id: format!("sample-{i}"),
                title: title.into(),
                artist: "Sample artist".into(),
                file: String::new(),
                cover: None,
                duration_sec: rng.u32(180..360),
                tags: vec!["focus".into()],
                catalog: None,
            })
            .collect(),
        ambient: ["Rain", "Wind"]
            .into_iter()
            .map(|label| AmbientSound {
                id: label.to_lowercase(),
                label: label.into(),
                file: String::new(),
                gain_percent: 100,
                credit: None,
            })
            .collect(),
        ..Catalog::default()
    };
    let items = app
        .catalog
        .tracks
        .iter()
        .map(|track| Item::from_track(&app.catalog, track))
        .collect();
    app.queue.replace(items, None);
    app.mixes.clear();
    app.levels = [("rain".into(), 55), ("wind".into(), 20)].into();
    app.mix_name = Some("Rain and wind".into());
    app.focus_days = FocusDays {
        days: (16..=22)
            .map(|day| (jiff::civil::date(2026, 10, day), rng.u32(20..100)))
            .collect(),
    };
    app.config.picture = layout.picture;
    app.timer_hidden = layout.timer_hidden;
    app.library_hidden = layout.library_hidden;
    app.side_hidden = layout.side_hidden;
    app.timer = Timer::new(TimerMode::Pomodoro, app.config.pomodoro);
    let start = Instant::now();
    app.timer.start(start);
    let now = start + Duration::from_secs(435);
    if layout.paused {
        app.timer.pause(now);
    }
    let mut ui = Ui::new(Theme::new(Some((FOREGROUND, BACKGROUND))), Picker::halfblocks(), true);
    ui.started = start;
    ui.last_frame = start;
    let mut terminal = Terminal::new(TestBackend::new(layout.width, layout.height)).unwrap();
    terminal.draw(|frame| ui.draw_at(frame, &mut app, now)).unwrap();
    terminal.backend().buffer().clone()
}

fn row(buffer: &Buffer, y: u16) -> String {
    (0..buffer.area.width).map(|x| buffer[(x, y)].symbol()).collect()
}

#[test]
fn review_layouts_keep_the_timer_visible_without_restoring_hidden_panels() {
    for layout in LAYOUTS {
        let buffer = render(layout);
        assert_eq!(buffer, render(layout), "{} must be reproducible", layout.name);
        let body: String = (1..layout.height).map(|y| row(&buffer, y)).collect();
        let panel = layout.width >= 84 && !layout.timer_hidden && !layout.side_hidden;
        assert_eq!(body.contains(" Focus "), panel, "{}", layout.name);
        assert_eq!(row(&buffer, 0).contains("focus 17:45"), !panel, "{}", layout.name);
        assert_eq!(row(&buffer, 0).contains("paused"), layout.paused, "{}", layout.name);
        if layout.side_hidden {
            assert!(!body.contains(" Ambience "));
        }
        if layout.library_hidden {
            assert!(!body.contains(" Library "));
        }
    }
}

fn color(color: Color, default: [u8; 3]) -> String {
    let rgb = match color {
        Color::Reset => default,
        Color::Rgb(r, g, b) => [r, g, b],
        Color::Indexed(index) => match index {
            0..=15 => ANSI[usize::from(index)],
            16..=231 => {
                let index = index - 16;
                [index / 36, (index / 6) % 6, index % 6].map(|n| if n == 0 { 0 } else { 55 + n * 40 })
            }
            _ => [8 + (index - 232) * 10; 3],
        },
        named => {
            let names = [
                Color::Black,
                Color::Red,
                Color::Green,
                Color::Yellow,
                Color::Blue,
                Color::Magenta,
                Color::Cyan,
                Color::Gray,
                Color::DarkGray,
                Color::LightRed,
                Color::LightGreen,
                Color::LightYellow,
                Color::LightBlue,
                Color::LightMagenta,
                Color::LightCyan,
                Color::White,
            ];
            ANSI[names.iter().position(|name| *name == named).unwrap()]
        }
    };
    format!("#{:02x}{:02x}{:02x}", rgb[0], rgb[1], rgb[2])
}

fn svg(buffer: &Buffer) -> String {
    let background = color(Color::Reset, BACKGROUND);
    let mut svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{}\" height=\"{}\" font-family=\"monospace\" font-size=\"14\"><rect width=\"100%\" height=\"100%\" fill=\"{}\"/>",
        buffer.area.width * 9,
        buffer.area.height * 18,
        background
    );
    for y in 0..buffer.area.height {
        let mut x = 0;
        while x < buffer.area.width {
            let cell = &buffer[(x, y)];
            let width = cell.symbol().width().max(1) as u16;
            let mut fg = color(cell.fg, FOREGROUND);
            let mut bg = color(cell.bg, BACKGROUND);
            if cell.modifier.contains(Modifier::REVERSED) {
                std::mem::swap(&mut fg, &mut bg);
            }
            if bg != background {
                write!(
                    svg,
                    "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"18\" fill=\"{bg}\"/>",
                    x * 9,
                    y * 18,
                    width * 9
                )
                .unwrap();
            }
            if !cell.modifier.contains(Modifier::HIDDEN) && cell.symbol() != " " {
                let symbol = cell
                    .symbol()
                    .replace('&', "&amp;")
                    .replace('<', "&lt;")
                    .replace('>', "&gt;");
                let weight = if cell.modifier.contains(Modifier::BOLD) {
                    "bold"
                } else {
                    "normal"
                };
                let style = if cell.modifier.contains(Modifier::ITALIC) {
                    "italic"
                } else {
                    "normal"
                };
                let opacity = if cell.modifier.contains(Modifier::DIM) {
                    "0.5"
                } else {
                    "1"
                };
                let underline = if cell.modifier.contains(Modifier::UNDERLINED) {
                    "underline"
                } else {
                    "none"
                };
                write!(svg, "<text x=\"{}\" y=\"{}\" fill=\"{fg}\" font-weight=\"{weight}\" font-style=\"{style}\" opacity=\"{opacity}\" text-decoration=\"{underline}\" textLength=\"{}\" lengthAdjust=\"spacingAndGlyphs\">{symbol}</text>", x * 9, y * 18 + 14, width * 9).unwrap();
            }
            x += width;
        }
    }
    svg.push_str("</svg>");
    svg
}

#[test]
#[ignore = "writes offline UI artifacts to target/ui-review"]
fn export_ui_review() -> std::io::Result<()> {
    let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/ui-review");
    std::fs::create_dir_all(&directory)?;
    let mut html = String::from(
        "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>chill UI review</title><style>body{background:#181825;color:#cdd6f4;font:16px system-ui;margin:24px}section{overflow:auto;margin-bottom:32px}svg{display:block}</style><h1>chill UI review</h1><p>Fixed sample data, 17:45 remaining, reduced motion. ANSI colors use the fixed palette in src/ui/review.rs. Glyph shapes depend on your local monospace font.</p>",
    );
    for layout in LAYOUTS {
        let image = svg(&render(layout));
        std::fs::write(directory.join(format!("{}.svg", layout.name)), &image)?;
        write!(
            html,
            "<section><h2>{} ({} × {})</h2>{image}</section>",
            layout.name, layout.width, layout.height
        )
        .unwrap();
    }
    html.push_str("</html>");
    std::fs::write(directory.join("index.html"), html)?;
    println!("Open {}", directory.join("index.html").display());
    Ok(())
}
