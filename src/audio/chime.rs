use std::f32::consts::TAU;

const FUNDAMENTAL_HZ: f32 = 784.0;
const LENGTH_SECS: f32 = 1.5;
const ATTACK_SECS: f32 = 0.004;
const RELEASE_SECS: f32 = 0.1;
const PEAK: f32 = 0.25;

/// (frequency ratio, amplitude, decay time constant in seconds). The ratios are the
/// inharmonic partials of a struck bell.
const PARTIALS: [(f32, f32, f32); 4] = [(1.0, 1.0, 0.4), (2.76, 0.45, 0.25), (5.40, 0.2, 0.15), (8.93, 0.1, 0.1)];

pub(super) fn synthesize(rate: u32) -> Box<[f32]> {
    let rate = rate as f32;
    let len = (LENGTH_SECS * rate) as usize;
    let release_start = len as f32 - RELEASE_SECS * rate;
    let mut samples: Vec<f32> = (0..len)
        .map(|index| {
            let t = index as f32 / rate;
            let attack = (t / ATTACK_SECS).min(1.0);
            let release = ((len as f32 - index as f32) / (len as f32 - release_start)).min(1.0);
            let tone: f32 = PARTIALS
                .iter()
                .map(|&(ratio, amplitude, decay)| {
                    amplitude * (-t / decay).exp() * (TAU * FUNDAMENTAL_HZ * ratio * t).sin()
                })
                .sum();
            tone * attack * release
        })
        .collect();
    let peak = samples.iter().fold(0.0_f32, |max, sample| max.max(sample.abs()));
    if peak > 0.0 {
        samples.iter_mut().for_each(|sample| *sample *= PEAK / peak);
    }
    samples.into_boxed_slice()
}
