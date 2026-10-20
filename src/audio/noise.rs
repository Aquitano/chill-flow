use fastrand::Rng;

/// Noise the engine makes itself, so it needs no download and plays offline.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Noise {
    White,
    Pink,
    Brown,
}

/// Long enough that the repeat isn't heard.
const LOOP_SECS: u32 = 20;

impl Noise {
    pub const ALL: [Noise; 3] = [Noise::White, Noise::Pink, Noise::Brown];

    pub fn id(self) -> &'static str {
        match self {
            Noise::White => "noise-white",
            Noise::Pink => "noise-pink",
            Noise::Brown => "noise-brown",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Noise::White => "White noise",
            Noise::Pink => "Pink noise",
            Noise::Brown => "Brown noise",
        }
    }

    /// Measured to come out near -16 LUFS, like the recorded loops, since the same level reads
    /// louder the brighter the noise.
    fn rms(self) -> f32 {
        match self {
            Noise::White => 0.074,
            Noise::Pink => 0.113,
            Noise::Brown => 0.127,
        }
    }

    /// An interleaved stereo loop at `rate`. The channels are generated apart, so it sounds wide
    /// instead of sitting in the middle.
    pub(super) fn generate(self, rate: u32) -> Vec<i16> {
        let frames = (rate * LOOP_SECS) as usize;
        let [left, right] = [1, 2].map(|seed| self.channel(frames, rate, &mut Rng::with_seed(seed)));
        left.iter()
            .zip(&right)
            .flat_map(|(&left, &right)| [left, right])
            .map(|sample| (sample.clamp(-1.0, 1.0) * f32::from(i16::MAX)) as i16)
            .collect()
    }

    fn channel(self, frames: usize, rate: u32, rng: &mut Rng) -> Vec<f32> {
        let mut white = || rng.f32() * 2.0 - 1.0;
        let mut samples: Vec<f32> = match self {
            Noise::White => (0..frames).map(|_| white()).collect(),
            // Paul Kellet's filter, which tilts white noise down 3 dB per octave.
            Noise::Pink => {
                let mut b = [0.0_f32; 7];
                (0..frames)
                    .map(|_| {
                        let w = white();
                        b[0] = 0.99886 * b[0] + w * 0.055_517_9;
                        b[1] = 0.99332 * b[1] + w * 0.075_075_9;
                        b[2] = 0.969 * b[2] + w * 0.153_852;
                        b[3] = 0.8665 * b[3] + w * 0.310_485_6;
                        b[4] = 0.55 * b[4] + w * 0.532_952_2;
                        b[5] = -0.7616 * b[5] - w * 0.016_898;
                        let pink = b.iter().sum::<f32>() + w * 0.5362;
                        b[6] = w * 0.115_926;
                        pink
                    })
                    .collect()
            }
            // Integrated white noise, leaking back toward zero so it can't wander off. The leak is set
            // per sample from the rate, so it rolls off from the same 150 Hz on any output.
            Noise::Brown => {
                let leak = (-std::f32::consts::TAU * 150.0 / rate as f32).exp();
                let mut last = 0.0_f32;
                (0..frames)
                    .map(|_| {
                        last = leak * last + (1.0 - leak) * white();
                        last
                    })
                    .collect()
            }
        };
        let rms = (samples.iter().map(|sample| sample * sample).sum::<f32>() / frames.max(1) as f32).sqrt();
        if rms > 0.0 {
            samples.iter_mut().for_each(|sample| *sample *= self.rms() / rms);
        }
        samples
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn power_in(samples: &[i16], every: usize) -> f64 {
        let smoothed: Vec<f64> = samples
            .chunks(every)
            .map(|chunk| chunk.iter().map(|&sample| f64::from(sample)).sum::<f64>() / every as f64)
            .collect();
        smoothed.iter().map(|value| value * value).sum::<f64>() / smoothed.len() as f64
    }

    #[test]
    fn each_color_reaches_its_level_and_darker_ones_keep_more_low_end() {
        let rate = 48_000;
        let [white, pink, brown] = Noise::ALL.map(|noise| noise.generate(rate));
        for (noise, samples) in Noise::ALL.iter().zip([&white, &pink, &brown]) {
            assert_eq!(samples.len(), (rate * LOOP_SECS * 2) as usize);
            let rms = power_in(samples, 1).sqrt() / f64::from(i16::MAX);
            assert!((rms - f64::from(noise.rms())).abs() < 0.005, "{noise:?}: {rms}");
        }
        // Averaging 32 frames at a time leaves only the low frequencies.
        let low = |samples: &[i16]| power_in(samples, 64) / power_in(samples, 1);
        assert!(low(&white) < low(&pink) && low(&pink) < low(&brown));
    }

    #[test]
    fn brown_noise_keeps_its_low_end_at_any_output_rate() {
        // Averaging 2 ms at a time leaves what's under about 250 Hz.
        let low = |rate: u32| {
            let samples = Noise::Brown.generate(rate);
            power_in(&samples, (rate / 500) as usize * 2) / power_in(&samples, 1)
        };
        let (at_44, at_96) = (low(44_100), low(96_000));
        assert!((at_44 - at_96).abs() < 0.05, "{at_44} at 44.1 kHz, {at_96} at 96 kHz");
    }
}
