//! Ported from `autumn-pagoda-maples` in ascii-magic-art, (c) 2026 ASCII Magic, MIT licensed; see
//! `licenses/ascii-magic-art.txt`.

use std::f32::consts::PI;

use super::canvas::{Canvas, Painting, Rgb, fbm, lerp, mix, moonlit, ramp, rgb, unit};
use super::{Season, Weather};

pub const WIDTH: usize = 192;
pub const HEIGHT: usize = 108;
const WATERLINE: f32 = 86.0;
const PAGODA_X: f32 = 130.0;
const SUN: (f32, f32) = (60.0, 50.0);
const SUN_RADIUS: f32 = 7.0;
const BRIDGE_FROM: f32 = 22.0;
const BRIDGE_TO: f32 = 98.0;
/// A very wide player crops the picture; this keeps the pagoda and the bridge in view.
const FOCUS: (f32, f32) = (0.6, 0.55);

const SKY: u8 = 0;
const HILL: u8 = 1;
const MIDDLE: u8 = 2;
const POND: u8 = 3;
const BRIDGE: u8 = 4;
const BANK: u8 = 5;

/// The maples from lit to shaded, through the year: cherry blossom, summer green, autumn red, and
/// crowns heavy with snow.
const BLOSSOM: [Rgb; 7] = [
    rgb(0xffe4ee),
    rgb(0xffc8dc),
    rgb(0xf4a8c8),
    rgb(0xe088b0),
    rgb(0xc06a98),
    rgb(0x8a4a74),
    rgb(0x5e3456),
];
const GREENS: [Rgb; 7] = [
    rgb(0xc8e078),
    rgb(0x98c860),
    rgb(0x6ea84a),
    rgb(0x4a8a40),
    rgb(0x346a36),
    rgb(0x244e30),
    rgb(0x18362a),
];
const REDS: [Rgb; 7] = [
    rgb(0xffb050),
    rgb(0xff8a3a),
    rgb(0xf06a2a),
    rgb(0xd84a24),
    rgb(0xb8341e),
    rgb(0x8a2418),
    rgb(0x5e1a16),
];
const SNOWY: [Rgb; 7] = [
    rgb(0xffffff),
    rgb(0xf0eef6),
    rgb(0xd8d6e6),
    rgb(0xb4b0c8),
    rgb(0x847e9c),
    rgb(0x56506a),
    rgb(0x34303e),
];
const SNOW: Rgb = rgb(0xf4f2fa);
const POND_WATER: Rgb = rgb(0x46344a);

fn crowns(season: Season) -> &'static [Rgb; 7] {
    match season {
        Season::Spring => &BLOSSOM,
        Season::Summer => &GREENS,
        Season::Auto | Season::Autumn => &REDS,
        Season::Winter => &SNOWY,
    }
}
const TIMBER: Rgb = rgb(0x1e0e12);
const BARK: Rgb = rgb(0x2a1418);
const LAMP: Rgb = rgb(0xf0a838);
const LAMP_BRIGHT: Rgb = rgb(0xffd070);

const EAVES: [f32; 5] = [68.0, 56.0, 45.0, 35.0, 26.0];
const ROOFS: [f32; 5] = [23.0, 20.0, 17.0, 14.5, 12.0];
const BODIES: [f32; 5] = [11.0, 9.5, 8.0, 6.8, 5.6];

/// A five tier pagoda among maples on an evening, with lanterns on an arched bridge and a branch
/// swaying in the wind, over a pond that mirrors it all. The maples follow the seasons, and at
/// night the moon rises and the lanterns glow.
pub struct AutumnPagoda {
    painting: Option<((bool, Season), Painting)>,
    windows: Vec<(f32, f32, f32)>,
    lanterns: Vec<(f32, f32)>,
    /// The branch's dots, each with the shade of the crown it's in, or none for the bark.
    branch: Vec<(f32, f32, Option<usize>)>,
    ripples: Vec<(f32, f32)>,
}

fn deck(x: f32) -> f32 {
    WATERLINE - 1.0 - 11.0 * (PI * (x - BRIDGE_FROM) / (BRIDGE_TO - BRIDGE_FROM)).sin()
}

fn inside(x: f32, y: f32, polygon: &[(f32, f32)]) -> bool {
    let mut crossed = false;
    let mut previous = polygon[polygon.len() - 1];
    for &point in polygon {
        let ((xi, yi), (xj, yj)) = (point, previous);
        if (yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi {
            crossed = !crossed;
        }
        previous = point;
    }
    crossed
}

/// A crown's color from lit to shaded, blended rather than picked so the crowns shade smoothly.
fn crown(colors: &[Rgb; 7], shade: f32) -> Rgb {
    let stops: [(f32, Rgb); 7] = std::array::from_fn(|index| (index as f32 / 6.0, colors[index]));
    ramp(&stops, shade)
}

/// A maple's crown: a noisy blob lit from the upper left.
fn canopy(
    painting: &mut Painting,
    (cx, cy): (f32, f32),
    (rx, ry): (f32, f32),
    seed: i64,
    shade: f32,
    colors: &[Rgb; 7],
) {
    painting.paint(
        (cx - rx - 2.0, cy - ry - 2.0),
        (cx + rx + 3.0, cy + ry + 3.0),
        MIDDLE,
        |_, x, y| {
            let (dx, dy) = ((x - cx) / rx, (y - cy) / ry);
            let grain = fbm(x / 3.5, y / 3.5, 3, seed);
            let light = unit(0.55 - dx * 0.35 - dy * 0.4 + (grain - 0.5) * 0.9 - shade);
            (dx.hypot(dy) + (grain - 0.5) * 0.7 <= 1.0).then(|| crown(colors, 1.0 - light))
        },
    );
}

/// Five tiers with upswept eaves, each a body under its roof, and a spire with rings. Snow lies
/// along the roofs in winter.
fn pagoda(painting: &mut Painting, snowy: bool) {
    for tier in 0..5 {
        let (eave, roof, body) = (EAVES[tier], ROOFS[tier], BODIES[tier]);
        let bottom = if tier == 0 { 81.0 } else { EAVES[tier - 1] - 4.0 };
        painting.paint(
            (PAGODA_X - body, eave),
            (PAGODA_X + body + 1.0, bottom),
            MIDDLE,
            |_, x, y| {
                Some(if (y - eave).floor() as i32 % 4 == 3 {
                    rgb(0x3e1a1c)
                } else if x < PAGODA_X - body + 2.0 {
                    rgb(0x5a2420)
                } else {
                    BARK
                })
            },
        );
        painting.paint(
            (PAGODA_X - roof, eave - 6.0),
            (PAGODA_X + roof + 1.0, eave + 2.0),
            MIDDLE,
            |_, x, y| {
                let across = (x - PAGODA_X - 0.5).abs() / roof;
                let top = eave - 5.0 + 4.2 * across.powf(0.85) - 2.0 * across.powi(6);
                let low = eave + 1.0 - 2.5 * across.powi(5);
                let ridge = y < top + 1.0;
                let color = match (snowy && ridge, ridge && x < PAGODA_X) {
                    (true, _) => SNOW,
                    (false, true) => rgb(0x8a3a28),
                    (false, false) => TIMBER,
                };
                (across <= 1.0 && y >= top && y < low + 1.0).then_some(color)
            },
        );
    }
    painting.paint((PAGODA_X - 1.0, 5.0), (PAGODA_X + 2.0, 22.0), MIDDLE, |_, x, y| {
        let ring = [9.0, 11.0, 13.0, 15.0, 17.0]
            .iter()
            .any(|ring| (*ring..ring + 1.0).contains(&y));
        let spire = (PAGODA_X..PAGODA_X + 1.0).contains(&x);
        if spire && y < 6.0 {
            Some(rgb(0x3e1a1c))
        } else {
            (spire || ring).then_some(TIMBER)
        }
    });
}

/// The vermilion arched bridge, with its rails, posts and the piers at each end.
fn bridge(painting: &mut Painting, snowy: bool) {
    painting.paint((BRIDGE_FROM, 60.0), (BRIDGE_TO + 1.0, WATERLINE), BRIDGE, |_, x, y| {
        let offset = y - deck(x);
        let post = (x - BRIDGE_FROM) % 6.0 < 1.0 && (-6.5..-1.5).contains(&offset);
        match offset {
            offset if snowy && (-7.5..-6.5).contains(&offset) => Some(SNOW),
            _ if post => Some(rgb(0xe05a34)),
            offset if (-6.5..-5.5).contains(&offset) => Some(rgb(0xff7a40)),
            offset if (-1.5..-0.5).contains(&offset) => Some(rgb(0xffa060)),
            offset if (-0.5..0.5).contains(&offset) => Some(rgb(0xff7a40)),
            offset if (0.5..1.5).contains(&offset) => Some(rgb(0xe05a34)),
            offset if (1.5..2.5).contains(&offset) => Some(rgb(0x5a2420)),
            _ => None,
        }
    });
    for (end, inward) in [(BRIDGE_FROM, 1.0), (BRIDGE_TO, -1.0)] {
        let (from, to) = (end.min(end + inward), end.max(end + inward) + 1.0);
        painting.paint((from, WATERLINE - 6.0), (to, WATERLINE), BRIDGE, |_, x, _| {
            Some(if (end..end + 1.0).contains(&x) {
                rgb(0xe05a34)
            } else {
                rgb(0xb04028)
            })
        });
    }
}

/// The parts that never move, painted once.
fn still(night: bool, season: Season) -> Painting {
    let (width, height) = (WIDTH as f32, HEIGHT as f32);
    let (colors, snowy) = (crowns(season), season == Season::Winter);
    // Winter's snow lies along the top of each hill and bank, `deep` pixels of it, jagged, with
    // streaks running further down, the way it caps Fuji.
    let capped = |color: Rgb, x: f32, below: f32, deep: f32| {
        let streak = unit((x * 0.9).sin() * (x * 0.23).sin() * 2.0);
        let line = deep * (0.6 + 0.6 * fbm(x / 3.0, deep, 3, 43) + streak);
        if snowy && below < line {
            mix(SNOW, color, unit(below / line) * 0.35)
        } else {
            color
        }
    };
    let mut painting = Painting::new(WIDTH, HEIGHT);
    let sky = [
        (0.0, rgb(0xb07a8a)),
        (0.25, rgb(0xcc8a80)),
        (0.45, rgb(0xe49a78)),
        (0.62, rgb(0xf4ac70)),
        (0.78, rgb(0xffc078)),
        (1.0, rgb(0xffd490)),
    ];
    painting.paint((0.0, 0.0), (width, WATERLINE), SKY, |_, x, y| {
        let distance = (x - SUN.0).hypot((y - SUN.1) * 1.3);
        Some(mix(
            ramp(&sky, y / 62.0),
            rgb(0xffe2a8),
            unit(1.0 - distance / 46.0) * 0.45,
        ))
    });
    painting.paint((0.0, 45.0), (width, WATERLINE), HILL, |_, x, y| {
        let top = 56.0 + 4.0 * (x / 31.0 + 2.0).sin() + 3.0 * fbm(x / 14.0, 3.0, 3, 4);
        (y >= top).then(|| {
            capped(
                mix(rgb(0x7a5470), rgb(0x3a2a44), unit((y - top) / 10.0)),
                x,
                y - top,
                4.0,
            )
        })
    });
    canopy(&mut painting, (100.0, 60.0), (14.0, 9.0), 3, 0.15, colors);
    canopy(&mut painting, (166.0, 58.0), (16.0, 10.0), 5, 0.15, colors);
    canopy(&mut painting, (186.0, 64.0), (12.0, 9.0), 7, 0.2, colors);
    pagoda(&mut painting, snowy);
    painting.paint((70.0, 70.0), (width, WATERLINE), MIDDLE, |_, x, y| {
        let top = 76.0 + 3.0 * (x / 19.0).sin() + 2.0 * fbm(x / 7.0, 9.0, 3, 2);
        (y >= top).then(|| {
            let ground = if fbm(x / 3.0, y / 3.0, 2, 8) > 0.55 {
                rgb(0x3a2a2a)
            } else {
                rgb(0x2a2026)
            };
            capped(ground, x, y - top, 1.5)
        })
    });
    canopy(&mut painting, (106.0, 76.0), (13.0, 7.0), 11, 0.0, colors);
    canopy(&mut painting, (156.0, 74.0), (15.0, 8.0), 13, 0.0, colors);
    canopy(&mut painting, (182.0, 78.0), (13.0, 8.0), 17, 0.0, colors);
    canopy(&mut painting, (84.0, 80.0), (10.0, 6.0), 19, 0.1, colors);
    bridge(&mut painting, snowy);
    painting.paint((0.0, WATERLINE), (width, height), POND, |_, _, _| Some(POND_WATER));
    let left_bank = [(0.0, 84.0), (14.0, 88.0), (24.0, 96.0), (30.0, height), (0.0, height)];
    let right_bank = [
        (width, 88.0),
        (178.0, 92.0),
        (168.0, 100.0),
        (162.0, height),
        (width, height),
    ];
    let on_bank = |x: f32, y: f32| inside(x, y, &left_bank) || inside(x, y, &right_bank);
    painting.paint((0.0, 80.0), (width, height), BANK, |_, x, y| {
        on_bank(x, y).then(|| {
            let ground = if fbm(x / 3.0, y / 3.0, 2, 41) > 0.55 {
                rgb(0x3a2a2a)
            } else {
                rgb(0x261e2e)
            };
            let below = (1..4)
                .find(|up| !on_bank(x, y - *up as f32))
                .map_or(3.0, |up| up as f32 - 1.0);
            capped(ground, x, below, 1.5)
        })
    });
    if night {
        painting.grade(moonlit);
    }
    painting
}

impl AutumnPagoda {
    pub fn new() -> AutumnPagoda {
        let windows = (0..5)
            .map(|tier| (PAGODA_X - 2.0, EAVES[tier] + 3.0, (BODIES[tier] * 0.5).round().max(2.0)))
            .collect();
        let lanterns = [12.0, 38.0, 64.0]
            .map(|offset| (BRIDGE_FROM + offset, deck(BRIDGE_FROM + offset).round() - 7.0))
            .to_vec();
        // A maple branch reaching in from the top left, drawn each frame so it can sway.
        let mut branch = Vec::new();
        for (from, to) in [
            ((-2.0, 4.0), (30.0, 12.0)),
            ((14.0, 8.0), (26.0, 20.0)),
            ((30.0, 12.0), (46.0, 9.0)),
            ((24.0, 11.0), (38.0, 22.0)),
        ] {
            let mut along: f32 = 0.0;
            while along <= 1.0 {
                branch.push((lerp(from.0, to.0, along), lerp(from.1, to.1, along), None));
                along += 0.03;
            }
        }
        let clumps: [(f32, f32, f32, f32); 6] = [
            (8.0, 9.0, 7.0, 4.0),
            (26.0, 18.0, 8.0, 5.0),
            (40.0, 10.0, 8.0, 4.0),
            (36.0, 22.0, 6.0, 4.0),
            (18.0, 3.0, 8.0, 3.0),
            (48.0, 6.0, 5.0, 3.0),
        ];
        for (index, (cx, cy, rx, ry)) in clumps.into_iter().enumerate() {
            let mut y = (cy - ry - 1.0).floor();
            while y <= cy + ry + 1.0 {
                let mut x = (cx - rx - 1.0).floor();
                while x <= cx + rx + 1.0 {
                    let grain = fbm(x / 2.2, y / 2.2, 2, 50 + index as i64);
                    let distance = ((x - cx) / rx).hypot((y - cy) / ry) + (grain - 0.5) * 0.9;
                    if distance < 1.0 && grain > 0.36 {
                        let shade = match grain {
                            grain if grain > 0.62 => 3,
                            grain if grain > 0.5 => 4,
                            _ => 5,
                        };
                        branch.push((x, y, Some(shade)));
                    }
                    x += 1.0;
                }
                y += 1.0;
            }
        }
        let ripples = (0..18)
            .map(|index| (((index * 59) % 83) as f32 / 83.0, ((index * 31) % 47) as f32 / 47.0))
            .collect();
        AutumnPagoda {
            painting: None,
            windows,
            lanterns,
            branch,
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
        let breeze = 0.5 + 1.5 * weather.wind;
        let (width, height) = (WIDTH as f32, HEIGHT as f32);
        painting.begin();

        if night {
            painting.stars(t, 50.0, SKY);
            painting.moon(SUN, SUN_RADIUS - 2.0, SKY);
        } else {
            painting.glaze(
                (SUN.0 - SUN_RADIUS, SUN.1 - SUN_RADIUS),
                (SUN.0 + SUN_RADIUS, SUN.1 + SUN_RADIUS),
                SKY,
                |x, y| {
                    let distance = (x - SUN.0).hypot(y - SUN.1);
                    let color = if distance < SUN_RADIUS - 1.5 {
                        rgb(0xfffaea)
                    } else {
                        rgb(0xfff0c8)
                    };
                    (distance < SUN_RADIUS).then_some((color, 1.0))
                },
            );
        }

        // The pagoda's windows and the paper lanterns flicker softly, glowing out into the dark at
        // night.
        for (index, &(x, y, half)) in self.windows.iter().enumerate() {
            let i = index as f32;
            let flicker = 0.8 + 0.2 * (t * 4.1 + i * 1.9).sin() * (t * 1.3 + i).sin();
            let mut across = x - half + 2.0;
            while across <= x + half {
                painting.add(across, y, mix(LAMP, LAMP_BRIGHT, flicker), 0.95);
                across += 1.0;
            }
        }
        let halo = if night { 0.45 } else { 0.15 };
        for (index, &(x, y)) in self.lanterns.iter().enumerate() {
            let flicker = 0.82 + 0.18 * (t * 3.7 + index as f32 * 2.3).sin();
            let (cx, cy) = (x + 0.5, y + 1.5);
            painting.glaze((cx - 7.0, cy - 7.0), (cx + 7.0, cy + 7.0), BRIDGE, |gx, gy| {
                let distance = (gx - cx).hypot(gy - cy);
                (distance < 7.0).then(|| (LAMP, unit(1.0 - distance / 7.0) * halo * flicker))
            });
            painting.add(x, y - 1.0, BARK, 1.0);
            for down in 0..3 {
                for across in -1..=1 {
                    painting.add(x + across as f32, y + down as f32, mix(LAMP, LAMP_BRIGHT, flicker), 1.0);
                }
            }
        }

        // The pond mirrors everything above it, swaying more with waves and wind.
        let sway = 0.4 + weather.waves * 1.6 + weather.wind * 0.8;
        painting.repaint((0.0, WATERLINE), (width, height), POND, |painting, x, y| {
            let depth = (y - WATERLINE) / (height - WATERLINE);
            let wobble =
                ((y * 1.7 + t * 1.3).sin() + (y * 0.6 - t * 0.7 + x * 0.05).sin() * 0.5) * sway * (0.3 + depth * 1.4);
            let reflected = painting.frame_at(x + wobble, WATERLINE - (y - WATERLINE) * 1.1);
            let tint = if night { moonlit(rgb(0xc09088)) } else { rgb(0xc09088) };
            mix(mix(reflected, tint, 0.22), POND_WATER, 0.1 + 0.3 * depth)
        });

        for &(across, phase) in &self.ripples {
            let near = (phase + t * 0.04) % 1.0;
            let y = WATERLINE + 2.0 + (height - WATERLINE - 3.0) * near;
            let length = 4.0 + 14.0 * near;
            let middle = across * (width + 20.0) - 10.0;
            let mut x = middle - length / 2.0;
            while x < middle + length / 2.0 {
                painting.add_behind(x, y, rgb(0xe0b090), 0.5, POND);
                painting.add_behind(x, y + 1.0, rgb(0x261e2e), 0.4, POND);
                x += 1.0;
            }
        }

        let sway = ((t * 0.9).sin() * 1.4 + (t * 2.3).sin() * 0.4) * breeze;
        let colors = crowns(season);
        for &(x, y, shade) in &self.branch {
            let reach = unit(x / 50.0);
            let color = shade.map_or(BARK, |shade| colors[shade]);
            let color = if night { moonlit(color) } else { color };
            painting.add(x + sway * reach, y + sway * reach * 0.4, color, 1.0);
        }

        painting.drift(t, season, weather);

        painting.overcast(weather.rain);
        painting.cover(canvas, FOCUS);
    }
}
