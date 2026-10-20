use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct PomodoroSettings {
    pub focus_minutes: u32,
    pub break_minutes: u32,
    pub long_break_minutes: u32,
    pub long_break_every: u32,
    pub auto_start_breaks: bool,
    pub auto_start_focus: bool,
}

impl Default for PomodoroSettings {
    fn default() -> Self {
        PomodoroSettings {
            focus_minutes: 25,
            break_minutes: 5,
            long_break_minutes: 15,
            long_break_every: 4,
            auto_start_breaks: true,
            auto_start_focus: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum TimerMode {
    Focus { minutes: u32 },
    Pomodoro,
}

impl TimerMode {
    pub const PRESETS: [TimerMode; 4] = [
        TimerMode::Focus { minutes: 25 },
        TimerMode::Focus { minutes: 50 },
        TimerMode::Focus { minutes: 90 },
        TimerMode::Pomodoro,
    ];

    pub fn label(self) -> String {
        match self {
            TimerMode::Focus { minutes } => format!("{minutes}m"),
            TimerMode::Pomodoro => "pomodoro".into(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Focus,
    Break,
    LongBreak,
}

impl Phase {
    pub fn label(self) -> &'static str {
        match self {
            Phase::Focus => "focus",
            Phase::Break => "break",
            Phase::LongBreak => "long break",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PhaseEnded {
    pub ended: Phase,
    pub length: Duration,
    pub next: Phase,
    pub auto_started: bool,
}

#[derive(Debug, Clone)]
pub struct Timer {
    mode: TimerMode,
    settings: PomodoroSettings,
    phase: Phase,
    /// Fixed when the phase starts, so changing settings mid-phase can't rewrite how much
    /// of it has already elapsed.
    length: Duration,
    remaining: Duration,
    deadline: Option<Instant>,
    focus_blocks_done: u32,
}

impl Timer {
    pub fn new(mode: TimerMode, settings: PomodoroSettings) -> Timer {
        let mut timer = Timer {
            mode,
            settings,
            phase: Phase::Focus,
            length: Duration::ZERO,
            remaining: Duration::ZERO,
            deadline: None,
            focus_blocks_done: 0,
        };
        timer.rearm();
        timer
    }

    fn rearm(&mut self) {
        self.length = self.planned_length();
        self.remaining = self.length;
    }

    /// Takes effect from the next phase, or right away when the current one hasn't started.
    pub fn set_settings(&mut self, settings: PomodoroSettings) {
        self.settings = settings;
        if self.deadline.is_none() && self.remaining == self.length {
            self.rearm();
        }
    }

    pub fn mode(&self) -> TimerMode {
        self.mode
    }

    pub fn phase(&self) -> Phase {
        self.phase
    }

    pub fn is_running(&self) -> bool {
        self.deadline.is_some()
    }

    pub fn phase_length(&self) -> Duration {
        self.length
    }

    fn planned_length(&self) -> Duration {
        let minutes = match (self.mode, self.phase) {
            (TimerMode::Focus { minutes }, _) => minutes,
            (TimerMode::Pomodoro, Phase::Focus) => self.settings.focus_minutes,
            (TimerMode::Pomodoro, Phase::Break) => self.settings.break_minutes,
            (TimerMode::Pomodoro, Phase::LongBreak) => self.settings.long_break_minutes,
        };
        Duration::from_secs(u64::from(minutes.max(1)) * 60)
    }

    pub fn remaining(&self, now: Instant) -> Duration {
        match self.deadline {
            Some(deadline) => deadline.saturating_duration_since(now),
            None => self.remaining,
        }
    }

    pub fn elapsed(&self, now: Instant) -> Duration {
        self.phase_length().saturating_sub(self.remaining(now))
    }

    pub fn progress(&self, now: Instant) -> f64 {
        self.elapsed(now).as_secs_f64() / self.phase_length().as_secs_f64()
    }

    /// Position inside the Pomodoro cycle as (current block, blocks per cycle).
    pub fn cycle(&self) -> Option<(u32, u32)> {
        let every = self.settings.long_break_every.max(1);
        match self.mode {
            TimerMode::Pomodoro => {
                let done = self.focus_blocks_done % every;
                let current = match (self.phase, done) {
                    (Phase::Focus, _) => done + 1,
                    (_, 0) => every,
                    (_, _) => done,
                };
                Some((current.min(every), every))
            }
            TimerMode::Focus { .. } => None,
        }
    }

    pub fn start(&mut self, now: Instant) {
        if self.deadline.is_none() {
            self.deadline = Some(now + self.remaining);
        }
    }

    /// Moves a running phase's end later, for time that shouldn't count toward it.
    pub fn defer(&mut self, by: Duration) {
        if let Some(deadline) = &mut self.deadline {
            *deadline += by;
        }
    }

    pub fn pause(&mut self, now: Instant) {
        if let Some(deadline) = self.deadline.take() {
            self.remaining = deadline.saturating_duration_since(now);
        }
    }

    pub fn reset(&mut self) {
        self.deadline = None;
        self.rearm();
    }

    pub fn set_mode(&mut self, mode: TimerMode, settings: PomodoroSettings) {
        *self = Timer::new(mode, settings);
    }

    pub fn tick(&mut self, now: Instant) -> Option<PhaseEnded> {
        let deadline = self.deadline?;
        (now >= deadline).then(|| self.advance(now))
    }

    pub fn skip(&mut self, now: Instant) -> PhaseEnded {
        self.advance(now)
    }

    fn advance(&mut self, now: Instant) -> PhaseEnded {
        let was_running = self.deadline.is_some();
        let ended = self.phase;
        let length = self.phase_length();
        let every = self.settings.long_break_every.max(1);
        let (next, auto_start) = match (self.mode, ended) {
            (TimerMode::Focus { .. }, _) => (Phase::Focus, false),
            (TimerMode::Pomodoro, Phase::Focus) => {
                self.focus_blocks_done += 1;
                let long = self.focus_blocks_done.is_multiple_of(every);
                let next = if long { Phase::LongBreak } else { Phase::Break };
                (next, self.settings.auto_start_breaks)
            }
            (TimerMode::Pomodoro, Phase::Break | Phase::LongBreak) => (Phase::Focus, self.settings.auto_start_focus),
        };
        let auto_start = auto_start && was_running;
        self.phase = next;
        self.rearm();
        self.deadline = auto_start.then(|| now + self.remaining);
        PhaseEnded {
            ended,
            length,
            next,
            auto_started: auto_start,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINUTE: Duration = Duration::from_secs(60);

    #[test]
    fn pause_keeps_the_remaining_time() {
        let start = Instant::now();
        let mut timer = Timer::new(TimerMode::Focus { minutes: 25 }, PomodoroSettings::default());
        timer.start(start);
        timer.pause(start + 10 * MINUTE);
        assert_eq!(timer.remaining(start + 60 * MINUTE), 15 * MINUTE);
        assert_eq!(timer.elapsed(start + 60 * MINUTE), 10 * MINUTE);
    }

    #[test]
    fn a_single_focus_block_ends_and_rearms_paused() {
        let start = Instant::now();
        let mut timer = Timer::new(TimerMode::Focus { minutes: 25 }, PomodoroSettings::default());
        timer.start(start);
        assert_eq!(timer.tick(start + 24 * MINUTE), None);
        let ended = timer.tick(start + 25 * MINUTE).unwrap();
        assert_eq!(
            (ended.ended, ended.length, ended.auto_started),
            (Phase::Focus, 25 * MINUTE, false)
        );
        assert!(!timer.is_running());
        assert_eq!(timer.remaining(start + 30 * MINUTE), 25 * MINUTE);
    }

    #[test]
    fn pomodoro_takes_a_long_break_after_every_fourth_focus_block() {
        let settings = PomodoroSettings {
            auto_start_focus: true,
            auto_start_breaks: true,
            ..Default::default()
        };
        let mut now = Instant::now();
        let mut timer = Timer::new(TimerMode::Pomodoro, settings);
        timer.start(now);
        let mut phases = Vec::new();
        for _ in 0..8 {
            now += timer.remaining(now);
            phases.push(timer.tick(now).unwrap().next);
        }
        use Phase::*;
        assert_eq!(phases, [Break, Focus, Break, Focus, Break, Focus, LongBreak, Focus]);
    }

    #[test]
    fn the_long_break_counts_the_block_that_earned_it() {
        let now = Instant::now();
        let mut timer = Timer::new(TimerMode::Pomodoro, PomodoroSettings::default());
        timer.start(now);
        for _ in 0..4 {
            let ended = timer.skip(now);
            if ended.next == Phase::Focus {
                timer.skip(now);
            }
        }
        assert_eq!((timer.phase(), timer.cycle()), (Phase::LongBreak, Some((4, 4))));
    }

    #[test]
    fn skipping_a_paused_timer_leaves_the_next_phase_paused() {
        let now = Instant::now();
        let mut timer = Timer::new(TimerMode::Pomodoro, PomodoroSettings::default());
        let ended = timer.skip(now);
        assert_eq!(
            (ended.next, ended.auto_started, timer.is_running()),
            (Phase::Break, false, false)
        );
    }

    #[test]
    fn changing_lengths_mid_block_keeps_the_time_already_focused() {
        let start = Instant::now();
        let mut timer = Timer::new(TimerMode::Pomodoro, PomodoroSettings::default());
        timer.start(start);
        let longer = PomodoroSettings {
            focus_minutes: 50,
            ..Default::default()
        };
        timer.set_settings(longer);
        assert_eq!(timer.elapsed(start + 10 * MINUTE), 10 * MINUTE);
        assert_eq!(timer.phase_length(), 25 * MINUTE);

        let mut idle = Timer::new(TimerMode::Pomodoro, PomodoroSettings::default());
        idle.set_settings(longer);
        assert_eq!(idle.remaining(start), 50 * MINUTE);
    }

    #[test]
    fn breaks_wait_for_the_user_when_auto_start_is_off() {
        let settings = PomodoroSettings {
            auto_start_breaks: false,
            ..Default::default()
        };
        let now = Instant::now();
        let mut timer = Timer::new(TimerMode::Pomodoro, settings);
        timer.start(now);
        let ended = timer.skip(now);
        assert_eq!((ended.next, ended.auto_started), (Phase::Break, false));
        assert!(!timer.is_running());
        assert_eq!(timer.cycle(), Some((1, 4)));
    }
}
