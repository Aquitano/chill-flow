mod autumn_pagoda;
mod canvas;
mod fuji_dawn;
mod night_lake;

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Color;
use ratatui::symbols::braille::BRAILLE;
use ratatui::symbols::pixel::OCTANTS;
use serde::Deserialize;

use super::theme::Theme;
use canvas::{Canvas, Dot, Ink, Rgb, unit};

/// What the player shows above the seek bar.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Picture {
    /// The cover of what's playing, with the spectrum below it.
    #[default]
    Cover,
    NightLake,
    FujiDawn,
    AutumnPagoda,
}

impl Picture {
    pub const ALL: [Picture; 4] = [
        Picture::Cover,
        Picture::NightLake,
        Picture::FujiDawn,
        Picture::AutumnPagoda,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Picture::Cover => "Cover",
            Picture::NightLake => "Night lake",
            Picture::FujiDawn => "Fuji at dawn",
            Picture::AutumnPagoda => "Autumn pagoda",
        }
    }

    /// The name config.toml spells it with.
    pub fn id(self) -> &'static str {
        match self {
            Picture::Cover => "cover",
            Picture::NightLake => "night-lake",
            Picture::FujiDawn => "fuji-dawn",
            Picture::AutumnPagoda => "autumn-pagoda",
        }
    }

    pub fn step(self, by: i8) -> Picture {
        step(&Picture::ALL, self, by)
    }

    /// Where fireflies hover, from the top to the bottom of the picture.
    fn fireflies(self) -> (f32, f32) {
        match self {
            Picture::Cover => (0.0, 0.0),
            Picture::NightLake => (0.46, 0.68),
            Picture::FujiDawn => (0.78, 0.94),
            Picture::AutumnPagoda => (0.8, 0.95),
        }
    }
}

/// Which characters draw a picture.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Look {
    /// Braille dots, with figures in solid pixels.
    #[default]
    Dots,
    /// Solid pixels, eight to a cell.
    Pixels,
    /// Two colors to a cell, one above the other: coarser, with smooth shades.
    Blocks,
}

impl Look {
    pub const ALL: [Look; 3] = [Look::Dots, Look::Pixels, Look::Blocks];

    pub fn label(self) -> &'static str {
        match self {
            Look::Dots => "Dots",
            Look::Pixels => "Pixels",
            Look::Blocks => "Blocks",
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Look::Dots => "dots",
            Look::Pixels => "pixels",
            Look::Blocks => "blocks",
        }
    }

    pub fn step(self, by: i8) -> Look {
        step(&Look::ALL, self, by)
    }
}

fn step<T: Copy + PartialEq>(all: &[T], current: T, by: i8) -> T {
    let index = all.iter().position(|item| *item == current).unwrap_or(0) as isize;
    all[(index + isize::from(by.signum())).rem_euclid(all.len() as isize) as usize]
}

/// What the ambience is doing, from 0 to 1 each, for pictures to show what can be heard.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Weather {
    pub rain: f32,
    pub thunder: f32,
    pub wind: f32,
    pub crickets: f32,
}

impl Weather {
    /// Recognizes ambient sounds by how their catalog id starts, so a shared catalog's
    /// `rain-heavy` rains too.
    pub fn from_sounds<'a>(sounds: impl IntoIterator<Item = (&'a str, f32)>) -> Weather {
        let mut weather = Weather::default();
        for (id, level) in sounds {
            let slot = match id.split('-').next() {
                Some("rain") => &mut weather.rain,
                Some("thunder") => &mut weather.thunder,
                Some("wind") => &mut weather.wind,
                Some("crickets") => &mut weather.crickets,
                _ => continue,
            };
            *slot = slot.max(level);
        }
        weather
    }
}

/// Moving pictures change twelve times a second, so a terminal redrawing at thirty only receives
/// the cells that changed on those frames.
const FPS: f32 = 12.0;

enum Art {
    NightLake,
    FujiDawn(Box<fuji_dawn::FujiDawn>),
    AutumnPagoda(Box<autumn_pagoda::AutumnPagoda>),
}

impl Art {
    fn new(picture: Picture) -> Option<Art> {
        match picture {
            Picture::Cover => None,
            Picture::NightLake => Some(Art::NightLake),
            Picture::FujiDawn => Some(Art::FujiDawn(Box::new(fuji_dawn::FujiDawn::new()))),
            Picture::AutumnPagoda => Some(Art::AutumnPagoda(Box::new(autumn_pagoda::AutumnPagoda::new()))),
        }
    }

    fn picture(&self) -> Picture {
        match self {
            Art::NightLake => Picture::NightLake,
            Art::FujiDawn(_) => Picture::FujiDawn,
            Art::AutumnPagoda(_) => Picture::AutumnPagoda,
        }
    }

    fn paint(&mut self, canvas: &mut Canvas, t: f32, weather: &Weather) {
        match self {
            Art::NightLake => night_lake::paint(canvas, t, weather),
            Art::FujiDawn(art) => art.paint(canvas, t, weather),
            Art::AutumnPagoda(art) => art.paint(canvas, t, weather),
        }
    }
}

#[derive(Debug, PartialEq)]
struct Shown {
    picture: Picture,
    look: Look,
    columns: u16,
    rows: u16,
    frame: f32,
    weather: Weather,
}

/// The picture on show. It is painted and turned into glyphs only when its frame, size, look, or
/// weather changes; in between, the same glyphs are copied into each redraw.
#[derive(Default)]
pub struct Scene {
    clock: f32,
    art: Option<Art>,
    canvas: Canvas,
    glyphs: Vec<Option<Glyph>>,
    shown: Option<Shown>,
}

impl Scene {
    /// Moves the picture on. It holds still for as long as this isn't called.
    pub fn advance(&mut self, seconds: f32) {
        self.clock += seconds;
    }

    pub fn draw(
        &mut self,
        buf: &mut Buffer,
        area: Rect,
        picture: Picture,
        look: Look,
        weather: Weather,
        theme: &Theme,
    ) {
        if area.is_empty() {
            return;
        }
        let shown = Shown {
            picture,
            look,
            columns: area.width,
            rows: area.height,
            frame: (self.clock * FPS).floor(),
            weather,
        };
        if self.shown.as_ref() != Some(&shown) {
            if self.art.as_ref().map(Art::picture) != Some(picture) {
                self.art = Art::new(picture);
            }
            let Some(art) = &mut self.art else { return };
            let t = shown.frame / FPS;
            self.canvas
                .resize(usize::from(area.width) * 2, usize::from(area.height) * 4);
            art.paint(&mut self.canvas, t, &weather);
            canvas::rain(&mut self.canvas, t, weather.rain, weather.wind);
            canvas::fireflies(&mut self.canvas, t, weather.crickets, picture.fireflies());
            canvas::brighten(&mut self.canvas, canvas::lightning(t, weather.thunder));
            self.glyphs = glyphs(&self.canvas, look, theme);
            self.shown = Some(shown);
        }
        let columns = usize::from(area.width);
        for (index, glyph) in self.glyphs.iter().enumerate() {
            let Some((symbol, fg, bg)) = *glyph else { continue };
            let (column, row) = ((index % columns) as u16, (index / columns) as u16);
            if let Some(cell) = buf.cell_mut((area.x + column, area.y + row)) {
                cell.set_char(symbol).set_fg(fg);
                if let Some(bg) = bg {
                    cell.set_bg(bg);
                }
            }
        }
    }
}

const BAYER: [u8; 16] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

fn threshold(x: usize, y: usize) -> f32 {
    (f32::from(BAYER[(y & 3) * 4 + (x & 3)]) + 0.5) / 16.0
}

type Glyph = (char, Color, Option<Color>);

/// One glyph per cell, row by row, from the canvas's dots eight at a time.
fn glyphs(canvas: &Canvas, look: Look, theme: &Theme) -> Vec<Option<Glyph>> {
    let dark = !theme.is_light();
    // Without the theme's colors there is no background to blend two colors against.
    let look = if look == Look::Blocks && !theme.has_rgb() {
        Look::Pixels
    } else {
        look
    };
    let (columns, rows) = (canvas.width / 2, canvas.height / 4);
    let mut glyphs = Vec::with_capacity(columns * rows);
    for row in 0..rows {
        for column in 0..columns {
            let (left, top) = (column * 2, row * 4);
            let dots: [Dot; 8] = std::array::from_fn(|index| canvas.at(left + index % 2, top + index / 2));
            glyphs.push(match look {
                Look::Blocks => halves(&dots, theme),
                Look::Dots | Look::Pixels => pattern(&dots, left, top, look, theme, dark),
            });
        }
    }
    glyphs
}

/// The glyph's bits, in the row-major order ratatui's braille and octant tables use.
fn bits(dots: &[Dot; 8], mut lit: impl FnMut(usize, &Dot) -> bool) -> usize {
    dots.iter()
        .enumerate()
        .filter(|(index, dot)| lit(*index, dot))
        .fold(0, |bits, (index, _)| bits | 1 << index)
}

fn pattern(dots: &[Dot; 8], left: usize, top: usize, look: Look, theme: &Theme, dark: bool) -> Option<Glyph> {
    if let Some(ink) = dots.iter().map(|dot| dot.ink).find(|ink| ink.is_figure()) {
        let figure = bits(dots, |_, dot| dot.ink == ink);
        return Some((OCTANTS[figure], figure_color(ink, theme), None));
    }
    let lit = bits(dots, |index, dot| {
        dot.solid || light(dot, dark) > threshold(left + index % 2, top + index / 2)
    });
    if lit == 0 {
        return None;
    }
    let glyphs = if look == Look::Pixels { &OCTANTS } else { &BRAILLE };
    Some((glyphs[lit], average(dots, lit, theme, dark), None))
}

fn halves(dots: &[Dot; 8], theme: &Theme) -> Option<Glyph> {
    let half = |dots: &[Dot]| -> Color {
        if let Some(ink) = dots.iter().map(|dot| dot.ink).find(|ink| ink.is_figure())
            && dots.iter().filter(|dot| dot.ink == ink).count() >= 2
        {
            return figure_color(ink, theme);
        }
        let colors = dots.iter().map(|dot| match dot.ink {
            Ink::Paint(color) => Some(color),
            _ => rgb(theme.mix(dot.light)),
        });
        mean(colors).map_or(theme.background(), to_color)
    };
    let blank = dots.iter().all(|dot| dot.ink == Ink::Theme && dot.light < 0.03);
    (!blank).then(|| ('▀', half(&dots[..4]), Some(half(&dots[4..]))))
}

/// How much of a dot to light. Painted dots light up with their color on a dark background, and
/// with their darkness on a light one, the way ink prints. They light a little more than their
/// shade, since unlit dots leave gaps of background between them.
fn light(dot: &Dot, dark: bool) -> f32 {
    match dot.ink {
        Ink::Paint(color) => {
            let luma = canvas::luma(color);
            unit((if dark { luma } else { 1.0 - luma }) * 1.4)
        }
        _ => dot.light,
    }
}

fn figure_color(ink: Ink, theme: &Theme) -> Color {
    if ink == Ink::Alert { theme.alert } else { theme.accent }
}

/// One color for a cell's lit dots, since a cell has only one.
fn average(dots: &[Dot; 8], lit: usize, theme: &Theme, dark: bool) -> Color {
    let shown = || {
        dots.iter()
            .enumerate()
            .filter(move |(index, _)| lit & 1 << index != 0)
            .map(|(_, dot)| dot)
    };
    let colors = shown().map(|dot| match dot.ink {
        Ink::Paint(color) => Some(color),
        _ => rgb(theme.mix(0.3 + 0.8 * dot.light)),
    });
    mean(colors).map_or_else(
        // Without the theme's colors there is nothing to average, so the shade stands for them all.
        || {
            let (sum, count) = shown().fold((0.0, 0.0), |(sum, count), dot| (sum + light(dot, dark), count + 1.0));
            theme.mix(0.3 + 0.8 * sum / f32::max(count, 1.0))
        },
        to_color,
    )
}

/// The mean of `colors`, unless one of them is a named terminal color that can't be blended.
fn mean(colors: impl Iterator<Item = Option<Rgb>>) -> Option<Rgb> {
    let (mut sum, mut count) = ([0.0; 3], 0.0);
    for color in colors {
        let color = color?;
        sum = [sum[0] + color[0], sum[1] + color[1], sum[2] + color[2]];
        count += 1.0;
    }
    (count > 0.0).then(|| sum.map(|channel| channel / count))
}

fn rgb(color: Color) -> Option<Rgb> {
    match color {
        Color::Rgb(r, g, b) => Some([f32::from(r), f32::from(g), f32::from(b)]),
        _ => None,
    }
}

fn to_color(color: Rgb) -> Color {
    let [r, g, b] = color.map(|channel| channel.round().clamp(0.0, 255.0) as u8);
    Color::Rgb(r, g, b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_rain_sound_rains_and_generated_noise_leaves_the_weather_alone() {
        let weather = Weather::from_sounds([
            ("rain-soft", 0.2),
            ("rain-window", 0.6),
            ("thunder-distant", 0.3),
            ("noise-brown", 1.0),
        ]);
        let expected = Weather {
            rain: 0.6,
            thunder: 0.3,
            ..Weather::default()
        };
        assert_eq!(weather, expected);
    }
}
