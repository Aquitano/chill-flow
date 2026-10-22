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
use canvas::{Canvas, Dot, Finish, Ink, Rgb, unit};

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

    /// The size a painted picture is laid out at, in its own pixels.
    fn painting(self) -> Option<(usize, usize)> {
        match self {
            Picture::FujiDawn => Some((fuji_dawn::WIDTH, fuji_dawn::HEIGHT)),
            Picture::AutumnPagoda => Some((autumn_pagoda::WIDTH, autumn_pagoda::HEIGHT)),
            Picture::Cover | Picture::NightLake => None,
        }
    }

    /// Whether the picture brings its own colors instead of the theme's.
    fn painted(self) -> bool {
        self.painting().is_some()
    }
}

/// Which characters draw a picture.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Look {
    /// Whichever suits the picture and the room it has.
    #[default]
    Auto,
    /// A painting's pixels as whole cells with a thin dark seam beside each, like a screen up
    /// close. One pixel to each half of a cell, so they need a wide player; any font has them.
    Blocks,
    /// A painting's pixels kept crisp, eight to a cell in two colors.
    Pixels,
    /// Painted finer and scaled smoothly, eight to a cell in two colors.
    Smooth,
    /// Braille dots on the background, with figures in solid pixels.
    Dots,
}

impl Look {
    pub const ALL: [Look; 5] = [Look::Auto, Look::Blocks, Look::Pixels, Look::Smooth, Look::Dots];

    pub fn label(self) -> &'static str {
        match self {
            Look::Auto => "Auto",
            Look::Blocks => "Blocks",
            Look::Pixels => "Pixels",
            Look::Smooth => "Smooth",
            Look::Dots => "Dots",
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Look::Auto => "auto",
            Look::Blocks => "blocks",
            Look::Pixels => "pixels",
            Look::Smooth => "smooth",
            Look::Dots => "dots",
        }
    }

    /// The look to draw `picture` with in `area`. Auto gives a painting blocks once each of its
    /// pixels can have most of a half cell, and crisp pixels before that; a picture in the
    /// theme's colors gets dots.
    fn of(self, picture: Picture, area: Rect, theme: &Theme) -> Look {
        let look = match (self, picture.painting()) {
            (Look::Auto, Some((width, height))) => {
                let room = (f32::from(area.width) / width as f32).max(f32::from(area.height) * 2.0 / height as f32);
                if room >= 0.75 { Look::Blocks } else { Look::Pixels }
            }
            (Look::Auto, None) => Look::Dots,
            (look, _) => look,
        };
        // Every look but dots paints the cells' backgrounds too, which a picture in the theme's
        // colors can only do knowing what those colors are.
        if picture.painted() || theme.has_rgb() {
            look
        } else {
            Look::Dots
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
const FPS: f64 = 12.0;
/// Pictures start their day over after a day of playing, so the time they're drawn at never
/// grows past what an `f32` keeps exact.
const FRAMES_A_DAY: u64 = 12 * 60 * 60 * 24;

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

    fn paint(&mut self, canvas: &mut Canvas, t: f32, weather: &Weather, finish: Finish) {
        match self {
            Art::NightLake => night_lake::paint(canvas, t, weather),
            Art::FujiDawn(art) => art.paint(canvas, t, weather, finish),
            Art::AutumnPagoda(art) => art.paint(canvas, t, weather, finish),
        }
    }
}

#[derive(Debug, PartialEq)]
struct Shown {
    picture: Picture,
    look: Look,
    columns: u16,
    rows: u16,
    frame: u64,
    weather: Weather,
}

/// The picture on show. It is painted and turned into glyphs only when its frame, size, look, or
/// weather changes; in between, the same glyphs are copied into each redraw.
#[derive(Default)]
pub struct Scene {
    clock: f64,
    art: Option<Art>,
    canvas: Canvas,
    glyphs: Vec<Option<Glyph>>,
    shown: Option<Shown>,
}

impl Scene {
    /// Moves the picture on. It holds still for as long as this isn't called.
    pub fn advance(&mut self, seconds: f32) {
        self.clock += f64::from(seconds);
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
            look: look.of(picture, area, theme),
            columns: area.width,
            rows: area.height,
            frame: (self.clock * FPS) as u64,
            weather,
        };
        if self.shown.as_ref() != Some(&shown) {
            if self.art.as_ref().map(Art::picture) != Some(picture) {
                self.art = Art::new(picture);
            }
            let Some(art) = &mut self.art else { return };
            let t = ((shown.frame % FRAMES_A_DAY) as f64 / FPS) as f32;
            let (columns, rows) = (usize::from(area.width), usize::from(area.height));
            match shown.look {
                Look::Blocks => self.canvas.resize(columns, rows * 2),
                _ => self.canvas.resize(columns * 2, rows * 4),
            }
            let finish = if shown.look == Look::Smooth {
                Finish::Smooth
            } else {
                Finish::Crisp
            };
            art.paint(&mut self.canvas, t, &weather, finish);
            canvas::rain(&mut self.canvas, t, weather.rain, weather.wind);
            canvas::fireflies(&mut self.canvas, t, weather.crickets, picture.fireflies());
            canvas::brighten(&mut self.canvas, canvas::lightning(t, weather.thunder));
            glyphs(&mut self.glyphs, &self.canvas, shown.look, theme, picture.painted());
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

/// One glyph per cell, row by row: from two of the canvas's dots each for blocks, eight for the
/// rest.
fn glyphs(glyphs: &mut Vec<Option<Glyph>>, canvas: &Canvas, look: Look, theme: &Theme, painted: bool) {
    let dark = !theme.is_light();
    glyphs.clear();
    if look == Look::Blocks {
        for row in 0..canvas.height / 2 {
            for column in 0..canvas.width {
                let (top, bottom) = (canvas.at(column, row * 2), canvas.at(column, row * 2 + 1));
                glyphs.push(Some(block(&top, &bottom, theme, painted)));
            }
        }
        return;
    }
    for row in 0..canvas.height / 4 {
        for column in 0..canvas.width / 2 {
            let (left, top) = (column * 2, row * 4);
            let dots: [Dot; 8] = std::array::from_fn(|index| canvas.at(left + index % 2, top + index / 2));
            glyphs.push(match look {
                Look::Pixels | Look::Smooth => two_colors(&dots, &OCTANTS, theme),
                Look::Auto | Look::Blocks | Look::Dots => pattern(&dots, left, top, theme, dark),
            });
        }
    }
}

/// A cell holding two of a painting's pixels, one above the other. Where they nearly match the
/// cell shows one pixel with a thin seam down its right side, darker toward the background, the
/// way pixels stand apart up close; a bright pixel fills its cell, and two that differ split it.
fn block(top: &Dot, bottom: &Dot, theme: &Theme, painted: bool) -> Glyph {
    let [upper, lower] = [top, bottom].map(|dot| color(dot, theme));
    match (top.ink.is_figure(), bottom.ink.is_figure()) {
        (true, true) => return ('█', figure_color(top.ink, theme), None),
        (true, false) => return ('▀', figure_color(top.ink, theme), Some(to_color(lower))),
        (false, true) => return ('▄', figure_color(bottom.ink, theme), Some(to_color(upper))),
        (false, false) => {}
    }
    if distance(upper, lower) >= 900.0 {
        return ('▀', to_color(upper), Some(to_color(lower)));
    }
    let pixel = canvas::mix(upper, lower, 0.5);
    if canvas::luma(pixel) > 0.72 {
        return ('█', to_color(pixel), Some(to_color(pixel)));
    }
    let behind = if painted {
        [0.0; 3]
    } else {
        color(&Dot::shade(0.0), theme)
    };
    ('▉', to_color(pixel), Some(to_color(canvas::mix(pixel, behind, 0.45))))
}

/// A dot's own color, with theme shades taken at face value since the cell's background is drawn
/// too. Without the theme's colors, rain over a painted picture falls in plain grey.
fn color(dot: &Dot, theme: &Theme) -> Rgb {
    match dot.ink {
        Ink::Paint(color) => color,
        _ => rgb_of(theme.mix(dot.light)).unwrap_or([dot.light * 255.0; 3]),
    }
}

/// Splits the cell's pixels into two colors, the way a photo prints best on a grid of glyphs that
/// each have a foreground and a background: the pixels nearer one color take the glyph's shape.
fn two_colors<const N: usize>(dots: &[Dot; N], glyphs: &[char], theme: &Theme) -> Option<Glyph> {
    let full = (1 << N) - 1;
    if let Some(ink) = dots.iter().map(|dot| dot.ink).find(|ink| ink.is_figure()) {
        let figure = bits(dots, |_, dot| dot.ink == ink);
        let rest = mean(
            dots.iter()
                .filter(|dot| dot.ink != ink)
                .map(|dot| Some(color(dot, theme))),
        );
        return Some(match rest {
            Some(rest) if figure != full => (glyphs[figure], figure_color(ink, theme), Some(to_color(rest))),
            _ => (glyphs[full], figure_color(ink, theme), None),
        });
    }
    let colors: [Rgb; N] = std::array::from_fn(|index| color(&dots[index], theme));
    let flat = mean(colors.iter().copied().map(Some))?;
    // Seeded by the pixel farthest from the cell's mean and the one farthest from that, so two
    // colors of the same brightness still part.
    let farthest = |from: Rgb| {
        (0..N).fold(0, |best, index| {
            if distance(colors[index], from) > distance(colors[best], from) {
                index
            } else {
                best
            }
        })
    };
    let first = farthest(flat);
    let second = farthest(colors[first]);
    if distance(colors[first], colors[second]) < 9.0 {
        return Some((' ', to_color(flat), Some(to_color(flat))));
    }
    let (mut front, mut back) = (colors[first], colors[second]);
    let mut shape = 0;
    for _ in 0..2 {
        shape = (0..N).fold(0, |shape, index| {
            let nearer = distance(colors[index], front) < distance(colors[index], back);
            if nearer { shape | 1 << index } else { shape }
        });
        let picked = |inside: bool| {
            mean(
                (0..N)
                    .filter(|index| (shape & 1 << index != 0) == inside)
                    .map(|index| Some(colors[index])),
            )
        };
        front = picked(true).unwrap_or(front);
        back = picked(false).unwrap_or(back);
    }
    Some(match shape {
        0 => (' ', to_color(back), Some(to_color(back))),
        shape if shape == full => (' ', to_color(front), Some(to_color(front))),
        shape => (glyphs[shape], to_color(front), Some(to_color(back))),
    })
}

fn distance(a: Rgb, b: Rgb) -> f32 {
    (0..3).map(|index| (a[index] - b[index]).powi(2)).sum()
}

/// The glyph's bits, in the row-major order ratatui's braille and octant tables use.
fn bits<const N: usize>(dots: &[Dot; N], mut lit: impl FnMut(usize, &Dot) -> bool) -> usize {
    dots.iter()
        .enumerate()
        .filter(|(index, dot)| lit(*index, dot))
        .fold(0, |bits, (index, _)| bits | 1 << index)
}

fn pattern(dots: &[Dot; 8], left: usize, top: usize, theme: &Theme, dark: bool) -> Option<Glyph> {
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
    Some((BRAILLE[lit], average(dots, lit, theme, dark), None))
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
        _ => rgb_of(theme.mix(0.3 + 0.8 * dot.light)),
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

fn rgb_of(color: Color) -> Option<Rgb> {
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
    fn a_cell_of_two_colors_keeps_both_with_the_shape_between_them() {
        let theme = Theme::new(Some(([205, 214, 244], [30, 30, 46])));
        let (red, blue) = ([200.0, 40.0, 40.0], [40.0, 40.0, 200.0]);
        let left_red: [Dot; 8] = std::array::from_fn(|index| Dot::paint(if index % 2 == 0 { red } else { blue }));
        let glyph = two_colors(&left_red, &OCTANTS, &theme);
        assert_eq!(
            glyph,
            Some(('▌', Color::Rgb(200, 40, 40), Some(Color::Rgb(40, 40, 200))))
        );

        let as_bright_blue = [40.0, 71.0, 200.0];
        let even: [Dot; 8] = std::array::from_fn(|index| Dot::paint(if index % 2 == 0 { red } else { as_bright_blue }));
        assert_eq!(
            two_colors(&even, &OCTANTS, &theme),
            Some(('▌', Color::Rgb(200, 40, 40), Some(Color::Rgb(40, 71, 200))))
        );
    }

    #[test]
    fn blocks_seam_a_calm_pixel_fill_a_bright_one_and_split_two_that_differ() {
        let theme = Theme::new(Some(([205, 214, 244], [30, 30, 46])));
        let (dusk, snow) = (Dot::paint([90.0, 80.0, 150.0]), Dot::paint([240.0, 235.0, 250.0]));
        assert_eq!(
            block(&dusk, &dusk, &theme, true),
            ('▉', Color::Rgb(90, 80, 150), Some(Color::Rgb(50, 44, 83)))
        );
        assert_eq!(block(&snow, &snow, &theme, true).0, '█');
        assert_eq!(
            block(&snow, &dusk, &theme, true),
            ('▀', Color::Rgb(240, 235, 250), Some(Color::Rgb(90, 80, 150)))
        );
    }

    #[test]
    fn auto_gives_a_painting_blocks_only_once_there_is_room_for_its_pixels() {
        let theme = Theme::new(Some(([205, 214, 244], [30, 30, 46])));
        let (player, window) = (Rect::new(0, 0, 63, 20), Rect::new(0, 0, 200, 27));
        assert_eq!(Look::Auto.of(Picture::FujiDawn, player, &theme), Look::Pixels);
        assert_eq!(Look::Auto.of(Picture::FujiDawn, window, &theme), Look::Blocks);
        assert_eq!(Look::Auto.of(Picture::NightLake, window, &theme), Look::Dots);
        assert_eq!(
            Look::Blocks.of(Picture::NightLake, window, &Theme::new(None)),
            Look::Dots
        );
    }

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
