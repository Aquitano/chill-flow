//! Ported from `fuji-dawn-lake` in ascii-magic-art, (c) 2026 ASCII Magic, MIT licensed; see
//! `licenses/ascii-magic-art.txt`.

use std::f32::consts::PI;

use super::Weather;
use super::canvas::{Canvas, Painting, Rgb, fbm, lerp, mix, noise, ramp, rgb, unit};

const WIDTH: usize = 192;
const HEIGHT: usize = 108;
const HORIZON: f32 = 66.0;
const SUN: (f32, f32) = (150.0, 50.0);
const SUN_RADIUS: f32 = 7.0;
const PEAK_X: f32 = 88.0;
const PEAK_Y: f32 = 16.0;
/// A very wide player crops the picture; this keeps the peak in view.
const FOCUS: (f32, f32) = (0.5, 0.38);

const SKY: u8 = 0;
const HILL: u8 = 1;
const MOUNTAIN: u8 = 2;
const LAKE: u8 = 3;
const POINT: u8 = 4;
const SHORE: u8 = 5;

const INK: Rgb = rgb(0x110f22);
const DARK: Rgb = rgb(0x2a2440);
const WHITE: Rgb = rgb(0xfff2ea);
const GLOW: Rgb = rgb(0xffd48a);

/// The pines on the point, by trunk and height.
const PINES: [(f32, f32); 9] = [
    (4.0, 22.0),
    (10.0, 26.0),
    (16.0, 19.0),
    (23.0, 24.0),
    (29.0, 15.0),
    (35.0, 18.0),
    (41.0, 12.0),
    (47.0, 9.0),
    (53.0, 7.0),
];

struct Reed {
    x: f32,
    tall: f32,
    phase: f32,
}

/// A snow capped volcano glowing at dawn over a mirror lake, with cranes flying past, a boat
/// poling across, and reeds that sway with the wind.
pub struct FujiDawn {
    painting: Option<Painting>,
    reeds: Vec<Reed>,
    ripples: Vec<(f32, f32)>,
}

fn shore(x: f32) -> f32 {
    101.0 + 2.0 * (x / 17.0).sin() + 1.5 * fbm(x / 6.0, 7.0, 3, 2) - unit((x - 150.0) / 40.0) * 6.0
}

fn mountain_top(x: f32) -> f32 {
    let distance = (x - PEAK_X).abs();
    if distance < 6.0 {
        return PEAK_Y + if distance < 2.0 { 1.0 } else { 0.0 };
    }
    let slope = unit((distance - 6.0) / 82.0);
    PEAK_Y + (HORIZON - PEAK_Y) * (1.0 - (1.0 - slope).powf(1.75)) + if x < PEAK_X { 0.6 } else { 0.0 }
}

fn snow_line(x: f32) -> f32 {
    31.0 + 6.0 * fbm(x / 2.2, 9.0, 3, 21) + 4.0 * (x * 0.9).sin() * (x * 0.23).sin() + (x - PEAK_X).abs() * 0.05
}

fn point_top(x: f32) -> f32 {
    64.0 - 3.0 * unit(1.0 - x / 60.0) + 0.5 * noise(x / 3.0, 1.0, 0)
}

fn sky(x: f32, y: f32) -> Rgb {
    let stops = [
        (0.0, rgb(0x4f5a9a)),
        (0.3, rgb(0x6a64a6)),
        (0.52, rgb(0x8a74b0)),
        (0.68, rgb(0xb884b4)),
        (0.82, rgb(0xe59bb0)),
        (0.93, rgb(0xffbf96)),
        (1.0, rgb(0xffdca0)),
    ];
    let distance = (x - SUN.0).hypot((y - SUN.1) * 1.4);
    mix(
        ramp(&stops, y / HORIZON),
        rgb(0xffdca0),
        unit(1.0 - distance / 48.0) * 0.6,
    )
}

fn mountain(x: f32, y: f32) -> Rgb {
    let lit = unit((x - PEAK_X + 8.0) / 50.0);
    let line = snow_line(x);
    if y < line {
        let grain = noise(x / 1.5, y / 3.0, 5);
        let ridge = if ((x - PEAK_X) * 0.55 + y * 0.05).sin() > 0.55 && x < PEAK_X + 30.0 {
            0.25
        } else {
            0.0
        };
        let snow = mix(
            rgb(0xc7c3e6),
            rgb(0xfff2ea),
            unit(lit * 1.3 - ridge + (grain - 0.5) * 0.3),
        );
        mix(snow, rgb(0xe6dcf0), 0.15)
    } else {
        let haze = unit((y - line) / 26.0);
        let grain = fbm(x / 4.0, y / 4.0, 3, 13);
        let rock = mix(rgb(0x565a98), rgb(0x8a76ae), unit(lit * 0.9 + (grain - 0.5) * 0.4));
        mix(rock, rgb(0x857ab4), unit(haze * 0.5) * (1.0 - lit * 0.5))
    }
}

/// A pine's tiers widen toward their foot, so its edge saws down the trunk.
fn pine(x: f32, y: f32) -> Option<Rgb> {
    let mut shade = None;
    for (trunk, tall) in PINES {
        let up = point_top(trunk) + 0.5 - y;
        if !(0.0..tall).contains(&up) {
            continue;
        }
        let half = (tall - up) * 0.28 + (1.0 - (up / 3.0).fract());
        let across = x - trunk - 0.5;
        if across.abs() <= half + 0.5 {
            let lit = across > half - 0.5 && half > 1.0;
            shade = Some(if lit { rgb(0x2c3a48) } else { rgb(0x1e2a3a) });
        }
    }
    shade
}

/// The parts that never move, painted once for each scale.
fn still(scale: usize) -> Painting {
    let (width, height) = (WIDTH as f32, HEIGHT as f32);
    let mut painting = Painting::new(WIDTH, HEIGHT, scale);
    painting.paint((0.0, 0.0), (width, HORIZON), SKY, |_, x, y| Some(sky(x, y)));
    painting.paint((0.0, 45.0), (width, HORIZON), HILL, |_, x, y| {
        let top = 57.0 + 3.0 * (x / 13.0 + 1.0).sin() + 2.5 * fbm(x / 18.0, 2.0, 3, 4);
        (y >= top).then(|| mix(rgb(0x7a6aa0), rgb(0x5c5490), unit((y - top) / 8.0)))
    });
    painting.paint((0.0, 0.0), (width, HORIZON), MOUNTAIN, |_, x, y| {
        (y >= mountain_top(x)).then(|| mountain(x, y))
    });
    painting.paint((0.0, 52.0), (width, HORIZON), HILL, |_, x, y| {
        let top = 62.0 + 2.0 * (x / 9.0 + 3.0).sin() + 2.0 * fbm(x / 10.0, 5.0, 3, 8);
        (y >= top).then(|| mix(rgb(0x4a4678), rgb(0x3e4280), unit((y - top) / 4.0)))
    });
    painting.paint((0.0, HORIZON), (width, height), LAKE, |painting, x, y| {
        let depth = (y - HORIZON) / (height - HORIZON);
        let mut color = mix(
            painting.still_at(x, HORIZON - (y - HORIZON) * 1.5),
            rgb(0x2b2f5c),
            0.12 + 0.3 * depth,
        );
        let from_sun = (x - SUN.0).abs() / (3.0 + depth * 10.0);
        if from_sun < 1.0 && noise(x / 6.0, y * 0.8, 3) > 0.45 {
            color = mix(color, GLOW, (1.0 - from_sun) * 0.75);
        }
        Some(color)
    });
    painting.paint((0.0, 55.0), (62.0, 70.0), POINT, |_, x, y| {
        (y >= point_top(x) && y < 69.0 - x / 30.0).then_some(rgb(0x1c1a33))
    });
    painting.paint((0.0, 30.0), (62.0, 70.0), POINT, |_, x, y| pine(x, y));
    painting.paint((0.0, HORIZON), (62.0, height), LAKE, |painting, x, y| {
        let mirrored = HORIZON - (y - HORIZON) * 1.5 + 2.0;
        (painting.layer_at(x, mirrored) == POINT).then(|| mix(painting.still_at(x, y), INK, 0.75))
    });
    painting.paint((0.0, 88.0), (width, height), SHORE, |_, x, y| {
        (y >= shore(x)).then(|| if fbm(x / 3.0, y / 3.0, 2, 31) > 0.55 { DARK } else { INK })
    });
    painting
}

impl FujiDawn {
    pub fn new() -> FujiDawn {
        let reeds = (0..20)
            .map(|index| {
                let i = index as f32;
                Reed {
                    x: 150.0 + i * 2.1 + (i * 7.1).sin() * 1.5,
                    tall: 5.0 + ((index * 37) % 9) as f32 + unit((i - 6.0) / 14.0) * 6.0,
                    phase: i * 0.61,
                }
            })
            .collect();
        let ripples = (0..30)
            .map(|index| (((index * 73) % 97) as f32 / 97.0, ((index * 41) % 53) as f32 / 53.0))
            .collect();
        FujiDawn {
            painting: None,
            reeds,
            ripples,
        }
    }

    pub fn paint(&mut self, canvas: &mut Canvas, t: f32, weather: &Weather) {
        let scale = Painting::scale_for(WIDTH, HEIGHT, canvas);
        if self.painting.as_ref().is_some_and(|painting| painting.scale != scale) {
            self.painting = None;
        }
        let painting = self.painting.get_or_insert_with(|| still(scale));
        let breeze = 0.5 + 1.5 * weather.wind;
        let width = WIDTH as f32;
        painting.begin();

        let reach = SUN_RADIUS + 1.0;
        painting.glaze(
            (SUN.0 - reach, SUN.1 - reach),
            (SUN.0 + reach, SUN.1 + reach),
            SKY,
            |x, y| {
                let distance = (x - SUN.0).hypot(y - SUN.1);
                let color = if distance < SUN_RADIUS - 1.5 {
                    rgb(0xfff8e0)
                } else {
                    rgb(0xffeab0)
                };
                (distance < SUN_RADIUS).then_some((color, 1.0))
            },
        );

        // Mist drifting along the foot of the mountain. It's soft, so whole pixels of it will do.
        for row in 50..HORIZON as usize {
            let y = row as f32;
            for column in 0..WIDTH {
                let x = column as f32;
                let thick = fbm(x / 26.0 - t * 0.05 * breeze, y / 3.5, 3, 7);
                let amount = unit((thick - 0.45) * 2.4) * 0.55 * ((y - 50.0) / 16.0 * PI).sin();
                if amount > 0.03 {
                    painting.add_behind(x, y, rgb(0xf0c0c8), amount, MOUNTAIN);
                }
            }
        }

        // Three cranes crossing, long necks out, slow wingbeats.
        let crossing = ((t + 8.0) % 34.0) / 34.0;
        let (flock_x, flock_y) = (lerp(width + 30.0, -30.0, crossing), 9.0 + (crossing * 5.0).sin() * 2.0);
        for (index, (offset_x, offset_y)) in [(0.0, 0.0), (11.0, 4.0), (21.0, -2.0)].into_iter().enumerate() {
            let k = index as f32;
            let x = flock_x + offset_x;
            let y = flock_y + offset_y + (t * 0.9 + k).sin() * 0.8;
            let wing = (t * 3.2 + k * 1.3).sin();
            for j in -2..=3 {
                painting.add(x + j as f32, y, WHITE, 1.0);
            }
            for j in 3..=6 {
                painting.add(x - j as f32, y - if j > 5 { 1.0 } else { 0.0 }, WHITE, 1.0);
            }
            painting.add(x - 7.0, y - 1.0, GLOW, 1.0);
            painting.add(x + 4.0, y + 1.0, DARK, 1.0);
            painting.add(x + 5.0, y + 1.0, DARK, 0.8);
            let tip = -5.0 * wing;
            for j in 0..=4 {
                let j = j as f32;
                let color = if j > 2.0 { DARK } else { WHITE };
                painting.add(x + j * 0.5, y + tip * j / 4.0, color, 1.0);
            }
            painting.add(x - 1.0, y + tip / 3.0, WHITE, 1.0);
        }

        // Ripple lines moving toward the shore, longer as they come near.
        for &(across, phase) in &self.ripples {
            let near = (phase + t * 0.035) % 1.0;
            let y = HORIZON + 2.0 + (HEIGHT as f32 - HORIZON - 6.0) * near.powf(1.5);
            let length = 3.0 + 22.0 * near;
            let middle = across * (width + 30.0) - 15.0 + (t * 0.2 + across * 9.0).sin() * 4.0;
            let color = if (middle - SUN.0).abs() < 14.0 + near * 10.0 {
                GLOW
            } else {
                rgb(0x8a6c98)
            };
            let mut x = middle - length / 2.0;
            while x < middle + length / 2.0 {
                painting.add_behind(x, y, color, 0.6, LAKE);
                painting.add_behind(x, y + 1.0, rgb(0x1f2348), 0.45, LAKE);
                x += 1.0;
            }
        }

        // A boat poling across, with its wake and reflection.
        let boat_x = lerp(-24.0, width + 24.0, ((t + 30.0) % 70.0) / 70.0);
        let boat_y = 86.0;
        for j in 1..14 {
            let j = j as f32;
            let x = boat_x - 12.0 - j * 1.6;
            painting.add_behind(x, boat_y + 1.0 + (j / 3.0).floor(), rgb(0x8a6c98), 0.7 - j * 0.04, LAKE);
            painting.add_behind(x, boat_y - (j / 4.0).floor(), rgb(0x8a6c98), 0.5 - j * 0.03, LAKE);
        }
        for offset in -11_i32..=11 {
            let x = boat_x + offset as f32;
            painting.add(x, boat_y, INK, 1.0);
            if offset.abs() < 10 {
                painting.add(x, boat_y + 1.0, INK, 1.0);
            }
            if offset.abs() < 8 {
                painting.add(x, boat_y + 2.0, INK, 1.0);
            }
            painting.add_behind(x, boat_y + 4.0, INK, 0.45, LAKE);
        }
        painting.add(boat_x - 12.0, boat_y - 1.0, INK, 1.0);
        painting.add(boat_x + 12.0, boat_y - 1.0, INK, 1.0);
        painting.add(boat_x - 13.0, boat_y - 2.0, INK, 1.0);
        for x in -6..=-1 {
            for y in 1..=3 {
                painting.add(boat_x + x as f32, boat_y - y as f32, INK, 1.0);
            }
        }
        for j in 1..=7 {
            painting.add(boat_x + 3.0, boat_y - j as f32, INK, 1.0);
            if j < 5 {
                painting.add(boat_x + 4.0, boat_y - j as f32, INK, 1.0);
            }
        }
        for x in 1..=6 {
            painting.add(boat_x + x as f32, boat_y - 8.0, INK, 1.0);
        }
        painting.add(boat_x + 3.0, boat_y - 9.0, INK, 1.0);
        painting.add(boat_x + 4.0, boat_y - 9.0, INK, 1.0);
        let lean = (t * 0.8).sin() * 2.0;
        for j in 0..16 {
            let j = j as f32;
            painting.add(boat_x + 5.0 + lean * (j / 12.0) - j * 0.35, boat_y - 4.0 + j, INK, 0.9);
        }
        for j in 1..=6 {
            painting.add_behind(boat_x + 2.0, boat_y + 3.0 + j as f32, INK, 0.35, LAKE);
        }

        // Reeds on the right shore, swaying with the wind.
        for reed in &self.reeds {
            let base = shore(reed.x) + 1.0;
            let sway = ((t * 1.1 + reed.phase).sin() * 1.6 + (t * 0.37 + reed.x * 0.1).sin() * 1.2) * breeze;
            let mut j = 0.0;
            while j < reed.tall {
                let up = j / reed.tall;
                let color = if up > 0.8 { DARK } else { INK };
                painting.add(reed.x + sway * up * up, base - j, color, 1.0);
                j += 1.0;
            }
        }

        painting.overcast(weather.rain);
        painting.cover(canvas, FOCUS);
    }
}
