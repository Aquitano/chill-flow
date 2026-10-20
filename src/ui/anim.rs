use std::time::{Duration, Instant};

/// A value that eases from where it is toward a target.
#[derive(Debug, Clone, Copy)]
pub struct Tween {
    from: f32,
    to: f32,
    start: Instant,
    duration: Duration,
}

impl Tween {
    pub fn new(value: f32) -> Tween {
        Tween {
            from: value,
            to: value,
            start: Instant::now(),
            duration: Duration::ZERO,
        }
    }

    pub fn set(&mut self, to: f32, now: Instant, duration: Duration) {
        if (to - self.to).abs() < f32::EPSILON {
            return;
        }
        self.from = self.value(now);
        self.to = to;
        self.start = now;
        self.duration = duration;
    }

    pub fn jump(&mut self, to: f32) {
        self.from = to;
        self.to = to;
        self.duration = Duration::ZERO;
    }

    /// Starts a fresh run from `from` to `to`, even when the target is unchanged.
    pub fn play(&mut self, from: f32, to: f32, now: Instant, duration: Duration) {
        self.from = from;
        self.to = to;
        self.start = now;
        self.duration = duration;
    }

    pub fn value(&self, now: Instant) -> f32 {
        let t = self.progress(now);
        let eased = 1.0 - (1.0 - t).powi(3);
        self.from + (self.to - self.from) * eased
    }

    pub fn target(&self) -> f32 {
        self.to
    }

    pub fn active(&self, now: Instant) -> bool {
        self.progress(now) < 1.0
    }

    fn progress(&self, now: Instant) -> f32 {
        if self.duration.is_zero() {
            return 1.0;
        }
        (now.saturating_duration_since(self.start).as_secs_f32() / self.duration.as_secs_f32()).min(1.0)
    }
}

/// Smoothed spectrum bars with peaks that hang briefly and then fall.
#[derive(Debug, Clone, Default)]
pub struct Bars {
    pub levels: Vec<f32>,
    pub peaks: Vec<f32>,
    peak_hold: Vec<f32>,
    raw: Vec<f32>,
}

impl Bars {
    pub fn raw_mut(&mut self, count: usize) -> &mut [f32] {
        if self.raw.len() != count {
            self.raw = vec![0.0; count];
            self.levels = vec![0.0; count];
            self.peaks = vec![0.0; count];
            self.peak_hold = vec![0.0; count];
        }
        &mut self.raw
    }

    pub fn update(&mut self, dt: f32) {
        for index in 0..self.raw.len() {
            let target = self.raw[index].powf(1.8);
            let level = &mut self.levels[index];
            let rate = if target > *level { 22.0 } else { 7.0 };
            *level += (target - *level) * (1.0 - (-rate * dt).exp());
            if *level >= self.peaks[index] {
                self.peaks[index] = *level;
                self.peak_hold[index] = 0.45;
            } else if self.peak_hold[index] > 0.0 {
                self.peak_hold[index] -= dt;
            } else {
                self.peaks[index] = (self.peaks[index] - dt * 0.9).max(*level);
            }
        }
    }

    pub fn is_still(&self) -> bool {
        self.levels.iter().chain(&self.peaks).all(|value| *value < 0.002)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retargeting_mid_flight_starts_from_the_current_value() {
        let start = Instant::now();
        let mut tween = Tween::new(0.0);
        tween.set(1.0, start, Duration::from_millis(100));
        let midway = tween.value(start + Duration::from_millis(50));
        assert!(midway > 0.5 && midway < 1.0);
        tween.set(0.0, start + Duration::from_millis(50), Duration::from_millis(100));
        assert!((tween.value(start + Duration::from_millis(50)) - midway).abs() < 1e-6);
        assert_eq!(tween.value(start + Duration::from_secs(1)), 0.0);
    }
}
