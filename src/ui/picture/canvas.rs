pub type Rgb = [f32; 3];

pub const fn rgb(hex: u32) -> Rgb {
    [
        ((hex >> 16) & 0xff) as f32,
        ((hex >> 8) & 0xff) as f32,
        (hex & 0xff) as f32,
    ]
}

pub fn mix(from: Rgb, to: Rgb, amount: f32) -> Rgb {
    [0, 1, 2].map(|index| from[index] + (to[index] - from[index]) * amount)
}

pub fn lerp(from: f32, to: f32, amount: f32) -> f32 {
    from + (to - from) * amount
}

pub fn unit(value: f32) -> f32 {
    value.clamp(0.0, 1.0)
}

/// Relative luminance of an sRGB color on a 0..1 scale, without linearizing.
pub fn luma(color: Rgb) -> f32 {
    (0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]) / 255.0
}

/// Picks a color along `stops`, each a position from 0 to 1 and the color there.
pub fn ramp(stops: &[(f32, Rgb)], at: f32) -> Rgb {
    let at = unit(at);
    for pair in stops.windows(2) {
        let ((from_at, from), (to_at, to)) = (pair[0], pair[1]);
        if at <= to_at {
            let span = to_at - from_at;
            return mix(from, to, if span > 0.0 { (at - from_at) / span } else { 0.0 });
        }
    }
    stops.last().map_or([0.0; 3], |stop| stop.1)
}

/// The integer hash behind ascii-magic's value noise, kept bit for bit so ported pictures keep
/// their shapes.
pub fn hash(x: i64, y: i64, seed: i64) -> f32 {
    let mixed = x
        .wrapping_mul(374_761_393)
        .wrapping_add(y.wrapping_mul(668_265_263))
        .wrapping_add(seed.wrapping_mul(2_147_483_647));
    let h = mixed as i32 as u32;
    let h = (h ^ (h >> 13)).wrapping_mul(1_274_126_177);
    (h ^ (h >> 16)) as f32 / 4_294_967_296.0
}

/// 2D value noise from 0 to 1.
pub fn noise(x: f32, y: f32, seed: i64) -> f32 {
    let smooth = |t: f32| t * t * (3.0 - 2.0 * t);
    let (x0, y0) = (x.floor(), y.floor());
    let (u, v) = (smooth(x - x0), smooth(y - y0));
    let (xi, yi) = (x0 as i64, y0 as i64);
    let top = lerp(hash(xi, yi, seed), hash(xi + 1, yi, seed), u);
    let bottom = lerp(hash(xi, yi + 1, seed), hash(xi + 1, yi + 1, seed), u);
    lerp(top, bottom, v)
}

/// A few octaves of `noise`, still from 0 to 1.
pub fn fbm(x: f32, y: f32, octaves: u32, seed: i64) -> f32 {
    let (mut sum, mut amplitude, mut frequency, mut total) = (0.0, 0.5, 1.0, 0.0);
    for octave in 0..octaves {
        sum += amplitude * noise(x * frequency, y * frequency, seed + i64::from(octave) * 17);
        total += amplitude;
        amplitude *= 0.5;
        frequency *= 2.0;
    }
    sum / total
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub enum Ink {
    /// A shade of the terminal's own text color, set by the dot's light.
    #[default]
    Theme,
    /// A figure in the theme's yellow. A cell holding a figure shows only the figure.
    Accent,
    /// A figure in the theme's red.
    Alert,
    /// Painted color, for pictures that bring their own palette.
    Paint(Rgb),
}

impl Ink {
    pub fn is_figure(self) -> bool {
        matches!(self, Ink::Accent | Ink::Alert)
    }
}

/// One dot of a picture, before cells of eight become glyphs.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Dot {
    /// How much of the dot is lit, from 0 to 1. Painted dots take theirs from their color.
    pub light: f32,
    pub ink: Ink,
    /// Drawn whatever its light, for thin things that dithering would break up.
    pub solid: bool,
}

impl Dot {
    pub fn shade(light: f32) -> Dot {
        Dot {
            light,
            ..Dot::default()
        }
    }

    pub fn solid(light: f32) -> Dot {
        Dot {
            light,
            solid: true,
            ..Dot::default()
        }
    }

    pub fn figure(ink: Ink) -> Dot {
        Dot {
            light: 1.0,
            ink,
            solid: true,
        }
    }

    pub fn paint(color: Rgb) -> Dot {
        Dot {
            ink: Ink::Paint(color),
            ..Dot::default()
        }
    }
}

/// A grid of square dots, two across and four down per terminal cell.
#[derive(Debug, Default)]
pub struct Canvas {
    pub width: usize,
    pub height: usize,
    dots: Vec<Dot>,
}

impl Canvas {
    pub fn resize(&mut self, width: usize, height: usize) {
        self.width = width;
        self.height = height;
        self.dots.clear();
        self.dots.resize(width * height, Dot::default());
    }

    pub fn at(&self, x: usize, y: usize) -> Dot {
        self.dots[y * self.width + x]
    }

    pub fn at_mut(&mut self, x: usize, y: usize) -> &mut Dot {
        &mut self.dots[y * self.width + x]
    }

    fn index(&self, x: f32, y: f32) -> Option<usize> {
        let (x, y) = (x.round(), y.round());
        let inside = x >= 0.0 && y >= 0.0 && (x as usize) < self.width && (y as usize) < self.height;
        inside.then(|| y as usize * self.width + x as usize)
    }

    pub fn set(&mut self, x: f32, y: f32, dot: Dot) {
        if let Some(index) = self.index(x, y) {
            self.dots[index] = dot;
        }
    }

    /// Sets a dot unless a figure is already there, so weather passes behind figures.
    pub fn set_behind(&mut self, x: f32, y: f32, dot: Dot) {
        if let Some(index) = self.index(x, y)
            && !self.dots[index].ink.is_figure()
        {
            self.dots[index] = dot;
        }
    }

    pub fn dots_mut(&mut self) -> impl Iterator<Item = &mut Dot> {
        self.dots.iter_mut()
    }
}

/// The whole pixels a run from `from` to `to` touches, short of `limit`.
fn span(from: f32, to: f32, limit: usize) -> std::ops::Range<usize> {
    (from.floor().max(0.0) as usize)..(to.ceil().max(0.0) as usize).min(limit)
}

/// A picture laid out at a fixed size in its own pixels, the way ascii-magic pieces are. A still
/// layer is painted once, with a layer number per pixel (0 for the sky, higher for nearer), and
/// each frame paints its moving parts onto a copy of it. Positions are in the painting's pixels,
/// which may fall between whole numbers.
pub struct Painting {
    pub width: usize,
    pub height: usize,
    still: Vec<Rgb>,
    layers: Vec<u8>,
    frame: Vec<Rgb>,
}

impl Painting {
    pub fn new(width: usize, height: usize) -> Painting {
        let pixels = width * height;
        Painting {
            width,
            height,
            still: vec![[0.0; 3]; pixels],
            layers: vec![0; pixels],
            frame: vec![[0.0; 3]; pixels],
        }
    }

    fn index(&self, x: f32, y: f32) -> Option<usize> {
        let (column, row) = (x.floor(), y.floor());
        let inside = column >= 0.0 && row >= 0.0 && (column as usize) < self.width && (row as usize) < self.height;
        inside.then(|| row as usize * self.width + column as usize)
    }

    /// Paints `layer` wherever `color` gives one inside the box from `from` to `to`. `color` is
    /// asked at the middle of each pixel and can look at what is already painted.
    pub fn paint(
        &mut self,
        from: (f32, f32),
        to: (f32, f32),
        layer: u8,
        color: impl Fn(&Painting, f32, f32) -> Option<Rgb>,
    ) {
        let (across, down) = (span(from.0, to.0, self.width), span(from.1, to.1, self.height));
        let mut painted = Vec::new();
        for row in down {
            for column in across.clone() {
                if let Some(color) = color(self, column as f32 + 0.5, row as f32 + 0.5) {
                    painted.push((row * self.width + column, color));
                }
            }
        }
        for (index, color) in painted {
            self.still[index] = color;
            self.layers[index] = layer;
        }
    }

    pub fn still_at(&self, x: f32, y: f32) -> Rgb {
        let column = (x as usize).min(self.width - 1);
        let row = (y.max(0.0) as usize).min(self.height - 1);
        self.still[row * self.width + column]
    }

    pub fn layer_at(&self, x: f32, y: f32) -> u8 {
        self.index(x, y).map_or(0, |index| self.layers[index])
    }

    pub fn begin(&mut self) {
        self.frame.copy_from_slice(&self.still);
    }

    /// Blends `color` over one of the painting's own pixels at `x`, `y`.
    pub fn add(&mut self, x: f32, y: f32, color: Rgb, amount: f32) {
        self.add_behind(x, y, color, amount, u8::MAX);
    }

    /// Blends `color` over one of the painting's own pixels, only where the still layer is
    /// `layer` or farther back.
    pub fn add_behind(&mut self, x: f32, y: f32, color: Rgb, amount: f32, layer: u8) {
        if let Some(index) = self.index(x.round(), y.round())
            && self.layers[index] <= layer
        {
            self.frame[index] = mix(self.frame[index], color, amount);
        }
    }

    /// Blends wherever `glaze` gives a color and an amount inside the box from `from` to `to`, only
    /// where the still layer is `layer` or farther back, for soft round things like the sun.
    pub fn glaze(
        &mut self,
        from: (f32, f32),
        to: (f32, f32),
        layer: u8,
        glaze: impl Fn(f32, f32) -> Option<(Rgb, f32)>,
    ) {
        for row in span(from.1, to.1, self.height) {
            for column in span(from.0, to.0, self.width) {
                let index = row * self.width + column;
                if self.layers[index] > layer {
                    continue;
                }
                if let Some((color, amount)) = glaze(column as f32 + 0.5, row as f32 + 0.5) {
                    self.frame[index] = mix(self.frame[index], color, amount);
                }
            }
        }
    }

    /// Greys and darkens the frame as rain sets in.
    pub fn overcast(&mut self, rain: f32) {
        if rain <= 0.0 {
            return;
        }
        for color in &mut self.frame {
            let gray = luma(*color) * 255.0;
            *color = mix(*color, [gray; 3], rain * 0.4).map(|channel| channel * (1.0 - rain * 0.25));
        }
    }

    /// Scales the frame to cover `canvas`, cropping whichever sides overhang as little away from
    /// `focus` (a fraction across and down) as it can. Shrinking averages pixels; enlarging keeps
    /// each pixel whole.
    pub fn cover(&self, canvas: &mut Canvas, focus: (f32, f32)) {
        let (columns, rows) = (self.width, self.height);
        let (width, height) = (canvas.width as f32, canvas.height as f32);
        let scale = (width / columns as f32).max(height / rows as f32);
        // One side fits exactly, give or take rounding, so its spare can come out a hair below zero.
        let spare_x = (columns as f32 * scale - width).max(0.0);
        let spare_y = (rows as f32 * scale - height).max(0.0);
        let left = (columns as f32 * scale * focus.0 - width / 2.0).clamp(0.0, spare_x);
        let top = (rows as f32 * scale * focus.1 - height / 2.0).clamp(0.0, spare_y);
        for y in 0..canvas.height {
            let from_y = (y as f32 + top) / scale;
            for x in 0..canvas.width {
                let from_x = (x as f32 + left) / scale;
                let (middle_x, middle_y) = (from_x + 0.5 / scale, from_y + 0.5 / scale);
                let color = if scale < 1.0 {
                    self.average(from_x, from_y, 1.0 / scale)
                } else {
                    self.pixel(middle_x as isize, middle_y as isize)
                };
                *canvas.at_mut(x, y) = Dot::paint(color.map(|channel| channel.clamp(0.0, 255.0)));
            }
        }
    }

    fn pixel(&self, column: isize, row: isize) -> Rgb {
        let column = column.clamp(0, self.width as isize - 1) as usize;
        let row = row.clamp(0, self.height as isize - 1) as usize;
        self.frame[row * self.width + column]
    }

    /// The mean of the pixels under a square `size` pixels wide, starting at `x`, `y`, each
    /// weighed by how much of it the square covers.
    fn average(&self, x: f32, y: f32, size: f32) -> Rgb {
        let overlap = |cell: isize, from: f32| (cell as f32 + 1.0).min(from + size) - (cell as f32).max(from);
        let mut sum = [0.0; 3];
        let mut total = 0.0;
        for row in y.floor() as isize..(y + size).ceil() as isize {
            for column in x.floor() as isize..(x + size).ceil() as isize {
                let weight = overlap(column, x) * overlap(row, y);
                let pixel = self.pixel(column, row);
                sum = [0, 1, 2].map(|index| sum[index] + pixel[index] * weight);
                total += weight;
            }
        }
        sum.map(|channel| channel / f32::max(total, f32::EPSILON))
    }
}

/// Rain streaks falling across the whole picture, slanted by the wind.
pub fn rain(canvas: &mut Canvas, t: f32, level: f32, wind: f32) {
    let (width, height) = (canvas.width as f32, canvas.height as f32);
    let drops = (level * width * 0.35).round() as i64;
    let slant = 0.2 + wind * 0.6;
    let length = (height / 18.0).round().max(3.0);
    for drop in 0..drops {
        let speed = 0.55 + 0.3 * hash(drop, 1, 60);
        let top = ((t * speed + hash(drop, 2, 60)) % 1.2 - 0.1) * height;
        let start = hash(drop, 3, 60) * width * (1.0 + slant);
        let mut step = 0.0;
        while step < length {
            let y = top + step;
            canvas.set_behind(start - y * slant, y, Dot::solid(0.6));
            step += 1.0;
        }
    }
}

/// Fireflies drifting and blinking between `band.0` and `band.1` of the height.
pub fn fireflies(canvas: &mut Canvas, t: f32, level: f32, band: (f32, f32)) {
    let (width, height) = (canvas.width as f32, canvas.height as f32);
    if level <= 0.0 {
        return;
    }
    let count = (level * 16.0 * width / 240.0).round().max(1.0) as i64;
    let size = (height / 64.0).round().max(1.0) as usize;
    for fly in 0..count {
        let index = fly as f32;
        let x = hash(fly, 1, 40) * width + (t * 0.4 + index).sin() * height * 0.06;
        let y = height * lerp(band.0, band.1, hash(fly, 2, 40)) + (t * 0.6 + index * 1.7).sin() * height * 0.03;
        if (t * (1.1 + hash(fly, 3, 40)) + index * 2.1).sin() > 0.35 {
            for row in 0..size {
                for column in 0..size {
                    canvas.set(x + column as f32, y + row as f32, Dot::figure(Ink::Accent));
                }
            }
        }
    }
}

/// How bright a lightning flash is at `t`, from 0 when the sky is dark.
pub fn lightning(t: f32, thunder: f32) -> f32 {
    let slot = (t * 0.8).floor();
    let phase = t * 0.8 - slot;
    if hash(slot as i64, 3, 11) >= thunder * 0.5 {
        return 0.0;
    }
    match phase {
        phase if phase < 0.05 => 1.0,
        phase if phase < 0.1 => 0.25,
        phase if phase < 0.15 => 0.7,
        _ => 0.0,
    }
}

pub fn brighten(canvas: &mut Canvas, amount: f32) {
    if amount <= 0.0 {
        return;
    }
    for dot in canvas.dots_mut() {
        match &mut dot.ink {
            Ink::Paint(color) => *color = mix(*color, [255.0; 3], amount * 0.35),
            Ink::Theme => dot.light += amount * 0.25,
            Ink::Accent | Ink::Alert => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shrinking_weighs_each_pixel_by_how_much_of_it_is_covered() {
        let mut painting = Painting::new(4, 4);
        painting.paint((0.0, 0.0), (4.0, 4.0), 0, |_, x, _| {
            Some(if x < 1.0 { [0.0; 3] } else { [255.0; 3] })
        });
        painting.begin();
        let mut canvas = Canvas::default();
        canvas.resize(3, 3);
        painting.cover(&mut canvas, (0.5, 0.5));
        let Ink::Paint([red, ..]) = canvas.at(0, 0).ink else {
            panic!("the corner should be painted");
        };
        assert!((red - 63.75).abs() < 0.01, "{red}");
    }
}
