//! Ported from `autumn-pagoda-maples` in ascii-magic-art, (c) 2026 ASCII Magic, MIT licensed; see
//! `licenses/ascii-magic-art.txt`.

use std::f32::consts::PI;

use super::Weather;
use super::canvas::{Canvas, Painting, Rgb, fbm, lerp, mix, ramp, rgb, unit};

const WIDTH: usize = 192;
const HEIGHT: usize = 108;
const WATERLINE: f32 = 86.0;
const PAGODA_X: f32 = 130.0;
const SUN: (f32, f32) = (60.0, 50.0);
const SUN_RADIUS: f32 = 7.0;
const BRIDGE_FROM: f32 = 22.0;
const BRIDGE_TO: f32 = 98.0;

const SKY: u8 = 0;
const HILL: u8 = 1;
const MIDDLE: u8 = 2;
const POND: u8 = 3;
const BRIDGE: u8 = 4;
const BANK: u8 = 5;

const REDS: [Rgb; 7] = [
    rgb(0xffb050),
    rgb(0xff8a3a),
    rgb(0xf06a2a),
    rgb(0xd84a24),
    rgb(0xb8341e),
    rgb(0x8a2418),
    rgb(0x5e1a16),
];
const TIMBER: Rgb = rgb(0x1e0e12);
const BARK: Rgb = rgb(0x2a1418);
const LAMP: Rgb = rgb(0xf0a838);
const LAMP_BRIGHT: Rgb = rgb(0xffd070);

struct Leaf {
    x: f32,
    phase: f32,
    speed: f32,
    swing: f32,
    flutter: f32,
    color: Rgb,
}

/// A five tier pagoda among red maples on an autumn evening, with lanterns on an arched bridge,
/// a branch swaying in the wind and maple leaves drifting down.
pub struct AutumnPagoda {
    painting: Painting,
    windows: Vec<(f32, f32, f32)>,
    lanterns: Vec<(f32, f32)>,
    branch: Vec<(f32, f32, Rgb)>,
    leaves: Vec<Leaf>,
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

/// A maple's crown: a noisy blob lit from the upper left.
fn canopy(painting: &mut Painting, (cx, cy): (f32, f32), (rx, ry): (f32, f32), seed: i64, shade: f32) {
    let mut y = (cy - ry - 2.0).floor();
    while y <= cy + ry + 2.0 {
        let mut x = (cx - rx - 2.0).floor();
        while x <= cx + rx + 2.0 {
            let (dx, dy) = ((x - cx) / rx, (y - cy) / ry);
            let grain = fbm(x / 3.5, y / 3.5, 3, seed);
            if dx.hypot(dy) + (grain - 0.5) * 0.7 <= 1.0 {
                let light = unit(0.55 - dx * 0.35 - dy * 0.4 + (grain - 0.5) * 0.9 - shade);
                let red = REDS[((1.0 - light) * (REDS.len() - 1) as f32).round() as usize];
                painting.put(x, y, red, MIDDLE);
            }
            x += 1.0;
        }
        y += 1.0;
    }
}

impl AutumnPagoda {
    pub fn new() -> AutumnPagoda {
        let mut painting = Painting::new(WIDTH, HEIGHT);
        let columns = || (0..WIDTH).map(|x| x as f32);
        let sky = [
            (0.0, rgb(0xb07a8a)),
            (0.25, rgb(0xcc8a80)),
            (0.45, rgb(0xe49a78)),
            (0.62, rgb(0xf4ac70)),
            (0.78, rgb(0xffc078)),
            (1.0, rgb(0xffd490)),
        ];
        for row in 0..WATERLINE as usize {
            let y = row as f32;
            for x in columns() {
                let distance = (x - SUN.0).hypot((y - SUN.1) * 1.3);
                let color = mix(ramp(&sky, y / 62.0), rgb(0xffe2a8), unit(1.0 - distance / 46.0) * 0.45);
                painting.put(x, y, color, SKY);
            }
        }
        for x in columns() {
            let top = 56.0 + 4.0 * (x / 31.0 + 2.0).sin() + 3.0 * fbm(x / 14.0, 3.0, 3, 4);
            let mut y = top.floor();
            while y < WATERLINE {
                painting.put(x, y, mix(rgb(0x7a5470), rgb(0x3a2a44), unit((y - top) / 10.0)), HILL);
                y += 1.0;
            }
        }
        canopy(&mut painting, (100.0, 60.0), (14.0, 9.0), 3, 0.15);
        canopy(&mut painting, (166.0, 58.0), (16.0, 10.0), 5, 0.15);
        canopy(&mut painting, (186.0, 64.0), (12.0, 9.0), 7, 0.2);

        // Five tiers with upswept eaves, and a spire with rings.
        let eaves = [68.0, 56.0, 45.0, 35.0, 26.0];
        let roofs = [23.0, 20.0, 17.0, 14.5, 12.0];
        let bodies = [11.0, 9.5, 8.0, 6.8, 5.6];
        let mut windows = Vec::new();
        for tier in 0..5 {
            let (eave, roof, body) = (eaves[tier], roofs[tier], bodies[tier]);
            let bottom = if tier == 0 { 80.0 } else { eaves[tier - 1] - 5.0 };
            let mut y = eave;
            while y <= bottom {
                let mut x = (PAGODA_X - body).round();
                while x <= (PAGODA_X + body).round() {
                    let color = if (y - eave) % 4.0 == 3.0 {
                        rgb(0x3e1a1c)
                    } else if x < PAGODA_X - body + 2.0 {
                        rgb(0x5a2420)
                    } else {
                        BARK
                    };
                    painting.put(x, y, color, MIDDLE);
                    x += 1.0;
                }
                y += 1.0;
            }
            windows.push((PAGODA_X - 2.0, eave + 3.0, (body * 0.5).round().max(2.0)));
            let mut x = (PAGODA_X - roof).round();
            while x <= (PAGODA_X + roof).round() {
                let across = (x - PAGODA_X).abs() / roof;
                let top = (eave - 5.0 + 4.2 * across.powf(0.85) - 2.0 * across.powi(6)).round();
                let low = (eave + 1.0 - 2.5 * across.powi(5)).round();
                let mut y = top;
                while y <= low {
                    let color = if y == top && x < PAGODA_X {
                        rgb(0x8a3a28)
                    } else {
                        TIMBER
                    };
                    painting.put(x, y, color, MIDDLE);
                    y += 1.0;
                }
                x += 1.0;
            }
        }
        for y in 6..=21 {
            painting.put(PAGODA_X, y as f32, TIMBER, MIDDLE);
        }
        for y in [9.0, 11.0, 13.0, 15.0, 17.0] {
            painting.put(PAGODA_X - 1.0, y, TIMBER, MIDDLE);
            painting.put(PAGODA_X + 1.0, y, TIMBER, MIDDLE);
        }
        painting.put(PAGODA_X, 5.0, rgb(0x3e1a1c), MIDDLE);

        // The bank behind the pond, and the maples in front of the pagoda's base.
        for x in (70..WIDTH).map(|x| x as f32) {
            let mut y = (76.0 + 3.0 * (x / 19.0).sin() + 2.0 * fbm(x / 7.0, 9.0, 3, 2)).floor();
            while y < WATERLINE {
                let color = if fbm(x / 3.0, y / 3.0, 2, 8) > 0.55 {
                    rgb(0x3a2a2a)
                } else {
                    rgb(0x2a2026)
                };
                painting.put(x, y, color, MIDDLE);
                y += 1.0;
            }
        }
        canopy(&mut painting, (106.0, 76.0), (13.0, 7.0), 11, 0.0);
        canopy(&mut painting, (156.0, 74.0), (15.0, 8.0), 13, 0.0);
        canopy(&mut painting, (182.0, 78.0), (13.0, 8.0), 17, 0.0);
        canopy(&mut painting, (84.0, 80.0), (10.0, 6.0), 19, 0.1);

        // The vermilion arched bridge, with rail posts.
        let mut x = BRIDGE_FROM;
        while x <= BRIDGE_TO {
            let top = deck(x);
            painting.put(x, top - 1.0, rgb(0xffa060), BRIDGE);
            painting.put(x, top, rgb(0xff7a40), BRIDGE);
            painting.put(x, top + 1.0, rgb(0xe05a34), BRIDGE);
            painting.put(x, top + 2.0, rgb(0x5a2420), BRIDGE);
            painting.put(x, top - 6.0, rgb(0xff7a40), BRIDGE);
            if (x - BRIDGE_FROM) % 6.0 == 0.0 {
                let mut y = top - 6.0;
                while y < top - 1.0 {
                    painting.put(x, y, rgb(0xe05a34), BRIDGE);
                    y += 1.0;
                }
            }
            x += 1.0;
        }
        for (end, inward) in [(BRIDGE_FROM, 1.0), (BRIDGE_TO, -1.0)] {
            for y in (WATERLINE as usize - 6)..WATERLINE as usize {
                painting.put(end, y as f32, rgb(0xe05a34), BRIDGE);
                painting.put(end + inward, y as f32, rgb(0xb04028), BRIDGE);
            }
        }
        let lanterns = [12.0, 38.0, 64.0]
            .map(|offset| (BRIDGE_FROM + offset, deck(BRIDGE_FROM + offset).round() - 7.0))
            .to_vec();

        // The pond mirrors everything above it, a little darker with depth.
        for row in WATERLINE as usize..HEIGHT {
            let y = row as f32;
            let mirrored = (WATERLINE - 1.0 - (y - WATERLINE) * 1.1).round().max(0.0) as usize;
            let depth = (y - WATERLINE) / (HEIGHT as f32 - WATERLINE);
            for column in 0..WIDTH {
                let reflected = mix(painting.still(column, mirrored), rgb(0xc09088), 0.22);
                painting.put(column as f32, y, mix(reflected, rgb(0x46344a), 0.1 + 0.3 * depth), POND);
            }
        }
        let (height, width) = (HEIGHT as f32, WIDTH as f32);
        let left_bank = [(0.0, 84.0), (14.0, 88.0), (24.0, 96.0), (30.0, height), (0.0, height)];
        let right_bank = [
            (width, 88.0),
            (178.0, 92.0),
            (168.0, 100.0),
            (162.0, height),
            (width, height),
        ];
        for row in 80..HEIGHT {
            for column in 0..WIDTH {
                let (x, y) = (column as f32, row as f32);
                let centre = (x + 0.5, y + 0.5);
                if inside(centre.0, centre.1, &left_bank) || inside(centre.0, centre.1, &right_bank) {
                    let color = if fbm(x / 3.0, y / 3.0, 2, 41) > 0.55 {
                        rgb(0x3a2a2a)
                    } else {
                        rgb(0x261e2e)
                    };
                    painting.put(x, y, color, BANK);
                }
            }
        }

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
                branch.push((lerp(from.0, to.0, along), lerp(from.1, to.1, along), BARK));
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
                        let color = match grain {
                            grain if grain > 0.62 => REDS[3],
                            grain if grain > 0.5 => REDS[4],
                            _ => REDS[5],
                        };
                        branch.push((x, y, color));
                    }
                    x += 1.0;
                }
                y += 1.0;
            }
        }
        let leaves = (0..46)
            .map(|index| Leaf {
                x: ((index * 97) % 211) as f32 - 10.0,
                phase: ((index * 37) % 101) as f32 / 101.0,
                speed: 0.035 + ((index * 13) % 7) as f32 * 0.006,
                swing: 3.0 + (index % 5) as f32,
                flutter: 0.7 + (index % 4) as f32 * 0.25,
                color: REDS[index % 5],
            })
            .collect();
        let ripples = (0..18)
            .map(|index| (((index * 59) % 83) as f32 / 83.0, ((index * 31) % 47) as f32 / 47.0))
            .collect();
        AutumnPagoda {
            painting,
            windows,
            lanterns,
            branch,
            leaves,
            ripples,
        }
    }

    pub fn paint(&mut self, canvas: &mut Canvas, t: f32, weather: &Weather) {
        let breeze = 0.5 + 1.5 * weather.wind;
        let (width, height) = (WIDTH as f32, HEIGHT as f32);
        let painting = &mut self.painting;
        painting.begin();

        let mut y = SUN.1 - SUN_RADIUS;
        while y <= SUN.1 + SUN_RADIUS {
            let mut x = SUN.0 - SUN_RADIUS;
            while x <= SUN.0 + SUN_RADIUS {
                let distance = (x - SUN.0).hypot(y - SUN.1);
                if distance < SUN_RADIUS {
                    let color = if distance < SUN_RADIUS - 1.5 {
                        rgb(0xfffaea)
                    } else {
                        rgb(0xfff0c8)
                    };
                    painting.add_behind(x, y, color, 1.0, SKY);
                }
                x += 1.0;
            }
            y += 1.0;
        }

        for &(across, phase) in &self.ripples {
            let near = (phase + t * 0.04) % 1.0;
            let y = (WATERLINE + 2.0 + (height - WATERLINE - 3.0) * near).round();
            let length = 4.0 + 14.0 * near;
            let middle = across * (width + 20.0) - 10.0;
            let mut x = (middle - length / 2.0).round();
            while x < middle + length / 2.0 {
                painting.add_behind(x, y, rgb(0xe0b090), 0.5, POND);
                painting.add_behind(x, y + 1.0, rgb(0x261e2e), 0.4, POND);
                x += 1.0;
            }
        }

        // The pagoda's windows and the paper lanterns flicker softly.
        for (index, &(x, y, half)) in self.windows.iter().enumerate() {
            let i = index as f32;
            let flicker = 0.8 + 0.2 * (t * 4.1 + i * 1.9).sin() * (t * 1.3 + i).sin();
            let mut across = x - half + 2.0;
            while across <= x + half {
                painting.add(across, y, mix(LAMP, LAMP_BRIGHT, flicker), 0.95);
                across += 1.0;
            }
        }
        for (index, &(x, y)) in self.lanterns.iter().enumerate() {
            let flicker = 0.82 + 0.18 * (t * 3.7 + index as f32 * 2.3).sin();
            painting.add(x, y - 1.0, BARK, 1.0);
            for down in 0..3 {
                for across in -1..=1 {
                    painting.add(x + across as f32, y + down as f32, mix(LAMP, LAMP_BRIGHT, flicker), 1.0);
                }
            }
            let reflected = WATERLINE + (WATERLINE - y);
            for down in -2..1 {
                painting.add_behind(x, reflected + down as f32, LAMP, 0.5, POND);
            }
        }

        let sway = ((t * 0.9).sin() * 1.4 + (t * 2.3).sin() * 0.4) * breeze;
        for &(x, y, color) in &self.branch {
            let reach = unit(x / 50.0);
            painting.add(x + sway * reach, y + sway * reach * 0.4, color, 1.0);
        }

        for leaf in &self.leaves {
            let fallen = (leaf.phase + t * leaf.speed) % 1.0;
            let y = -4.0 + fallen * (height + 8.0);
            let x = leaf.x + (t * leaf.flutter + leaf.phase * 9.0).sin() * leaf.swing + fallen * 16.0 * breeze;
            let flip = (t * leaf.flutter * 2.4 + leaf.phase * 7.0).sin();
            painting.add(x, y, leaf.color, 1.0);
            if flip > 0.2 {
                painting.add(x + 1.0, y, leaf.color, 1.0);
            } else if flip < -0.2 {
                painting.add(x, y + 1.0, leaf.color, 1.0);
            }
        }

        painting.overcast(weather.rain);
        painting.cover(canvas);
    }
}
