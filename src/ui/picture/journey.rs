//! A landscape in plain text that scrolls past in layers, nearer ones faster, in the theme's own
//! ink on its paper. Each layer says how much ink it wants in a cell, and that is drawn as a
//! ramp of characters, ordered-dithered so even ground reads as a pattern rather than noise. Clouds
//! are their contour lines. The weather in it comes from the ambience that's playing, and the land
//! follows the seasons: blossom in spring, tall grass in summer, falling leaves in autumn, and
//! snow in winter.

use ratatui::style::Color;

use super::canvas::{fbm, hash, lightning, noise, unit};
use super::{Glyph, Season, Weather, threshold};
use crate::ui::theme::Theme;

/// How fast each layer scrolls by, in cells a second, from the clouds to the grass in front. A
/// layer moves a whole cell at a time, so its texture travels with it instead of shimmering.
const CLOUDS: f32 = 0.35;
const HILLS: f32 = 0.8;
const FIELDS: f32 = 1.8;
const FRONT: f32 = 4.0;

/// From the lightest ink to the heaviest.
const RAMP: [char; 8] = ['.', ':', '-', '=', '+', '/', 'X', '#'];

struct Inks {
    theme: Theme,
    /// The solid ground in front: full ink on a light theme, and a dim shade on a dark one, where
    /// a wide light block would glare.
    ground: Color,
}

impl Inks {
    fn shade(&self, ink: f32) -> Color {
        self.theme.mix(0.3 + 0.65 * unit(ink))
    }

    /// Snow lying on the ground: the paper's color on a light theme, where the ground is dark, and
    /// the brightest ink on a dark one.
    fn snow(&self) -> Color {
        if self.theme.is_light() {
            self.theme.background()
        } else {
            self.shade(0.95)
        }
    }

    /// Paper on the ground color. Without the theme's colors a cell can't swap them, so it's drawn
    /// solid instead.
    fn solid(&self, symbol: char) -> Glyph {
        if self.theme.has_rgb() {
            (symbol, self.theme.background(), Some(self.ground))
        } else {
            ('█', self.theme.text(), None)
        }
    }
}

struct Frame<'a> {
    cells: &'a mut Vec<Option<Glyph>>,
    columns: usize,
    rows: usize,
}

impl Frame<'_> {
    fn index(&self, x: isize, y: isize) -> Option<usize> {
        let inside = x >= 0 && y >= 0 && (x as usize) < self.columns && (y as usize) < self.rows;
        inside.then(|| y as usize * self.columns + x as usize)
    }

    fn set(&mut self, x: isize, y: isize, glyph: Glyph) {
        if let Some(index) = self.index(x, y) {
            self.cells[index] = Some(glyph);
        }
    }

    fn is_empty(&self, x: isize, y: isize) -> bool {
        self.index(x, y).is_some_and(|index| self.cells[index].is_none())
    }

    /// Draws `symbol` over whatever is there, keeping the solid ground behind it.
    fn over(&mut self, x: isize, y: isize, symbol: char, color: Color, inks: &Inks) {
        let Some(index) = self.index(x, y) else { return };
        let ground = self.cells[index]
            .and_then(|(_, _, bg)| bg)
            .filter(|&bg| bg == inks.ground);
        self.cells[index] = Some((symbol, color, ground));
    }
}

pub fn draw(
    cells: &mut Vec<Option<Glyph>>,
    (columns, rows): (usize, usize),
    t: f32,
    weather: &Weather,
    night: bool,
    season: Season,
    theme: &Theme,
) {
    cells.clear();
    cells.resize(columns * rows, None);
    if columns == 0 || rows == 0 {
        return;
    }
    let inks = Inks {
        theme: *theme,
        ground: if theme.is_light() { theme.text() } else { theme.mix(0.3) },
    };
    let mut frame = Frame { cells, columns, rows };
    let h = rows as f32;
    let flash = lightning(t, weather.thunder);
    let scroll = |speed: f32| (t * speed).floor() as i64;
    let along = |offset: i64| (0..columns as i64).map(move |x| x + offset);

    let hills: Vec<f32> = along(scroll(HILLS)).map(|world| hill(world, h)).collect();
    let fields: Vec<f32> = along(scroll(FIELDS))
        .map(|world| h * 0.64 - h * 0.03 * fbm(world as f32 / 16.0, 1.7, 3, 12))
        .collect();
    let front: Vec<f32> = along(scroll(FRONT)).map(|world| grass(world, h)).collect();

    let drift = scroll(CLOUDS * (1.0 + weather.wind * 2.0));
    if night {
        stars(&mut frame, &hills, t, weather, &inks);
    }
    clouds(&mut frame, &hills, drift, weather, flash, &inks);
    if night {
        moon(&mut frame, &inks);
    }
    far_hills(&mut frame, &hills, &fields, scroll(HILLS), weather, &inks);
    if weather.waves > 0.02 {
        sea(&mut frame, &fields, &front, scroll(FIELDS), t, weather, &inks);
    } else {
        meadow(&mut frame, &fields, &front, scroll(FIELDS), season, &inks);
    }
    if weather.stream > 0.02 {
        creek(&mut frame, &front, t, weather, &inks);
    }
    birds(&mut frame, t, weather, &inks);
    fireflies(&mut frame, t, weather, &inks);
    foreground(&mut frame, &front, scroll(FRONT), t, weather, season, &inks);
    leaves(&mut frame, t, weather, season, &inks);
    sparks(&mut frame, t, weather, &inks);
    if season == Season::Winter {
        snow(&mut frame, t, weather, &inks);
    } else {
        rain(&mut frame, t, weather, &inks);
    }
    if flash >= 0.7 {
        bolt(&mut frame, &hills, t, &inks);
    }
}

fn hill(world: i64, h: f32) -> f32 {
    let x = world as f32;
    h * 0.56 - h * 0.12 * fbm(x / 30.0, 0.3, 3, 11) - h * 0.04 * (x / 13.0).sin()
}

/// The top of the grass in front, with a tall blade here and there and now and then a stand of
/// pines.
fn grass(world: i64, h: f32) -> f32 {
    let x = world as f32;
    let ground = h * 0.87;
    let top = ground - h * 0.03 * fbm(x / 7.0, 2.9, 2, 13) - h * 0.05 * hash(world, 0, 15).powi(5);
    pine(world, h).map_or(top, |pine| top.min(ground - pine))
}

/// How tall a stand of pines is at `world`, if one stands there.
fn pine(world: i64, h: f32) -> Option<f32> {
    let stand = world.div_euclid(17);
    if hash(stand, 1, 14) <= 0.55 {
        return None;
    }
    let middle = stand as f32 * 17.0 + 8.5 + (hash(stand, 4, 14) - 0.5) * 5.0;
    let half = 3.0 + 3.0 * hash(stand, 3, 14);
    let tall = h * (0.1 + 0.12 * hash(stand, 2, 14));
    let off = (world as f32 - middle).abs() / half;
    (off < 1.0).then(|| tall * (1.0 - off) * (0.85 + 0.15 * hash(world, 5, 14)))
}

/// The ramp character for `ink`, dithered by where the cell sits in its layer.
fn ramp(ink: f32, world: i64, y: usize) -> Option<char> {
    let step = (unit(ink) * RAMP.len() as f32 + threshold(world as usize, y) - 0.5).floor();
    (step >= 0.0).then(|| RAMP[(step as usize).min(RAMP.len() - 1)])
}

/// The character for a crest at `top`, from how steeply the ground runs across it.
fn crest(top: f32, slope: f32) -> char {
    match slope {
        slope if slope > 0.6 => '\\',
        slope if slope < -0.6 => '/',
        _ if top.fract() < 0.5 => '-',
        _ => '_',
    }
}

/// The character that follows an edge, from which way a shape gets denser across and down.
fn outline(across: f32, down: f32) -> char {
    // A cell is about twice as tall as it is wide.
    let down = down * 0.5;
    if down.abs() > across.abs() * 1.5 {
        if down > 0.0 { '-' } else { '_' }
    } else if across.abs() > down.abs() * 2.5 {
        if across > 0.0 { '(' } else { ')' }
    } else if across * down > 0.0 {
        '/'
    } else {
        '\\'
    }
}

fn stars(frame: &mut Frame, hills: &[f32], t: f32, weather: &Weather, inks: &Inks) {
    for (x, &top) in hills.iter().enumerate() {
        for y in 0..(top - 1.0).max(0.0) as usize {
            let seed = hash(x as i64, y as i64, 31);
            if seed < 0.012 * (1.0 - weather.rain) {
                let symbol = if (t * 1.3 + seed * 400.0).sin() > 0.6 { '+' } else { '.' };
                frame.set(x as isize, y as isize, (symbol, inks.shade(0.4), None));
            }
        }
    }
}

/// A full moon in front of the clouds, solid, rounded to half a cell at its top and bottom.
fn moon(frame: &mut Frame, inks: &Inks) {
    let (w, h) = (frame.columns as f32, frame.rows as f32);
    let (cx, cy) = (w * 0.8, h * 0.16);
    let ry = (h * 0.08).max(1.5);
    let rx = ry * 2.1;
    let inside = |x: isize, y: f32| ((x as f32 + 0.5 - cx) / rx).hypot((y - cy) / ry) < 1.0;
    for y in (cy - ry - 1.0) as isize..=(cy + ry + 1.0) as isize {
        for x in (cx - rx - 1.0) as isize..=(cx + rx + 1.0) as isize {
            let symbol = match (inside(x, y as f32 + 0.25), inside(x, y as f32 + 0.75)) {
                (true, true) => '█',
                (true, false) => '▀',
                (false, true) => '▄',
                (false, false) => continue,
            };
            frame.set(x, y, (symbol, inks.shade(0.6), None));
        }
    }
}

/// Clouds drawn as their contour lines, so a thick one shows rings within rings. More of them,
/// and heavier, as rain sets in; a lightning flash lights them up.
fn clouds(frame: &mut Frame, hills: &[f32], drift: i64, weather: &Weather, flash: f32, inks: &Inks) {
    let h = frame.rows as f32;
    let cover = 0.73 - weather.rain * 0.1;
    let density = |x: f32, y: f32| {
        let sky = 1.0 - ((y / h - 0.2) / 0.2).powi(2);
        fbm(x / 13.0, y / 3.2, 3, 21) + 0.2 * sky.max(-1.0) - 0.1
    };
    let level = |value: f32| ((value - cover) / 0.07).floor().min(1.0) as i32;
    for (x, &top) in hills.iter().enumerate() {
        let world = (x as i64 + drift) as f32 + 0.5;
        for y in 0..(top - 1.0).max(0.0) as usize {
            let wy = y as f32 + 0.5;
            let here = density(world, wy);
            if here < cover {
                continue;
            }
            let ring = level(here);
            let (left, right) = (density(world - 1.0, wy), density(world + 1.0, wy));
            let (up, down) = (density(world, wy - 1.0), density(world, wy + 1.0));
            let symbol = if [left, right, up, down].into_iter().any(|near| level(near) < ring) {
                outline(right - left, down - up)
            } else {
                ' '
            };
            let ink = 0.35 + 0.2 * weather.rain - 0.08 * ring as f32 + flash * 0.6;
            frame.set(x as isize, y as isize, (symbol, inks.shade(ink), None));
        }
    }
}

/// Distant hills, too far off for texture: their crest, the ridges behind it, and a few specks.
fn far_hills(frame: &mut Frame, hills: &[f32], fields: &[f32], offset: i64, weather: &Weather, inks: &Inks) {
    let last = hills.len() - 1;
    let ridge = |x: usize, k: usize| {
        let world = (x as i64 + offset) as f32;
        let spread = if k == 0 {
            0.0
        } else {
            2.0 * fbm(world / 11.0, k as f32 * 3.1, 2, 34)
        };
        hills[x] + 2.6 * k as f32 + spread
    };
    for (x, &top) in hills.iter().enumerate() {
        let world = x as i64 + offset;
        let first = top.max(0.0) as usize;
        for k in 0..4 {
            let line = ridge(x, k);
            if line >= fields[x] - 1.0 {
                break;
            }
            let slope = ridge((x + 1).min(last), k) - ridge(x.saturating_sub(1), k);
            frame.set(
                x as isize,
                line as isize,
                (crest(line, slope), inks.shade(0.35 - 0.07 * k as f32), None),
            );
        }
        for y in first + 1..(fields[x].max(0.0) as usize).min(frame.rows) {
            if hash(world, y as i64, 33) < 0.04 && frame.is_empty(x as isize, y as isize) {
                frame.set(x as isize, y as isize, ('.', inks.shade(0.1), None));
            }
        }
        // A village on the hills with its windows lit, while the café murmurs.
        let stretch = world as f32 / 23.0;
        let place = stretch.fract() * 23.0;
        let lit = hash(world, 2, 42) < 0.4 + weather.cafe * 0.6;
        if weather.cafe > 0.02 && hash(stretch.floor() as i64, 1, 41) > 0.5 && (10.0..13.0).contains(&place) && lit {
            let window = if hash(world, 3, 42) > 0.5 { '.' } else { ':' };
            frame.set(x as isize, first as isize + 1, (window, inks.theme.accent, None));
        }
    }
}

/// The fields between the hills and the grass: furrowed, heavier toward the front, with a dark
/// hedge here and there. Blossom dots them in spring, autumn's are harvested and lighter, and
/// winter's lie under snow with only a trace of their furrows.
fn meadow(frame: &mut Frame, fields: &[f32], front: &[f32], offset: i64, season: Season, inks: &Inks) {
    let (base, deepen, furrows) = match season {
        Season::Winter => (0.04, 0.12, 0.08),
        Season::Autumn => (0.26, 0.22, 0.22),
        Season::Auto | Season::Spring | Season::Summer => (0.34, 0.3, 0.18),
    };
    for (x, &top) in fields.iter().enumerate() {
        let world = x as i64 + offset;
        let wx = world as f32;
        let slope = fields[(x + 1).min(fields.len() - 1)] - fields[x.saturating_sub(1)];
        let first = top.max(0.0) as usize;
        let crest_ink = inks.shade(if season == Season::Winter { 0.95 } else { 0.6 });
        frame.set(x as isize, first as isize, (crest(top, slope), crest_ink, None));
        for y in first + 1..(front[x].ceil().max(0.0) as usize).min(frame.rows) {
            let wy = y as f32;
            let depth = unit((wy - top) / (front[x] - top).max(1.0));
            if fbm(wx / 11.0, wy / 1.3, 2, 53) > 0.73 - depth * 0.05 {
                frame.set(x as isize, y as isize, inks.solid(' '));
                continue;
            }
            if season == Season::Spring && hash(world, y as i64, 57) < 0.025 {
                let symbol = if hash(world, y as i64, 58) > 0.5 { '*' } else { 'o' };
                frame.set(x as isize, y as isize, (symbol, inks.theme.alert, None));
                continue;
            }
            let furrow = 0.5 + 0.5 * (wy * 1.6 + 4.0 * fbm(wx / 18.0, wy / 5.0, 2, 52)).sin();
            let ink = base + deepen * depth + furrows * furrow;
            if let Some(symbol) = ramp(ink, world, y) {
                frame.set(x as isize, y as isize, (symbol, inks.shade(ink), None));
            }
        }
    }
}

fn sea(frame: &mut Frame, fields: &[f32], front: &[f32], offset: i64, t: f32, weather: &Weather, inks: &Inks) {
    let level = fields.iter().copied().fold(frame.rows as f32, f32::min).max(0.0);
    for (x, &near) in front.iter().enumerate() {
        let world = x as i64 + offset;
        let wx = world as f32;
        frame.set(x as isize, level as isize, ('_', inks.shade(0.5), None));
        for y in level as usize + 1..(near.ceil().max(0.0) as usize).min(frame.rows) {
            let wy = y as f32;
            let depth = unit((wy - level) / (near - level).max(1.0));
            let swell = (wx / (3.0 + depth * 5.0) - t * (1.0 + weather.wind) + wy * 1.3).sin();
            let crest = swell * (0.5 + 0.5 * noise(wx / 9.0, wy, 54)) * (0.5 + 0.5 * weather.waves);
            let symbol = match crest {
                crest if crest > 0.55 => '~',
                crest if crest > 0.3 => '-',
                _ => ' ',
            };
            frame.set(x as isize, y as isize, (symbol, inks.shade(0.3 + 0.4 * depth), None));
        }
    }
}

fn creek(frame: &mut Frame, front: &[f32], t: f32, weather: &Weather, inks: &Inks) {
    let bed = front.iter().copied().fold(0.0, f32::max);
    for (x, &top) in front.iter().enumerate() {
        let flow = x as f32 + t * (FRONT + 3.0);
        for y in (bed - 3.0).max(0.0) as usize..(top - 0.5).max(0.0) as usize {
            let ripple = (flow / 2.3 + y as f32 * 1.7).sin() + noise(flow / 5.0, y as f32, 55) - 0.5;
            if ripple > 1.0 - weather.stream * 0.6 {
                frame.set(x as isize, y as isize, ('~', inks.theme.calm, None));
            }
        }
    }
}

fn birds(frame: &mut Frame, t: f32, weather: &Weather, inks: &Inks) {
    if weather.birds <= 0.02 {
        return;
    }
    let (w, h) = (frame.columns as f32, frame.rows as f32);
    let period = (w + 30.0) / 5.0;
    let flight = (t % period) / period;
    let count = 3 + (weather.birds * 5.0).round() as usize;
    let lead = w + 10.0 - flight * (w + 30.0);
    for bird in 0..count {
        let k = bird as f32;
        let x = lead + k * 3.0 + (k * 1.7).sin() * 1.5;
        let y = h * 0.22 + (flight * 6.0 + k).sin() * 1.2 + (bird % 2) as f32;
        let symbol = if (t * 4.0 + k).sin() > 0.0 { 'v' } else { '^' };
        frame.set(x as isize, y as isize, (symbol, inks.shade(0.8), None));
    }
}

fn fireflies(frame: &mut Frame, t: f32, weather: &Weather, inks: &Inks) {
    let (w, h) = (frame.columns as f32, frame.rows as f32);
    let count = (weather.crickets * w * 0.08).round() as i64;
    for fly in 0..count {
        let i = fly as f32;
        let x = hash(fly, 1, 61) * w + (t * 0.3 + i).sin() * 3.0;
        let y = h * (0.66 + 0.12 * hash(fly, 2, 61)) + (t * 0.5 + i * 1.7).sin();
        let glow = (t * (1.2 + hash(fly, 3, 61)) + i * 2.1).sin();
        if glow > 0.3 {
            let symbol = if glow > 0.8 { '*' } else { '.' };
            frame.over(x as isize, y as isize, symbol, inks.theme.accent, inks);
        }
    }
}

/// The grass in front, solid but for a few light blades, topped by blades that lean with the wind.
/// Summer grows more of them, spring puts blossom on the pines, and winter lays snow over it all.
fn foreground(frame: &mut Frame, front: &[f32], offset: i64, t: f32, weather: &Weather, season: Season, inks: &Inks) {
    let (blades, tufts) = if season == Season::Summer {
        (0.8, 0.45)
    } else {
        (0.92, 0.6)
    };
    for (x, &top) in front.iter().enumerate() {
        let world = x as i64 + offset;
        let first = top.max(0.0);
        if first.fract() >= 0.5 {
            frame.set(x as isize, first as isize, ('▄', inks.ground, None));
        }
        let blade = hash(world, 1, 72) > blades;
        for y in first.round() as usize..frame.rows {
            let below = y as f32 - first;
            let seed = hash(world, y as i64, 71);
            let symbol = match () {
                _ if blade && below < 2.0 => '|',
                _ if seed > 0.985 => '\'',
                _ if seed > 0.97 => '.',
                _ => ' ',
            };
            frame.set(x as isize, y as isize, inks.solid(symbol));
        }
        let row = first.round() as isize;
        match season {
            Season::Winter => {
                if first.fract() >= 0.5 {
                    frame.set(x as isize, first as isize, ('▄', inks.snow(), None));
                } else if let Some(index) = frame.index(x as isize, row)
                    && let Some(ground) = frame.cells[index].and_then(|(_, _, bg)| bg)
                {
                    frame.cells[index] = Some(('▀', inks.snow(), Some(ground)));
                }
                continue;
            }
            Season::Spring if pine(world, frame.rows as f32).is_some() && hash(world, 2, 73) > 0.55 => {
                frame.over(
                    x as isize,
                    row,
                    if hash(world, 3, 73) > 0.5 { '*' } else { 'o' },
                    inks.theme.alert,
                    inks,
                );
                continue;
            }
            _ => {}
        }
        if noise(world as f32 * 1.3, 0.2, 72) > tufts && first >= 1.0 {
            let lean = (t * 1.8 + world as f32 * 0.4).sin() * weather.wind;
            let symbol = match lean {
                lean if lean > 0.15 => '/',
                lean if lean < -0.15 => '\\',
                _ => '|',
            };
            let y = first.round() as isize - 1;
            if !frame.is_empty(x as isize, y + 1) {
                frame.over(x as isize, y, symbol, inks.shade(0.85), inks);
            }
        }
    }
}

/// Leaves blown past by the wind. Autumn's fall even on a still day and in its own color, spring
/// blows blossom petals instead, and winter has none.
fn leaves(frame: &mut Frame, t: f32, weather: &Weather, season: Season, inks: &Inks) {
    let gusts = ((weather.wind - 0.2) * 14.0).max(0.0);
    let (count, color) = match season {
        Season::Winter => return,
        Season::Autumn => (4.0 + gusts, inks.theme.accent),
        Season::Spring => (3.0 + gusts, inks.theme.alert),
        Season::Auto | Season::Summer if weather.wind > 0.25 => (gusts, inks.shade(0.7)),
        Season::Auto | Season::Summer => return,
    };
    let (w, h) = (frame.columns as f32, frame.rows as f32);
    let count = count.round() as i64;
    for leaf in 0..count {
        let speed = 7.0 + 5.0 * hash(leaf, 1, 81);
        let x = (hash(leaf, 2, 81) * (w + 20.0) - t * speed).rem_euclid(w + 20.0) - 10.0;
        let y = h * (0.35 + 0.4 * hash(leaf, 3, 81)) + (t * 2.0 + leaf as f32).sin() * 1.5;
        let symbol = if (t * 5.0 + leaf as f32).sin() > 0.0 { ',' } else { '`' };
        frame.over(x as isize, y as isize, symbol, color, inks);
    }
}

fn sparks(frame: &mut Frame, t: f32, weather: &Weather, inks: &Inks) {
    if weather.fire <= 0.02 {
        return;
    }
    let (w, h) = (frame.columns as f32, frame.rows as f32);
    let count = (weather.fire * 12.0).round() as i64;
    for spark in 0..count {
        let life = 2.0 + hash(spark, 1, 91) * 1.5;
        let cycle = t / life + hash(spark, 2, 91);
        let (round, age) = (cycle.floor() as i64, cycle.fract());
        let x = w * (0.35 + 0.3 * hash(spark, round, 92)) + (t * 3.0 + spark as f32).sin() * age * 2.0;
        let y = h - age * h * 0.45;
        let (symbol, color) = if age < 0.4 {
            ('*', inks.theme.alert)
        } else {
            ('.', inks.theme.accent)
        };
        frame.over(x as isize, y as isize, symbol, color, inks);
    }
}

fn rain(frame: &mut Frame, t: f32, weather: &Weather, inks: &Inks) {
    if weather.rain <= 0.02 {
        return;
    }
    let (w, h) = (frame.columns as f32, frame.rows as f32);
    let drops = (weather.rain * w * 0.3).round() as i64;
    let slant = weather.wind * 0.8;
    let symbol = if slant > 0.2 { '/' } else { '|' };
    for drop in 0..drops {
        let speed = 1.6 + 0.6 * hash(drop, 1, 101);
        let y = ((t * speed + hash(drop, 2, 101)) % 1.1) * h - h * 0.05;
        let x = hash(drop, 3, 101) * w * (1.0 + slant) - y * slant;
        frame.over(x as isize, y as isize, symbol, inks.shade(0.55), inks);
        frame.over((x + slant) as isize, y as isize - 1, symbol, inks.shade(0.3), inks);
    }
}

/// Winter's flakes drifting down, a few always and many more while rain plays, blown by the wind.
fn snow(frame: &mut Frame, t: f32, weather: &Weather, inks: &Inks) {
    let (w, h) = (frame.columns as f32, frame.rows as f32);
    let flakes = (w * (0.12 + weather.rain * 0.3)).round() as i64;
    for flake in 0..flakes {
        let speed = 0.12 + 0.08 * hash(flake, 1, 121);
        let y = ((t * speed + hash(flake, 2, 121)) % 1.05) * h - h * 0.03;
        let drift = (t * 0.8 + flake as f32).sin() * 1.5 + y * weather.wind * 0.8;
        let x = hash(flake, 3, 121) * (w + h * weather.wind) - drift;
        let symbol = if hash(flake, 4, 121) > 0.7 { '*' } else { '.' };
        frame.over(x as isize, y as isize, symbol, inks.shade(0.95), inks);
    }
}

fn bolt(frame: &mut Frame, hills: &[f32], t: f32, inks: &Inks) {
    let slot = (t * 0.8).floor() as i64;
    let mut x = (hash(slot, 5, 111) * frame.columns as f32) as isize;
    let bottom = hills.get(x.max(0) as usize).copied().unwrap_or(0.0) as isize;
    for y in 0..bottom {
        let step: isize = if hash(slot, y as i64, 112) > 0.5 { 1 } else { -1 };
        let symbol = if step > 0 { '\\' } else { '/' };
        frame.set(x, y, (symbol, inks.theme.text(), None));
        x += step;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn in_summer_only_what_can_be_heard_brings_its_color_into_the_landscape() {
        let theme = Theme::new(Some(([205, 214, 244], [30, 30, 46])));
        let mut cells = Vec::new();
        let mut colors = |weather: Weather| {
            draw(&mut cells, (160, 36), 40.0, &weather, false, Season::Summer, &theme);
            let shows = |color: Color| cells.iter().flatten().any(|&(_, fg, _)| fg == color);
            [theme.calm, theme.accent, theme.alert].map(shows)
        };
        assert_eq!(colors(Weather::default()), [false; 3]);
        let heard = Weather {
            stream: 0.6,
            crickets: 0.6,
            fire: 0.6,
            ..Weather::default()
        };
        assert_eq!(colors(heard), [true; 3]);
    }

    #[test]
    fn spring_blossom_and_autumn_leaves_bring_color_without_a_sound() {
        let theme = Theme::new(Some(([205, 214, 244], [30, 30, 46])));
        let mut cells = Vec::new();
        let mut shows = |season: Season, color: Color| {
            draw(&mut cells, (160, 36), 40.0, &Weather::default(), false, season, &theme);
            cells.iter().flatten().any(|&(_, fg, _)| fg == color)
        };
        assert!(shows(Season::Spring, theme.alert));
        assert!(shows(Season::Autumn, theme.accent));
    }
}
