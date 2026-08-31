import { sessionEventForTransition, type FocusSessionStatus } from '@/lib/focus-session';
import { MAX_LIKED_TRACKS } from '@/lib/likes';
import { LIKED_SCENE } from '@/lib/tracks';
import type { Track } from '@/models/app';
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

describe('toggleTrackLike', () => {
    beforeEach(resetStore);

    it('adds and removes a like', () => {
        expect(useAppStore.getState().toggleTrackLike('track-1')).toBe('liked');
        expect(useAppStore.getState().likedTrackIds).toEqual(['track-1']);

        expect(useAppStore.getState().toggleTrackLike('track-1')).toBe('unliked');
        expect(useAppStore.getState().likedTrackIds).toEqual([]);
    });

    it('refuses a like past the cap instead of adding one the server would reject', () => {
        const full = Array.from({ length: MAX_LIKED_TRACKS }, (_, index) => `track-${index}`);
        useAppStore.setState({ likedTrackIds: full });

        expect(useAppStore.getState().toggleTrackLike('one-too-many')).toBe('limit-reached');
        expect(useAppStore.getState().likedTrackIds).toEqual(full);
    });

    it('still unlikes while at the cap', () => {
        const full = Array.from({ length: MAX_LIKED_TRACKS }, (_, index) => `track-${index}`);
        useAppStore.setState({ likedTrackIds: full });

        expect(useAppStore.getState().toggleTrackLike('track-0')).toBe('unliked');
        expect(useAppStore.getState().likedTrackIds).toHaveLength(MAX_LIKED_TRACKS - 1);
    });
});

describe('the liked-tracks queue', () => {
    beforeEach(resetStore);

    const track = (id: string, category: string): Track => ({
        id,
        title: id,
        artist: 'Test',
        audioUrl: `/audio/${id}.mp3`,
        duration: 60,
        tags: [],
        category,
    });
    const library = [track('rain', 'nature'), track('focus', 'focus'), track('hum', 'ambient')];

    it('plays only liked tracks while the liked filter is on', () => {
        useAppStore.setState({
            tracks: library,
            likedTrackIds: ['rain', 'hum'],
            activeScene: LIKED_SCENE,
            currentTrack: library[0],
        });

        const queue = useAppStore.getState().getQueue();
        expect(queue.map((entry) => entry.id)).toEqual(['rain', 'hum']);

        useAppStore.getState().nextTrack();
        expect(useAppStore.getState().currentTrack?.id).toBe('hum');
        useAppStore.getState().nextTrack();
        expect(useAppStore.getState().currentTrack?.id).toBe('rain');
    });

    it('drops the filter when the last like goes, so the queue is never empty', () => {
        useAppStore.setState({ tracks: library, likedTrackIds: ['rain'], activeScene: LIKED_SCENE });

        useAppStore.getState().toggleTrackLike('rain');

        expect(useAppStore.getState().activeScene).toBeNull();
        expect(useAppStore.getState().getQueue()).toHaveLength(library.length);
    });

    it('keeps the filter while other likes remain', () => {
        useAppStore.setState({ tracks: library, likedTrackIds: ['rain', 'hum'], activeScene: LIKED_SCENE });

        useAppStore.getState().toggleTrackLike('rain');

        expect(useAppStore.getState().activeScene).toBe(LIKED_SCENE);
    });
});

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

    it('keeps the remaining time when a policy toggle changes', () => {
        // The toggles sit in the popover beside a dial that now deliberately waits at phase
        // boundaries, so restarting the phase on a toggle is exactly the wrong moment.
        atTime(0);
        useAppStore.getState().startTimer();
        atTime(10 * 60_000);
        useAppStore.getState().pauseTimer();
        expect(useAppStore.getState().timerSeconds).toBe(15 * 60);

        useAppStore.getState().updatePomodoroSettings({ autoStartFocus: false });
        expect(useAppStore.getState().timerSeconds).toBe(15 * 60);

        useAppStore.getState().updatePomodoroSettings({ autoStartBreaks: false });
        expect(useAppStore.getState().timerSeconds).toBe(15 * 60);
    });

    it('keeps a paused break when an unrelated duration is retuned', () => {
        useAppStore.getState().updatePomodoroSettings({ isBreak: true });
        atTime(0);
        useAppStore.getState().startTimer();
        atTime(2 * 60_000);
        useAppStore.getState().pauseTimer();
        expect(useAppStore.getState().timerSeconds).toBe(3 * 60);

        useAppStore.getState().updatePomodoroSettings({ focusMinutes: 40 });
        expect(useAppStore.getState().timerSeconds).toBe(3 * 60);
    });

    it('still shows a retuned duration for the phase on the dial', () => {
        useAppStore.getState().updatePomodoroSettings({ focusMinutes: 40 });

        expect(useAppStore.getState().timerSeconds).toBe(40 * 60);
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

describe('applySceneTimer', () => {
    beforeEach(resetStore);

    const scene = {
        timerMode: 'focus' as const,
        timerPreset: '45m',
        customMinutes: '25',
        pomodoroSettings: {
            focusMinutes: 50,
            breakMinutes: 10,
            longBreakMinutes: 20,
            sessionsBeforeLongBreak: 3,
            autoStartBreaks: false,
            autoStartFocus: false,
        },
    };

    it('points an idle dial at the scene', () => {
        expect(useAppStore.getState().applySceneTimer(scene)).toBe(true);

        const state = useAppStore.getState();
        expect(state.timerMode).toBe('focus');
        expect(state.selectedPreset).toBe('45m');
        expect(state.timerSeconds).toBe(45 * 60);
        expect(state.pomodoroSettings.focusMinutes).toBe(50);
        expect(state.timerActive).toBe(false);
    });

    it('refuses while a block is running', () => {
        useAppStore.getState().startTimer();

        expect(useAppStore.getState().applySceneTimer(scene)).toBe(false);
        expect(useAppStore.getState().selectedPreset).toBe('25m');
        expect(useAppStore.getState().timerActive).toBe(true);
    });

    it('refuses while a paused block still holds time', () => {
        vi.useFakeTimers();
        atTime(0);
        useAppStore.getState().startTimer();
        atTime(5 * 60 * 1000);
        useAppStore.getState().pauseTimer();

        expect(useAppStore.getState().applySceneTimer(scene)).toBe(false);
        expect(useAppStore.getState().timerSeconds).toBe(20 * 60);
        vi.useRealTimers();
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
            version: 2,
            savedAt: 0,
            timerMode: 'focus',
            selectedPreset: '25m',
            openEnded: false,
            wasRunning: true,
            remainingSeconds: 12 * 60,
            elapsedSeconds: 0,
            pomodoroSession: 1,
            pomodoroIsBreak: false,
            sessionId: null,
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

        const taken = timerSnapshotOf(useAppStore.getState(), Date.now(), 'session-1');
        expect(taken.remainingSeconds).toBe(40 * 60);
        expect(taken.sessionId).toBe('session-1');

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
