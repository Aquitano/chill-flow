//! Ported from `fuji-dawn-lake` in ascii-magic-art, (c) 2026 ASCII Magic, MIT licensed; see
//! `licenses/ascii-magic-art.txt`.

use std::f32::consts::PI;

use super::canvas::{Canvas, Painting, Rgb, fbm, hash, lerp, luma, mix, noise, ramp, rgb, unit};
use super::{Season, Weather};

pub const WIDTH: usize = 192;
pub const HEIGHT: usize = 108;
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
const WATER: Rgb = rgb(0x2b2f5c);
const LAMP: Rgb = rgb(0xffb050);

/// The colors that change between dawn and night.
struct Light {
    cloud: Rgb,
    cloud_lit: Rgb,
    cap: Rgb,
    cap_under: Rgb,
    mist: Rgb,
    shine: Rgb,
    ripple: Rgb,
}

const DAWN: Light = Light {
    cloud: rgb(0xc8a8d0),
    cloud_lit: rgb(0xffd8c0),
    cap: rgb(0xf6e4f0),
    cap_under: rgb(0xffc8b0),
    mist: rgb(0xf0c0c8),
    shine: GLOW,
    ripple: rgb(0x8a6c98),
};

const NIGHT: Light = Light {
    cloud: rgb(0x3a4068),
    cloud_lit: rgb(0x9aa4cc),
    cap: rgb(0xb8c0e0),
    cap_under: rgb(0x6a7098),
    mist: rgb(0x7880a8),
    shine: rgb(0xdde2f4),
    ripple: rgb(0x3c4470),
};

/// What drifts down through the picture.
#[derive(Clone, Copy, PartialEq)]
enum Falling {
    Petals,
    Leaves,
    Snow,
}

/// How the scene changes through the year.
struct Seasonal {
    /// How much farther down the mountain the snow reaches than at the picture's own time of year.
    snow: f32,
    /// The colors over the hills, lit and shaded, and how much of the hills they cover.
    hills: (Rgb, Rgb, f32),
    snowy_pines: bool,
    /// What drifts down, in which colors, and how much of it.
    falling: Option<(Falling, Rgb, Rgb, f32)>,
}

const SPRING: Seasonal = Seasonal {
    snow: 0.0,
    hills: (rgb(0xffc4dc), rgb(0xd88ab0), 0.75),
    snowy_pines: false,
    falling: Some((Falling::Petals, rgb(0xffd6e6), rgb(0xf0a0c4), 30.0)),
};

const SUMMER: Seasonal = Seasonal {
    snow: -10.0,
    hills: (rgb(0x6aa070), rgb(0x2e6250), 0.6),
    snowy_pines: false,
    falling: None,
};

const AUTUMN: Seasonal = Seasonal {
    snow: -7.0,
    hills: (rgb(0xf09040), rgb(0xb83820), 0.6),
    snowy_pines: false,
    falling: Some((Falling::Leaves, rgb(0xf0a040), rgb(0xc8402a), 22.0)),
};

const WINTER: Seasonal = Seasonal {
    snow: 24.0,
    hills: (rgb(0xf4f2fa), rgb(0xb4b4d4), 0.75),
    snowy_pines: true,
    falling: Some((Falling::Snow, rgb(0xffffff), rgb(0xdcdcf0), 40.0)),
};

fn seasonal(season: Season) -> &'static Seasonal {
    match season {
        Season::Spring => &SPRING,
        Season::Summer => &SUMMER,
        Season::Auto | Season::Autumn => &AUTUMN,
        Season::Winter => &WINTER,
    }
}

/// Thin clouds drifting across the sky, by the row they sit on, half their thickness, and speed.
const CLOUDS: [(f32, f32, f32); 4] = [(10.0, 2.5, 0.5), (19.0, 2.0, 0.8), (29.0, 1.6, 1.2), (39.0, 1.2, 1.7)];

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

/// A snow capped volcano glowing at dawn over a mirror lake, with clouds drifting past and a cap
/// of cloud on the peak, cranes flying over, a boat poling across, and reeds that sway with the
/// wind. The lake mirrors everything that moves above it. At night the moon takes the sun's place
/// among stars, and the snow, the hills, and what drifts down follow the seasons.
pub struct FujiDawn {
    painting: Option<((bool, Season), Painting)>,
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

fn mountain(x: f32, y: f32, snow: f32) -> Rgb {
    let lit = unit((x - PEAK_X + 8.0) / 50.0);
    let line = snow_line(x) + snow;
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
fn pine(x: f32, y: f32, snowy: bool) -> Option<Rgb> {
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
            let tier_top = (up / 3.0).fract() > 0.75 && noise(x / 1.5, y, 43) > 0.45;
            shade = Some(match (snowy && (lit || tier_top), lit) {
                (true, _) => rgb(0xb4b8d4),
                (false, true) => rgb(0x2c3a48),
                (false, false) => rgb(0x1e2a3a),
            });
        }
    }
    shade
}

/// The same scene by moonlight: cooler, and darker the darker it was, so the snow still stands out.
fn moonlit(color: Rgb) -> Rgb {
    let light = luma(color);
    let cool = [light * 150.0, light * 175.0, light * 255.0];
    mix(color, cool, 0.8).map(|channel| channel * (0.25 + 0.4 * light))
}

/// A hill's own color under the season's leaves, blossom, or snow, thinner far away.
fn clad(color: Rgb, x: f32, y: f32, seasonal: &Seasonal, far: bool) -> Rgb {
    let (lit, shaded, cover) = seasonal.hills;
    let patch = fbm(x / 2.5, y / 2.0, 3, 41);
    let cover = cover * unit((patch - 0.3) * 2.5) * if far { 0.55 } else { 1.0 };
    mix(color, mix(shaded, lit, unit((patch - 0.45) * 3.0)), cover)
}

/// The parts that never move, painted once.
fn still(night: bool, season: Season) -> Painting {
    let (width, height) = (WIDTH as f32, HEIGHT as f32);
    let seasonal = seasonal(season);
    let mut painting = Painting::new(WIDTH, HEIGHT);
    painting.paint((0.0, 0.0), (width, HORIZON), SKY, |_, x, y| Some(sky(x, y)));
    painting.paint((0.0, 45.0), (width, HORIZON), HILL, |_, x, y| {
        let top = 57.0 + 3.0 * (x / 13.0 + 1.0).sin() + 2.5 * fbm(x / 18.0, 2.0, 3, 4);
        (y >= top).then(|| {
            clad(
                mix(rgb(0x7a6aa0), rgb(0x5c5490), unit((y - top) / 8.0)),
                x,
                y,
                seasonal,
                true,
            )
        })
    });
    painting.paint((0.0, 0.0), (width, HORIZON), MOUNTAIN, |_, x, y| {
        (y >= mountain_top(x)).then(|| mountain(x, y, seasonal.snow))
    });
    painting.paint((0.0, 52.0), (width, HORIZON), HILL, |_, x, y| {
        let top = 62.0 + 2.0 * (x / 9.0 + 3.0).sin() + 2.0 * fbm(x / 10.0, 5.0, 3, 8);
        (y >= top).then(|| {
            clad(
                mix(rgb(0x4a4678), rgb(0x3e4280), unit((y - top) / 4.0)),
                x,
                y,
                seasonal,
                false,
            )
        })
    });
    painting.paint((0.0, HORIZON), (width, height), LAKE, |_, _, _| Some(WATER));
    painting.paint((0.0, 55.0), (62.0, 70.0), POINT, |_, x, y| {
        (y >= point_top(x) && y < 69.0 - x / 30.0).then_some(rgb(0x1c1a33))
    });
    painting.paint((0.0, 30.0), (62.0, 70.0), POINT, |_, x, y| {
        pine(x, y, seasonal.snowy_pines)
    });
    painting.paint((0.0, 88.0), (width, height), SHORE, |_, x, y| {
        (y >= shore(x)).then(|| if fbm(x / 3.0, y / 3.0, 2, 31) > 0.55 { DARK } else { INK })
    });
    if night {
        painting.grade(moonlit);
    }
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

    pub fn paint(&mut self, canvas: &mut Canvas, t: f32, weather: &Weather, night: bool, season: Season) {
        if self
            .painting
            .as_ref()
            .is_none_or(|(painted, _)| *painted != (night, season))
        {
            self.painting = Some(((night, season), still(night, season)));
        }
        let Some((_, painting)) = &mut self.painting else {
            return;
        };
        let light = if night { &NIGHT } else { &DAWN };
        let breeze = 0.5 + 1.5 * weather.wind;
        let width = WIDTH as f32;
        painting.begin();

        if night {
            for star in 0..90 {
                let (x, y) = (hash(star, 1, 90) * width, hash(star, 2, 90).powf(1.4) * (HORIZON - 8.0));
                let twinkle = 0.55 + 0.45 * (t * (0.8 + hash(star, 3, 90) * 2.0) + star as f32).sin();
                painting.add_behind(x, y, rgb(0xeef0ff), twinkle * (0.4 + 0.6 * hash(star, 4, 90)), SKY);
            }
            painting.glaze(
                (SUN.0 - 16.0, SUN.1 - 16.0),
                (SUN.0 + 16.0, SUN.1 + 16.0),
                SKY,
                |x, y| {
                    let distance = (x - SUN.0).hypot(y - SUN.1);
                    match distance {
                        distance if distance < SUN_RADIUS - 2.0 => {
                            let crater = noise(x / 2.0, y / 2.0, 92) * 0.15;
                            Some((mix(rgb(0xf4f2e4), rgb(0xb8bccc), crater), 1.0))
                        }
                        distance if distance < 16.0 => Some((rgb(0x8890c0), unit(1.0 - distance / 16.0) * 0.35)),
                        _ => None,
                    }
                },
            );
        } else {
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
        }

        for (index, (row, half, speed)) in CLOUDS.into_iter().enumerate() {
            let k = index as f32;
            painting.glaze((0.0, row - half - 3.0), (width, row + half + 3.0), SKY, |x, y| {
                let drifted = x + t * speed * breeze;
                let across = 1.0 - ((y - row - (drifted / 40.0 + k).sin() * 1.5) / half).abs();
                let thick = fbm(drifted / 34.0, k * 3.1, 3, 50 + index as i64);
                let amount = unit((thick - 0.52) * 3.0) * unit(across * 1.5) * 0.65;
                let lit = unit(1.0 - (x - SUN.0).hypot((y - SUN.1) * 2.0) / 90.0);
                (amount > 0.02).then(|| (mix(light.cloud, light.cloud_lit, lit), amount))
            });
        }

        // The cap of cloud Fuji wears, swelling and thinning slowly, its layers lit from below.
        let swell = 0.85 + 0.15 * (t * 0.11).sin() + weather.rain * 0.2;
        let (cap_x, cap_y, cap_half) = (PEAK_X + 1.0, PEAK_Y - 0.5, 15.0 * swell);
        painting.glaze(
            (cap_x - 22.0, cap_y - 6.0),
            (cap_x + 22.0, cap_y + 5.0),
            MOUNTAIN,
            |x, y| {
                let edge = 1.0 - ((x - cap_x - (t * 0.3).sin()) / cap_half).powi(2) - ((y - cap_y) / 3.2).powi(2);
                let edge = edge + (fbm(x / 4.0 - t * 0.08, y / 1.5, 2, 61) - 0.5) * 0.5;
                let layered = 0.75 + 0.25 * ((y - cap_y) * 1.9).cos();
                (edge > 0.0).then(|| {
                    let underside = unit((y - cap_y + 1.0) / 3.0);
                    (
                        mix(light.cap, light.cap_under, underside),
                        unit(edge * 3.0) * 0.85 * layered,
                    )
                })
            },
        );

        // Snow blowing off the summit with the wind, thinning as it streams away.
        if weather.wind > 0.0 {
            for row in (PEAK_Y - 10.0) as usize..(PEAK_Y + 8.0) as usize {
                let y = row as f32;
                for column in PEAK_X as usize..(PEAK_X + 70.0) as usize {
                    let x = column as f32;
                    let along = (x - PEAK_X) / 70.0;
                    let middle = PEAK_Y + 1.0 - along * 8.0 + (along * 9.0 - t * 0.6).sin() * along * 2.0;
                    let across = 1.0 - (y - middle).abs() / (1.0 + along * 6.0);
                    let gust = fbm((x - t * 16.0 * weather.wind) / 6.0, y / 2.0 + t * 0.2, 3, 71);
                    let amount = unit(across * 1.5) * unit((gust - 0.35) * 2.5) * (1.0 - along).sqrt() * weather.wind;
                    if amount > 0.02 {
                        painting.add(x, y, WHITE, amount);
                    }
                }
            }
        }

        // Mist drifting along the foot of the mountain. It's soft, so whole pixels of it will do.
        for row in 50..HORIZON as usize {
            let y = row as f32;
            for column in 0..WIDTH {
                let x = column as f32;
                let thick = fbm(x / 26.0 - t * 0.05 * breeze, y / 3.5, 3, 7);
                let amount = unit((thick - 0.45) * 2.4) * 0.55 * ((y - 50.0) / 16.0 * PI).sin();
                if amount > 0.03 {
                    painting.add_behind(x, y, light.mist, amount, MOUNTAIN);
                }
            }
        }

        // Three cranes crossing, long necks out, slow wingbeats. They roost at night.
        let crossing = ((t + 8.0) % 34.0) / 34.0;
        let (flock_x, flock_y) = (lerp(width + 30.0, -30.0, crossing), 9.0 + (crossing * 5.0).sin() * 2.0);
        let flock: &[(f32, f32)] = if night {
            &[]
        } else {
            &[(0.0, 0.0), (11.0, 4.0), (21.0, -2.0)]
        };
        for (index, &(offset_x, offset_y)) in flock.iter().enumerate() {
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

        // Far birds crossing high while birdsong plays, more of them the louder it is.
        let birds = (weather.birds * 7.0).round() as i64;
        let passing = ((t + 3.0) % 26.0) / 26.0;
        for bird in 0..birds {
            let x = lerp(-20.0, width + 20.0, passing) + hash(bird, 1, 80) * 26.0 - bird as f32 * 3.0;
            let y = 24.0 + hash(bird, 2, 80) * 10.0 + (t * 1.3 + bird as f32).sin();
            let flap = if (t * 7.0 + bird as f32 * 1.7).sin() > 0.0 {
                -1.0
            } else {
                0.0
            };
            painting.add(x, y, DARK, 0.9);
            painting.add(x - 1.0, y + flap, DARK, 0.8);
            painting.add(x + 1.0, y + flap, DARK, 0.8);
        }

        // The lake mirrors whatever is above it, swaying more with waves and wind, with the sun's
        // path glittering on it.
        let sway = 0.4 + weather.waves * 1.6 + weather.wind * 0.8;
        painting.repaint((0.0, HORIZON), (width, HEIGHT as f32), LAKE, |painting, x, y| {
            let depth = (y - HORIZON) / (HEIGHT as f32 - HORIZON);
            let wobble =
                ((y * 1.7 + t * 1.3).sin() + (y * 0.6 - t * 0.7 + x * 0.05).sin() * 0.5) * sway * (0.3 + depth * 1.4);
            let mirrored = HORIZON - (y - HORIZON) * 1.5;
            let color = mix(painting.frame_at(x + wobble, mirrored), WATER, 0.12 + 0.3 * depth);
            let from_sun = (x - SUN.0).abs() / (3.0 + depth * 10.0);
            if from_sun >= 1.0 {
                return color;
            }
            let glitter = noise(x / 2.5 + t * 0.4, y * 0.9 - t * 1.1, 3);
            mix(
                color,
                light.shine,
                (1.0 - from_sun) * unit((glitter - 0.4) * 3.0) * 0.85,
            )
        });

        // Ripple lines moving toward the shore, longer as they come near.
        for &(across, phase) in &self.ripples {
            let near = (phase + t * 0.035) % 1.0;
            let y = HORIZON + 2.0 + (HEIGHT as f32 - HORIZON - 6.0) * near.powf(1.5);
            let length = 3.0 + 22.0 * near;
            let middle = across * (width + 30.0) - 15.0 + (t * 0.2 + across * 9.0).sin() * 4.0;
            let color = if (middle - SUN.0).abs() < 14.0 + near * 10.0 {
                light.shine
            } else {
                light.ripple
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
            painting.add_behind(x, boat_y + 1.0 + (j / 3.0).floor(), light.ripple, 0.7 - j * 0.04, LAKE);
            painting.add_behind(x, boat_y - (j / 4.0).floor(), light.ripple, 0.5 - j * 0.03, LAKE);
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

        // A lantern at the bow while a fire crackles, flickering, with its light on the water.
        if weather.fire > 0.0 {
            let flicker = weather.fire * (0.75 + 0.25 * noise(t * 4.0, 0.0, 91));
            let (lamp_x, lamp_y) = (boat_x - 13.0, boat_y - 4.0);
            painting.glaze(
                (lamp_x - 4.0, lamp_y - 4.0),
                (lamp_x + 5.0, lamp_y + 5.0),
                u8::MAX,
                |x, y| {
                    let distance = (x - lamp_x - 0.5).hypot(y - lamp_y - 0.5);
                    (distance < 4.0).then(|| (LAMP, unit(1.0 - distance / 4.0) * 0.5 * flicker))
                },
            );
            painting.add(lamp_x, lamp_y, rgb(0xffe0a0), flicker);
            painting.add(lamp_x, lamp_y + 1.0, LAMP, flicker);
            for j in 4..12 {
                let j = j as f32;
                let shimmer = (t * 3.0 + j).sin() * 0.8;
                painting.add_behind(lamp_x + shimmer, boat_y + j, LAMP, (0.6 - j * 0.04) * flicker, LAKE);
            }
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

        // Blossom, leaves, or snow drifting down. Rain falls as snow in winter.
        if let Some((kind, light_color, dark_color, amount)) = seasonal(season).falling {
            let rain = if kind == Falling::Snow {
                weather.rain * 140.0
            } else {
                0.0
            };
            let (speed, flutter) = match kind {
                Falling::Petals => (0.05, 2.5),
                Falling::Leaves => (0.07, 4.0),
                Falling::Snow => (0.06, 1.2),
            };
            for flake in 0..(amount + rain) as i64 {
                let k = flake as f32;
                let fall = (t * speed * (0.7 + 0.6 * hash(flake, 1, 95)) + hash(flake, 2, 95)) % 1.0;
                let y = fall * (HEIGHT as f32 + 6.0) - 3.0;
                let drift = hash(flake, 3, 95) * (width + 40.0) + fall * 30.0 * breeze;
                let x = drift % (width + 40.0) - 20.0 + (t * 0.9 + k).sin() * flutter;
                let turned = (t * 3.0 + k).sin() > 0.0;
                let color = if turned { dark_color } else { light_color };
                painting.add(x, y, color, 0.95);
                if kind != Falling::Snow {
                    painting.add(
                        x + if turned { 1.0 } else { 0.0 },
                        y + if turned { 0.0 } else { 1.0 },
                        color,
                        0.7,
                    );
                }
            }
        }

        painting.overcast(weather.rain);
        painting.cover(canvas, FOCUS);
    }
}
