use std::ops::Range;
use std::sync::Arc;

use realfft::num_complex::Complex;
use realfft::{RealFftPlanner, RealToComplex};
use rtrb::Consumer;

const FFT_LEN: usize = 2048;
const LOW_HZ: f32 = 40.0;
const HIGH_HZ: f32 = 12_000.0;
const FLOOR_DB: f32 = -78.0;
const CEILING_DB: f32 = -6.0;
/// Music loses energy as frequency rises, so without a tilt the bass pins the left bars to the
/// top while the right half of the visualizer stays dark.
const TILT_DB_PER_OCTAVE: f32 = 3.0;
const TILT_PIVOT_HZ: f32 = 1_000.0;

pub(super) struct Analysis {
    samples: Consumer<f32>,
    rate: f32,
    history: Vec<f32>,
    write: usize,
    window: Vec<f32>,
    fft: Arc<dyn RealToComplex<f32>>,
    input: Vec<f32>,
    output: Vec<Complex<f32>>,
    scratch: Vec<Complex<f32>>,
    bins: Vec<Range<usize>>,
    tilts: Vec<f32>,
}

impl Analysis {
    pub(super) fn new(samples: Consumer<f32>, rate: u32) -> Self {
        let fft = RealFftPlanner::<f32>::new().plan_fft_forward(FFT_LEN);
        let window = (0..FFT_LEN)
            .map(|index| {
                let phase = std::f32::consts::TAU * index as f32 / FFT_LEN as f32;
                0.5 - 0.5 * phase.cos()
            })
            .collect();
        Self {
            samples,
            rate: rate as f32,
            history: vec![0.0; FFT_LEN],
            write: 0,
            window,
            input: fft.make_input_vec(),
            output: fft.make_output_vec(),
            scratch: fft.make_scratch_vec(),
            fft,
            bins: Vec::new(),
            tilts: Vec::new(),
        }
    }

    pub(super) fn fill(&mut self, bands: &mut [f32]) {
        self.drain();
        let (newest, oldest) = self.history.split_at(self.write);
        for ((input, sample), weight) in self.input.iter_mut().zip(oldest.iter().chain(newest)).zip(&self.window) {
            *input = sample * weight;
        }
        if self
            .fft
            .process_with_scratch(&mut self.input, &mut self.output, &mut self.scratch)
            .is_err()
        {
            bands.fill(0.0);
            return;
        }
        if self.bins.len() != bands.len() {
            self.bins = band_bins(bands.len(), self.rate, FFT_LEN);
            let bin_hz = self.rate / FFT_LEN as f32;
            self.tilts = self
                .bins
                .iter()
                .map(|bins| {
                    let center_hz = (bins.start + bins.end) as f32 * 0.5 * bin_hz;
                    TILT_DB_PER_OCTAVE * (center_hz.max(1.0) / TILT_PIVOT_HZ).log2()
                })
                .collect();
        }
        // A full-scale sine peaks at FFT_LEN / 4 under a Hann window; this rescales it to 0 dB.
        let scale = 4.0 / FFT_LEN as f32;
        for ((band, bins), tilt) in bands.iter_mut().zip(&self.bins).zip(&self.tilts) {
            let peak = self.output[bins.clone()]
                .iter()
                .fold(0.0_f32, |max, bin| max.max(bin.norm()));
            *band = level(peak * scale, *tilt);
        }
    }

    fn drain(&mut self) {
        let available = self.samples.slots();
        let Ok(chunk) = self.samples.read_chunk(available) else {
            return;
        };
        let (first, second) = chunk.as_slices();
        for &sample in first.iter().chain(second) {
            self.history[self.write] = sample;
            self.write = (self.write + 1) % FFT_LEN;
        }
        chunk.commit_all();
    }
}

fn band_bins(bands: usize, rate: f32, fft_len: usize) -> Vec<Range<usize>> {
    let bin_hz = rate / fft_len as f32;
    let last_bin = fft_len / 2;
    let span = HIGH_HZ.min(rate / 2.0) / LOW_HZ;
    let edge = |band: usize| {
        let hz = LOW_HZ * span.powf(band as f32 / bands as f32);
        ((hz / bin_hz).round() as usize).min(last_bin)
    };
    (0..bands)
        .map(|band| {
            let start = edge(band);
            start..edge(band + 1).max(start + 1)
        })
        .collect()
}

fn level(amplitude: f32, tilt_db: f32) -> f32 {
    let db = 20.0 * amplitude.max(1e-9).log10() + tilt_db;
    ((db - FLOOR_DB) / (CEILING_DB - FLOOR_DB)).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rtrb::RingBuffer;

    #[test]
    fn bands_cover_the_audible_range_without_gaps() {
        let rate = 48_000.0;
        let bins = band_bins(32, rate, FFT_LEN);
        let bin_hz = rate / FFT_LEN as f32;
        assert_eq!(bins.len(), 32);
        assert!(bins.iter().all(|range| !range.is_empty()));
        assert!(bins.windows(2).all(|pair| pair[1].start >= pair[0].start));
        assert_eq!(bins[0].start, (LOW_HZ / bin_hz).round() as usize);
        assert_eq!(bins[31].end, (HIGH_HZ / bin_hz).round() as usize);
    }

    #[test]
    fn a_sine_lights_up_the_band_holding_its_frequency() {
        let rate = 48_000;
        let (mut producer, consumer) = RingBuffer::new(FFT_LEN);
        for index in 0..FFT_LEN {
            let t = index as f32 / rate as f32;
            let _ = producer.push(0.5 * (std::f32::consts::TAU * 440.0 * t).sin());
        }
        let mut analysis = Analysis::new(consumer, rate);
        let mut bands = [0.0; 24];
        analysis.fill(&mut bands);

        let bin = (440.0 / (rate as f32 / FFT_LEN as f32)).round() as usize;
        let expected = analysis.bins.iter().position(|range| range.contains(&bin)).unwrap();
        let loudest = (0..bands.len()).max_by(|&a, &b| bands[a].total_cmp(&bands[b])).unwrap();
        assert_eq!(loudest, expected);
        assert!(bands[expected] > 0.8);
        assert!(bands[0] < 0.3 && bands[23] < 0.3);
    }
}
