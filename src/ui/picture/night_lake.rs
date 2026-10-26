use super::canvas::{Canvas, Dot, Ink, fbm, hash, noise};
use super::{Season, Weather};

/// Puts someone in the boat, fishing. Off for now; the boat drifts empty.
const FISHER: bool = false;

/// The boat, one character per dot: `h` hull, `H` a gap between planks, and for the fisher,
/// `f` body, `e` eye, `r` rod.
const BOAT: [&str; 14] = [
    "r.........................",
    ".r........................",
    "..r.......................",
    "...r......f.....f.........",
    "....r....fff...fff........",
    ".....r...fffffffff........",
    "......r.fffffffffff.......",
    ".......rffefffffeffff.....",
    "........ffefffffefffff....",
    "........ffffffffffffff....",
    "........fffffffffffff.....",
    "...hhhhhhhhhhhhhhhhhhhh...",
    "....hHHHHHHHHHHHHHHHHh....",
    ".....hhhhhhhhhhhhhhhh.....",
];

/// A moonlit lake between pines, drawn in the theme's own colors at whatever size it's given. In
/// winter snow lies on the hills and the pines.
pub fn paint(canvas: &mut Canvas, t: f32, weather: &Weather, season: Season) {
    let snowy = season == Season::Winter;
    let (width, height) = (canvas.width, canvas.height);
    let (w, h) = (width as f32, height as f32);
    let horizon = (h * 0.6).round();
    let (moon_x, moon_y, moon_r) = (w * 0.27, h * 0.25, h * 0.14);
    let overcast = weather.rain * 0.75;
    let moonlight = 1.0 - overcast * 0.75;
    let wind = weather.wind;

    let hill_tops: Vec<f32> = (0..width)
        .map(|x| horizon - h * (0.1 + 0.09 * fbm(x as f32 / (h * 0.55), 0.5, 3, 2)))
        .collect();
    for y in 0..horizon as usize {
        let fy = y as f32;
        for (x, hill_top) in hill_tops.iter().enumerate() {
            let fx = x as f32;
            let light = if fy >= *hill_top {
                (if snowy { 0.28 } else { 0.2 }
                    + 0.1 * fbm(fx / (h * 0.03), fy / (h * 0.03), 2, 4)
                    + 0.12 * (-(fx - moon_x).abs() / (h * 0.7)).exp())
                    * (1.0 - overcast * 0.4)
            } else {
                let distance = (fx - moon_x).hypot(fy - moon_y);
                let mut light = 0.025 * (fy / horizon).powf(1.5) + 0.3 * (-distance / (h * 0.18)).exp() * moonlight;
                let cloud = fbm(fx / (h * 0.9) + t * 0.012 * (1.0 + wind * 4.0), fy / (h * 0.07), 3, 9);
                let cover = 0.6 - overcast * 0.2;
                if cloud > cover {
                    light += (cloud - cover) * (0.25 + 0.9 * (-distance / (h * 0.35)).exp()) * (0.4 + overcast);
                }
                light
            };
            *canvas.at_mut(x, y) = Dot::shade(light);
        }
    }

    // Pines on both shores, their edges catching the moon.
    let mut pine = 0;
    for (from, to) in [(-3.0, w * 0.22), (w * 0.85, w + 3.0)] {
        let mut trunk = from;
        while trunk < to {
            let tall = h * (0.16 + 0.18 * hash(pine, 1, 3));
            let tier = h * 0.06;
            let lit_side = if trunk < moon_x { 1.0 } else { -1.0 };
            let mut j = 0.0;
            while j < tall {
                let up = j / tall;
                let half = h * 0.075 * (1.0 - up) * (0.65 + 0.55 * (1.0 - (j % tier) / tier));
                let sway = wind * h * 0.025 * (t * 1.4 + trunk * 0.07).sin() * up * up;
                let edge = trunk + lit_side * half;
                let mut x = trunk - half;
                while x <= trunk + half {
                    let shaded = trunk - lit_side * half;
                    let rim = match ((x - edge).abs() < 1.5, snowy && (x - shaded).abs() < 1.0) {
                        (true, _) => (if snowy { 0.8 } else { 0.5 }) * moonlight,
                        (false, true) => 0.35 * moonlight,
                        (false, false) => 0.0,
                    };
                    canvas.set(x + sway, horizon - j, Dot::shade(rim));
                    x += 1.0;
                }
                j += 1.0;
            }
            trunk += h * (0.05 + 0.04 * hash(pine, 9, 3));
            pine += 1;
        }
    }

    // The water mirrors the shore, breaks it into ripples, and carries a path of moonlight.
    for y in horizon as usize..height {
        let fy = y as f32;
        let depth = (fy - horizon) / (h - horizon);
        let mirrored = (horizon - 1.0 - ((fy - horizon) * 1.35).floor()).max(0.0) as usize;
        let shift = ((fy * 0.8 + t * 1.6).sin() * (1.0 + wind * 2.5) * (0.5 + depth)).round() as isize;
        for x in 0..width {
            let fx = x as f32;
            let source = (x as isize + shift).clamp(0, width as isize - 1) as usize;
            let mut light = canvas.at(source, mirrored).light * (0.45 - 0.2 * depth);
            if noise(fx / (h * 0.1) - t * (0.15 + wind * 0.9), fy / 1.3, 7) > 0.75 {
                light = light.max(0.22);
            }
            let across = (fx - moon_x + (fy * 0.9 + t * 1.3).sin() * (1.0 + wind * 2.0)).abs();
            let path = moon_r * (0.45 + 1.1 * depth);
            if across < path && noise(fx / 2.5 + t * 0.3, fy * 0.7 - t * 0.8, 13) > 0.52 {
                light = light.max(0.75 * moonlight * (1.0 - across / path * 0.6));
            }
            *canvas.at_mut(x, y) = Dot::shade(light);
        }
    }

    // The moon, striped like an old print.
    let mut y = (moon_y - moon_r).floor();
    while y <= moon_y + moon_r {
        let mut x = (moon_x - moon_r).floor();
        while x <= moon_x + moon_r {
            let distance = (x - moon_x).hypot(y - moon_y) / moon_r;
            if distance < 1.0 {
                let crater = fbm(x / (moon_r * 0.35), y / (moon_r * 0.35), 2, 21) > 0.58;
                let mut light = (0.97 - if crater { 0.35 } else { 0.0 } - 0.15 * distance.powi(6)) * moonlight;
                if y as i64 % 2 == 1 {
                    light *= 0.45;
                }
                canvas.set(x, y, Dot::shade(light));
            }
            x += 1.0;
        }
        y += 1.0;
    }

    let stars = (70.0 * w / 240.0).round() as i64;
    for star in 0..stars {
        let (x, y) = (hash(star, 1, 5) * w, hash(star, 2, 5) * (horizon - h * 0.22));
        let near_moon = (x - moon_x).hypot(y - moon_y) < moon_r * 1.8;
        let clouded = hash(star, 4, 5) < overcast * 1.2;
        if !near_moon && !clouded && (t * (0.7 + hash(star, 3, 5)) + star as f32 * 2.3).sin() > 0.1 {
            canvas.set(x, y, Dot::solid(0.8));
        }
    }

    let scale = (h / 64.0).round().max(1.0);
    let waterline = horizon + ((h - horizon) * 0.4).round();
    let left = (w * 0.56).round();
    let top = waterline - 12.0 * scale + ((t * 1.1).sin() * 0.8).round();
    for (row, line) in BOAT.iter().enumerate() {
        for (column, part) in line.chars().enumerate() {
            let dot = match part {
                'h' => Dot::figure(Ink::Accent),
                'H' => Dot::default(),
                'f' if FISHER => Dot::figure(Ink::Alert),
                'e' if FISHER => Dot::default(),
                'r' if FISHER => Dot::solid(0.9),
                _ => continue,
            };
            for down in 0..scale as usize {
                for across in 0..scale as usize {
                    let x = left + column as f32 * scale + across as f32;
                    canvas.set(x, top + row as f32 * scale + down as f32, dot);
                }
            }
        }
    }
    if FISHER {
        let mut y = top + 1.0;
        while y <= waterline + 1.0 {
            canvas.set(left, y, Dot::solid(0.6));
            y += 1.0;
        }
        let bob = if (t * 2.2).sin() > 0.75 { 1.0 } else { 0.0 };
        canvas.set(left, waterline + 2.0 + bob, Dot::figure(Ink::Accent));
        let age = (t * 0.45) % 1.0;
        if age < 0.8 {
            let radius = age * 7.0 * scale;
            for step in 0..42 {
                let angle = step as f32 * 0.15;
                let ring = Dot::shade(0.9 * (1.0 - age));
                canvas.set(
                    left + angle.cos() * radius,
                    waterline + 2.0 + angle.sin() * radius * 0.3,
                    ring,
                );
            }
        }
    }

    // Rings where rain lands on the water.
    let splashes = (weather.rain * w * 0.05).round() as i64;
    for splash in 0..splashes {
        let period = 0.6 + hash(splash, 1, 50) * 0.5;
        let cycle = t / period + hash(splash, 2, 50);
        let (round, age) = (cycle.floor(), cycle.fract());
        if age >= 0.7 {
            continue;
        }
        let x = hash(splash, round as i64, 51) * w;
        let y = horizon + 2.0 + hash(splash, round as i64, 52) * (h - horizon - 3.0);
        let radius = age * 3.0 * scale;
        for step in 0..13 {
            let angle = step as f32 * 0.5;
            canvas.set(
                x + angle.cos() * radius,
                y + angle.sin() * radius * 0.35,
                Dot::solid(0.5),
            );
        }
    }
}
