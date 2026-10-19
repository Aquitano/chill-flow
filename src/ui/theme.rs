use std::time::Duration;

use ratatui::style::Color;

/// Colors derived from the terminal's own foreground and background, so the app follows
/// whatever theme is active. Accents use the named ANSI colors for the same reason.
#[derive(Debug, Clone, Copy)]
pub struct Theme {
    known: Option<([u8; 3], [u8; 3])>,
    pub accent: Color,
    pub rest: Color,
    pub alert: Color,
    pub calm: Color,
}

impl Theme {
    pub fn detect() -> Theme {
        let mut options = terminal_colorsaurus::QueryOptions::default();
        options.timeout = Duration::from_millis(400);
        let known = terminal_colorsaurus::color_palette(options).ok().map(|palette| {
            let (fr, fg, fb) = palette.foreground.scale_to_8bit();
            let (br, bg, bb) = palette.background.scale_to_8bit();
            ([fr, fg, fb], [br, bg, bb])
        });
        Theme {
            known,
            accent: Color::Yellow,
            rest: Color::Green,
            alert: Color::Red,
            calm: Color::Cyan,
        }
    }

    /// A color `amount` of the way from the background to the foreground.
    pub fn mix(&self, amount: f32) -> Color {
        match self.known {
            Some((fg, bg)) => {
                let channel = |index: usize| {
                    let (from, to) = (f32::from(bg[index]), f32::from(fg[index]));
                    (from + (to - from) * amount.clamp(0.0, 1.0)).round() as u8
                };
                Color::Rgb(channel(0), channel(1), channel(2))
            }
            None if amount >= 0.85 => Color::Reset,
            None if amount >= 0.45 => Color::Gray,
            None => Color::DarkGray,
        }
    }

    pub fn has_rgb(&self) -> bool {
        self.known.is_some()
    }

    pub fn text(&self) -> Color {
        self.mix(1.0)
    }

    pub fn muted(&self) -> Color {
        self.mix(0.62)
    }

    pub fn faint(&self) -> Color {
        self.mix(0.36)
    }

    pub fn line(&self) -> Color {
        self.mix(0.2)
    }

    pub fn surface(&self) -> Color {
        match self.known {
            Some(_) => self.mix(0.09),
            None => Color::Reset,
        }
    }

    pub fn hover(&self) -> Color {
        match self.known {
            Some(_) => self.mix(0.05),
            None => Color::Reset,
        }
    }

    pub fn background(&self) -> Color {
        match self.known {
            Some(_) => self.mix(0.0),
            None => Color::Reset,
        }
    }
}
