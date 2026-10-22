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

/// A picture laid out at a fixed size, the way ascii-magic pieces are, and painted with `scale`
/// finer pixels along each side of its own so it stays sharp when the player is large. A still
/// layer is painted once, with a layer number per pixel (0 for the sky, higher for nearer), and
/// each frame paints its moving parts onto a copy of it. Positions are in the painting's own
/// pixels, which may fall between whole numbers.
pub struct Painting {
    pub width: usize,
    pub height: usize,
    pub scale: usize,
    still: Vec<Rgb>,
    layers: Vec<u8>,
    frame: Vec<Rgb>,
}

impl Painting {
    pub fn new(width: usize, height: usize, scale: usize) -> Painting {
        let pixels = width * scale * height * scale;
        Painting {
            width,
            height,
            scale,
            still: vec![[0.0; 3]; pixels],
            layers: vec![0; pixels],
            frame: vec![[0.0; 3]; pixels],
        }
    }

    /// The finest scale worth painting a painting this size at for `canvas`.
    pub fn scale_for(width: usize, height: usize, canvas: &Canvas) -> usize {
        let cover = (canvas.width as f32 / width as f32).max(canvas.height as f32 / height as f32);
        (cover.ceil() as usize).clamp(1, 3)
    }

    fn fine(&self) -> (usize, usize) {
        (self.width * self.scale, self.height * self.scale)
    }

    fn index(&self, x: f32, y: f32) -> Option<usize> {
        let (columns, rows) = self.fine();
        let (column, row) = ((x * self.scale as f32).floor(), (y * self.scale as f32).floor());
        let inside = column >= 0.0 && row >= 0.0 && (column as usize) < columns && (row as usize) < rows;
        inside.then(|| row as usize * columns + column as usize)
    }

    /// Paints `layer` wherever `color` gives one inside the box from `from` to `to`. `color` is
    /// asked at the middle of each fine pixel and can look at what is already painted.
    pub fn paint(
        &mut self,
        from: (f32, f32),
        to: (f32, f32),
        layer: u8,
        color: impl Fn(&Painting, f32, f32) -> Option<Rgb>,
    ) {
        let scale = self.scale as f32;
        let (columns, rows) = self.fine();
        let span = |from: f32, to: f32, limit: usize| {
            ((from * scale).floor().max(0.0) as usize)..((to * scale).ceil().max(0.0) as usize).min(limit)
        };
        let (across, down) = (span(from.0, to.0, columns), span(from.1, to.1, rows));
        let mut painted = Vec::new();
        for row in down {
            for column in across.clone() {
                let (x, y) = ((column as f32 + 0.5) / scale, (row as f32 + 0.5) / scale);
                if let Some(color) = color(self, x, y) {
                    painted.push((row * columns + column, color));
                }
            }
        }
        for (index, color) in painted {
            self.still[index] = color;
            self.layers[index] = layer;
        }
    }

    pub fn still_at(&self, x: f32, y: f32) -> Rgb {
        let (columns, rows) = self.fine();
        let scale = self.scale as f32;
        let column = ((x * scale) as usize).min(columns - 1);
        let row = ((y.max(0.0) * scale) as usize).min(rows - 1);
        self.still[row * columns + column]
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
        let scale = self.scale as f32;
        let (left, top) = ((x * scale).round() / scale, (y * scale).round() / scale);
        for row in 0..self.scale {
            for column in 0..self.scale {
                let step = |offset: usize| (offset as f32 + 0.5) / scale;
                if let Some(index) = self.index(left + step(column), top + step(row))
                    && self.layers[index] <= layer
                {
                    self.frame[index] = mix(self.frame[index], color, amount);
                }
            }
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
        let scale = self.scale as f32;
        let (columns, rows) = self.fine();
        let span = |from: f32, to: f32, limit: usize| {
            ((from * scale).floor().max(0.0) as usize)..((to * scale).ceil().max(0.0) as usize).min(limit)
        };
        for row in span(from.1, to.1, rows) {
            for column in span(from.0, to.0, columns) {
                let index = row * columns + column;
                if self.layers[index] > layer {
                    continue;
                }
                let (x, y) = ((column as f32 + 0.5) / scale, (row as f32 + 0.5) / scale);
                if let Some((color, amount)) = glaze(x, y) {
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
    /// `focus` (a fraction across and down) as it can. Enlarging blends between neighbouring
    /// pixels and shrinking averages them, so no pixel grid shows.
    pub fn cover(&self, canvas: &mut Canvas, focus: (f32, f32)) {
        let (columns, rows) = self.fine();
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
                let color = if scale >= 1.0 {
                    self.blend(from_x + 0.5 / scale - 0.5, from_y + 0.5 / scale - 0.5)
                } else {
                    self.average(from_x, from_y, 1.0 / scale)
                };
                *canvas.at_mut(x, y) = Dot::paint(color.map(|channel| channel.clamp(0.0, 255.0)));
            }
        }
    }

    fn pixel(&self, column: isize, row: isize) -> Rgb {
        let (columns, rows) = self.fine();
        let column = column.clamp(0, columns as isize - 1) as usize;
        let row = row.clamp(0, rows as isize - 1) as usize;
        self.frame[row * columns + column]
    }

    /// The color at a point between fine pixels' middles, blended from the four around it.
    fn blend(&self, x: f32, y: f32) -> Rgb {
        let (left, top) = (x.floor(), y.floor());
        let (across, down) = (x - left, y - top);
        let (left, top) = (left as isize, top as isize);
        let upper = mix(self.pixel(left, top), self.pixel(left + 1, top), across);
        let lower = mix(self.pixel(left, top + 1), self.pixel(left + 1, top + 1), across);
        mix(upper, lower, down)
    }

    /// The mean of the fine pixels under a square `size` pixels wide, starting at `x`, `y`.
    fn average(&self, x: f32, y: f32, size: f32) -> Rgb {
        let columns = x as isize..(x + size).ceil() as isize;
        let rows = y as isize..(y + size).ceil() as isize;
        let mut sum = [0.0; 3];
        let mut count = 0.0;
        for row in rows {
            for column in columns.clone() {
                let pixel = self.pixel(column, row);
                sum = [sum[0] + pixel[0], sum[1] + pixel[1], sum[2] + pixel[2]];
                count += 1.0;
            }
        }
        sum.map(|channel| channel / f32::max(count, 1.0))
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
