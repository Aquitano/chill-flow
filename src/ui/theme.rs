use std::time::Duration;

use ratatui::style::Color;

/// Colors derived from the terminal's own foreground and background, so the app follows
/// whatever theme is active. Accents use the named ANSI colors for the same reason, except on a
/// light background, where a theme's yellow, green, and cyan are often too pale to read.
#[derive(Debug, Clone, Copy)]
pub struct Theme {
    known: Option<([u8; 3], [u8; 3])>,
    muted_at: f32,
    faint_at: f32,
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
        Theme::new(known)
    }

    /// `known` is the terminal's (foreground, background); `None` falls back to named colors.
    pub fn new(known: Option<([u8; 3], [u8; 3])>) -> Theme {
        let at = |target: f32, fallback: f32| known.map_or(fallback, |(fg, bg)| reach(bg, fg, bg, target));
        // Darkened toward black rather than the foreground, which keeps each hue recognizable.
        let accent = |named: Color, hue: [u8; 3]| match known {
            Some((fg, bg)) if luminance(bg) > luminance(fg) => {
                let [r, g, b] = blend(hue, [0, 0, 0], reach(hue, [0, 0, 0], bg, 4.5));
                Color::Rgb(r, g, b)
            }
            _ => named,
        };
        Theme {
            known,
            muted_at: at(4.5, 0.62),
            faint_at: at(3.0, 0.36),
            accent: accent(Color::Yellow, [0xd4, 0x9a, 0x0c]),
            rest: accent(Color::Green, [0x3f, 0x9e, 0x3a]),
            alert: accent(Color::Red, [0xd2, 0x3b, 0x3b]),
            calm: accent(Color::Cyan, [0x1c, 0x98, 0xa6]),
        }
    }

    /// A color `amount` of the way from the background to the foreground.
    pub fn mix(&self, amount: f32) -> Color {
        match self.known {
            Some((fg, bg)) => {
                let [r, g, b] = blend(bg, fg, amount.clamp(0.0, 1.0));
                Color::Rgb(r, g, b)
            }
            // Without the theme's colors no gray is safe on both dark and light backgrounds, so
            // secondary text keeps the full foreground.
            None if amount >= 0.45 => Color::Reset,
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
        self.mix(self.muted_at)
    }

    pub fn faint(&self) -> Color {
        self.mix(self.faint_at)
    }

    /// From muted at 0 to full text at 1, for labels that light up when focused.
    pub fn emphasis(&self, amount: f32) -> Color {
        self.mix(self.muted_at + (1.0 - self.muted_at) * amount.clamp(0.0, 1.0))
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

    /// Floating panels sit a step above the page.
    pub fn panel(&self) -> Color {
        match self.known {
            Some(_) => self.mix(0.06),
            None => Color::Reset,
        }
    }

    /// Inputs and the selected row inside a floating panel.
    pub fn raised(&self) -> Color {
        match self.known {
            Some(_) => self.mix(0.13),
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

fn luminance(color: [u8; 3]) -> f32 {
    let linear = |channel: u8| {
        let value = f32::from(channel) / 255.0;
        if value <= 0.039_28 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2])
}

fn contrast(a: [u8; 3], b: [u8; 3]) -> f32 {
    let (a, b) = (luminance(a), luminance(b));
    (a.max(b) + 0.05) / (a.min(b) + 0.05)
}

fn blend(from: [u8; 3], to: [u8; 3], amount: f32) -> [u8; 3] {
    [0, 1, 2].map(|index| {
        let (from, to) = (f32::from(from[index]), f32::from(to[index]));
        (from + (to - from) * amount).round() as u8
    })
}

/// The smallest blend from `from` toward `to` that reaches `target` contrast with the background,
/// so text stays legible on light and low-contrast themes, not just dark ones.
fn reach(from: [u8; 3], to: [u8; 3], bg: [u8; 3], target: f32) -> f32 {
    let target = target.min(contrast(to, bg));
    let (mut low, mut high) = (0.0_f32, 1.0_f32);
    for _ in 0..20 {
        let middle = (low + high) / 2.0;
        if contrast(blend(from, to, middle), bg) >= target {
            high = middle;
        } else {
            low = middle;
        }
    }
    high
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secondary_text_keeps_its_contrast_on_light_and_dark_themes() {
        let light = ([0x4c, 0x4f, 0x69], [0xef, 0xf1, 0xf5]);
        let dark = ([0xcd, 0xd6, 0xf4], [0x1e, 0x1e, 0x2e]);
        for (fg, bg) in [light, dark] {
            let theme = Theme::new(Some((fg, bg)));
            let rgb = |color| match color {
                Color::Rgb(r, g, b) => [r, g, b],
                _ => unreachable!(),
            };
            assert!(contrast(rgb(theme.muted()), bg) >= 4.5);
            assert!(contrast(rgb(theme.faint()), bg) >= 3.0);
        }
    }

    #[test]
    fn accents_read_as_text_on_light_themes_and_keep_the_palette_on_dark_ones() {
        let (fg, bg) = ([0x00, 0x00, 0x00], [0xff, 0xff, 0xff]);
        let light = Theme::new(Some((fg, bg)));
        for accent in [light.accent, light.rest, light.alert, light.calm] {
            let Color::Rgb(r, g, b) = accent else { unreachable!() };
            assert!(contrast([r, g, b], bg) >= 4.5);
        }
        let dark = Theme::new(Some(([0xcd, 0xd6, 0xf4], [0x1e, 0x1e, 0x2e])));
        assert_eq!(dark.accent, Color::Yellow);
    }
}
