import { sessionEventForTransition, type FocusSessionStatus } from '@/lib/focus-session';
import {
    OPEN_ENDED_PRESET,
    defaultModes,
    phaseDurationSeconds,
    presetToMinutes,
    timerSnapshotOf,
    useAppStore,
    type TimerSnapshot,
} from '@/store/app-store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const initialState = useAppStore.getState();

function resetStore() {
    useAppStore.setState(initialState, true);
}

/** Freeze the clock so deadline arithmetic is exact. */
function atTime(ms: number) {
    vi.setSystemTime(ms);
}

describe('presetToMinutes', () => {
    it('reads the shipped presets', () => {
        expect(presetToMinutes('15m', '25')).toBe(15);
        expect(presetToMinutes('60m', '25')).toBe(60);
    });

    it('reads the hour and hour-plus-minute labels setCustomTime writes', () => {
        expect(presetToMinutes('2h', '120')).toBe(120);
        expect(presetToMinutes('1h 30m', '90')).toBe(90);
    });

    it('treats the open-ended preset as having no duration', () => {
        expect(presetToMinutes(OPEN_ENDED_PRESET, '25')).toBeNull();
    });

    it('falls back to the custom minutes for an unrecognized label', () => {
        expect(presetToMinutes('???', '42')).toBe(42);
        expect(presetToMinutes('???', 'not-a-number')).toBe(25);
    });
});

describe('phaseDurationSeconds', () => {
    const pomodoroSettings = {
        focusMinutes: 25,
        breakMinutes: 5,
        longBreakMinutes: 15,
        sessionsBeforeLongBreak: 4,
        autoStartBreaks: true,
        autoStartFocus: true,
        currentSession: 1,
        isBreak: false,
    };

    it('uses the long break on the last session of a cycle', () => {
        const base = { timerMode: 'pomodoro' as const, selectedPreset: '25m', customMinutes: '25' };

        expect(
            phaseDurationSeconds({ ...base, pomodoroSettings: { ...pomodoroSettings, isBreak: true } }),
        ).toBe(5 * 60);
        expect(
            phaseDurationSeconds({
                ...base,
                pomodoroSettings: { ...pomodoroSettings, isBreak: true, currentSession: 4 },
            }),
        ).toBe(15 * 60);
    });
});

describe('timer clock', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetStore();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('derives the countdown from wall-clock time, not from tick count', () => {
        atTime(1_000_000);
        useAppStore.getState().setTimerPreset('25m');
        useAppStore.getState().startTimer();

        // Stand in for a throttled background tab: no ticks ran for ten minutes.
        atTime(1_000_000 + 10 * 60_000);
        useAppStore.getState().tickTimer();

        expect(useAppStore.getState().timerSeconds).toBe(15 * 60);
    });

    it('stops a focus countdown at zero', () => {
        atTime(0);
        useAppStore.getState().setTimerPreset('15m');
        useAppStore.getState().startTimer();

        atTime(15 * 60_000 + 500);
        useAppStore.getState().tickTimer();

        expect(useAppStore.getState().timerSeconds).toBe(0);
        expect(useAppStore.getState().timerActive).toBe(false);
    });

    it('pauses at the live remaining time and resumes from there', () => {
        atTime(0);
        useAppStore.getState().setTimerPreset('25m');
        useAppStore.getState().startTimer();

        atTime(60_000);
        useAppStore.getState().pauseTimer();
        expect(useAppStore.getState().timerSeconds).toBe(24 * 60);

        // Idle time between pause and resume must not be counted against the block.
        atTime(60_000 + 5 * 60_000);
        useAppStore.getState().startTimer();
        useAppStore.getState().tickTimer();
        expect(useAppStore.getState().timerSeconds).toBe(24 * 60);
    });

    it('restores a custom duration on reset instead of collapsing to a minute', () => {
        useAppStore.getState().setCustomTime('90');
        expect(useAppStore.getState().selectedPreset).toBe('1h 30m');

        useAppStore.getState().startTimer();
        atTime(Date.now() + 60_000);
        useAppStore.getState().tickTimer();
        useAppStore.getState().resetTimer();

        expect(useAppStore.getState().timerSeconds).toBe(90 * 60);
    });

    it('resets a long break to the long-break length', () => {
        useAppStore.getState().setTimerMode('pomodoro');
        useAppStore.getState().updatePomodoroSettings({ isBreak: true, currentSession: 4 });
        useAppStore.getState().resetTimer();

        expect(useAppStore.getState().timerSeconds).toBe(15 * 60);
    });

    it('restarts a finished block when play is pressed again', () => {
        atTime(0);
        useAppStore.getState().setTimerPreset('15m');
        useAppStore.getState().startTimer();
        atTime(15 * 60_000);
        useAppStore.getState().tickTimer();

        useAppStore.getState().startTimer();

        expect(useAppStore.getState().timerActive).toBe(true);
        expect(useAppStore.getState().timerSeconds).toBe(15 * 60);
    });
});

describe('pomodoro auto-start', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetStore();
        atTime(0);
        useAppStore.getState().setTimerMode('pomodoro');
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('rolls straight into the break by default', () => {
        useAppStore.getState().advancePomodoroPhase();

        expect(useAppStore.getState().pomodoroSettings.isBreak).toBe(true);
        expect(useAppStore.getState().timerActive).toBe(true);
        expect(useAppStore.getState().timerEndsAt).toBe(5 * 60_000);
    });

    it('holds the break at its full length when auto-start is off', () => {
        useAppStore.getState().updatePomodoroSettings({ autoStartBreaks: false });
        useAppStore.getState().advancePomodoroPhase();

        expect(useAppStore.getState().pomodoroSettings.isBreak).toBe(true);
        expect(useAppStore.getState().timerActive).toBe(false);
        expect(useAppStore.getState().timerEndsAt).toBeNull();
        expect(useAppStore.getState().timerSeconds).toBe(5 * 60);
    });

    it('holds the next focus block when its auto-start is off', () => {
        useAppStore.getState().updatePomodoroSettings({ autoStartFocus: false });
        useAppStore.getState().advancePomodoroPhase(); // into the break
        useAppStore.getState().advancePomodoroPhase(); // back to focus

        expect(useAppStore.getState().pomodoroSettings.isBreak).toBe(false);
        expect(useAppStore.getState().timerActive).toBe(false);
        expect(useAppStore.getState().timerSeconds).toBe(25 * 60);
    });

    it('starts a held phase from its full duration', () => {
        useAppStore.getState().updatePomodoroSettings({ autoStartBreaks: false });
        useAppStore.getState().advancePomodoroPhase();

        atTime(30_000);
        useAppStore.getState().startTimer();
        useAppStore.getState().tickTimer();

        expect(useAppStore.getState().timerSeconds).toBe(5 * 60);
    });

    it('keeps each auto-start setting independent', () => {
        useAppStore.getState().updatePomodoroSettings({ autoStartBreaks: false });
        useAppStore.getState().advancePomodoroPhase();
        expect(useAppStore.getState().timerActive).toBe(false);

        useAppStore.getState().advancePomodoroPhase();
        expect(useAppStore.getState().pomodoroSettings.isBreak).toBe(false);
        expect(useAppStore.getState().timerActive).toBe(true);
    });
});

describe('open-ended focus', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetStore();
        useAppStore.getState().setTimerPreset(OPEN_ENDED_PRESET);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('counts up from the wall clock', () => {
        atTime(0);
        useAppStore.getState().startTimer();

        atTime(7 * 60_000);
        useAppStore.getState().tickTimer();

        expect(useAppStore.getState().countUpSeconds).toBe(7 * 60);
    });

    it('banks elapsed time across pauses', () => {
        atTime(0);
        useAppStore.getState().startTimer();
        atTime(60_000);
        useAppStore.getState().pauseTimer();

        atTime(10 * 60_000);
        useAppStore.getState().startTimer();
        atTime(11 * 60_000);
        useAppStore.getState().tickTimer();

        expect(useAppStore.getState().countUpSeconds).toBe(120);
    });

    it('clears the count on reset', () => {
        atTime(0);
        useAppStore.getState().startTimer();
        atTime(60_000);
        useAppStore.getState().resetTimer();

        expect(useAppStore.getState().countUpSeconds).toBe(0);
        expect(useAppStore.getState().timerActive).toBe(false);
    });
});

/**
 * The dial reads store state into sessionEventForTransition, so these drive the real store
 * and feed it the same way rather than restating what the timer does.
 */
describe('focus-session events the store produces', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetStore();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function transitionAt(wasFocusRunning: boolean, nowMs: number, sessionStatus: FocusSessionStatus = 'running') {
        const state = useAppStore.getState();
        const isBreak = state.timerMode === 'pomodoro' && state.pomodoroSettings.isBreak;
        return sessionEventForTransition({
            wasFocusRunning,
            isFocusRunning: state.timerActive && !isBreak,
            isBreak,
            timerMode: state.timerMode,
            timerSeconds: state.timerSeconds,
            isOpenEnded: state.timerMode === 'focus' && state.selectedPreset === OPEN_ENDED_PRESET,
            wasReset: state.timerResetCount > 0,
            sessionStatus,
            atMs: nowMs,
        });
    }

    it('pauses an open-ended block instead of ending the session', () => {
        atTime(0);
        useAppStore.getState().setTimerPreset(OPEN_ENDED_PRESET);
        useAppStore.getState().startTimer();

        atTime(30_000);
        useAppStore.getState().tickTimer();
        useAppStore.getState().pauseTimer();

        expect(transitionAt(true, 30_000)).toEqual({ type: 'PAUSE', atMs: 30_000 });
    });

    it('banks an open-ended block on reset, whichever control triggered it', () => {
        atTime(0);
        useAppStore.getState().setTimerPreset(OPEN_ENDED_PRESET);
        useAppStore.getState().startTimer();

        // ⇧S and the command palette call resetTimer directly, with no dial handler in play.
        atTime(5 * 60_000);
        useAppStore.getState().resetTimer();

        expect(useAppStore.getState().timerResetCount).toBe(1);
        expect(transitionAt(true, 5 * 60_000)).toEqual({ type: 'COMPLETE', atMs: 5 * 60_000 });
    });

    it('abandons a finite block on reset even though the dial reads full again', () => {
        atTime(0);
        useAppStore.getState().setTimerPreset('25m');
        useAppStore.getState().startTimer();

        atTime(10 * 60_000);
        useAppStore.getState().resetTimer();

        expect(useAppStore.getState().timerSeconds).toBe(25 * 60);
        expect(transitionAt(true, 10 * 60_000)).toEqual({ type: 'CANCEL' });
    });
});

describe('restoreTimer', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetStore();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function snapshot(overrides: Partial<TimerSnapshot> = {}): TimerSnapshot {
        return {
            version: 1,
            savedAt: 0,
            timerMode: 'focus',
            selectedPreset: '25m',
            openEnded: false,
            wasRunning: true,
            remainingSeconds: 12 * 60,
            elapsedSeconds: 0,
            pomodoroSession: 1,
            pomodoroIsBreak: false,
            ...overrides,
        };
    }

    it('lands paused at the position the snapshot recorded', () => {
        expect(useAppStore.getState().restoreTimer(snapshot())).toBe('restored');
        expect(useAppStore.getState().timerSeconds).toBe(12 * 60);
        expect(useAppStore.getState().timerActive).toBe(false);
    });

    it('reports a block that ran out while the workspace was closed', () => {
        expect(useAppStore.getState().restoreTimer(snapshot({ remainingSeconds: 0 }))).toBe('finished');
    });

    it('ignores a snapshot that no longer matches the saved preset', () => {
        expect(useAppStore.getState().restoreTimer(snapshot({ selectedPreset: '45m' }))).toBe('ignored');
        expect(useAppStore.getState().timerSeconds).toBe(25 * 60);
    });

    it('round-trips through timerSnapshotOf', () => {
        atTime(0);
        useAppStore.getState().setTimerPreset('45m');
        useAppStore.getState().startTimer();
        atTime(5 * 60_000);

        const taken = timerSnapshotOf(useAppStore.getState(), Date.now());
        expect(taken.remainingSeconds).toBe(40 * 60);

        resetStore();
        useAppStore.getState().setTimerPreset('45m');
        expect(useAppStore.getState().restoreTimer(taken)).toBe('restored');
        expect(useAppStore.getState().timerSeconds).toBe(40 * 60);
    });
});

describe('modes', () => {
    beforeEach(resetStore);

    it('falls back to a known mode when the current one is unknown', () => {
        useAppStore.setState({ currentMode: 'Nonexistent' });
        expect(useAppStore.getState().getCurrentModeSettings()).toEqual(defaultModes.DeepWork);
    });
});
