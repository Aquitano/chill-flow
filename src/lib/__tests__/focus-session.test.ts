import { describe, expect, it } from 'vitest';
import {
    FocusSessionEvent,
    FocusSessionState,
    MAX_SESSION_SECONDS,
    MIN_RECORDED_SECONDS,
    elapsedSecondsOf,
    focusSessionReducer,
    initialFocusSessionState,
} from '../focus-session';

const s = 1000; // one second in ms

/** Run a sequence of events from the initial state, returning final state + commands. */
function run(events: FocusSessionEvent[]) {
    let state: FocusSessionState = initialFocusSessionState;
    const commands = events.map((event) => {
        const result = focusSessionReducer(state, event);
        state = result.state;
        return result.command;
    });
    return { state, commands };
}

describe('focusSessionReducer', () => {
    it('starts a focus block from idle and emits START_SESSION with clamped planned duration', () => {
        const { state, commands } = run([{ type: 'START', plannedSeconds: 1500, atMs: 0 }]);

        expect(commands[0]).toEqual({ type: 'START_SESSION', plannedSeconds: 1500 });
        expect(state.status).toBe('running');
        expect(state.plannedSeconds).toBe(1500);
        expect(state.segmentStartMs).toBe(0);
    });

    it('ignores a redundant START while a block is already running', () => {
        const { commands } = run([
            { type: 'START', plannedSeconds: 1500, atMs: 0 },
            { type: 'START', plannedSeconds: 600, atMs: 5 * s },
        ]);

        expect(commands[1]).toEqual({ type: 'NONE' });
    });

    it('records a finished finite block with elapsed time (capped at planned)', () => {
        const { commands } = run([
            { type: 'START', plannedSeconds: 1500, atMs: 0 },
            { type: 'COMPLETE', atMs: 1500 * s },
        ]);

        expect(commands[1]).toEqual({ type: 'COMPLETE_SESSION', elapsedSeconds: 1500 });
    });

    it('caps elapsed time at the planned duration even if wall-clock overshoots', () => {
        const { commands } = run([
            { type: 'START', plannedSeconds: 1500, atMs: 0 },
            { type: 'COMPLETE', atMs: 2000 * s },
        ]);

        expect(commands[1]).toEqual({ type: 'COMPLETE_SESSION', elapsedSeconds: 1500 });
    });

    it('accumulates focus time across a pause/resume without starting a second session', () => {
        const { state, commands } = run([
            { type: 'START', plannedSeconds: 3000, atMs: 0 },
            { type: 'PAUSE', atMs: 600 * s }, // focused 600s
            { type: 'RESUME', atMs: 700 * s }, // 100s break, no focus accrued
            { type: 'COMPLETE', atMs: 1300 * s }, // focused another 600s
        ]);

        // Only one START_SESSION across the whole block; pause/resume issue no commands.
        expect(commands.filter((c) => c.type === 'START_SESSION')).toHaveLength(1);
        expect(commands[1]).toEqual({ type: 'NONE' });
        expect(commands[2]).toEqual({ type: 'NONE' });
        expect(commands[3]).toEqual({ type: 'COMPLETE_SESSION', elapsedSeconds: 1200 });
        expect(state).toEqual(initialFocusSessionState);
    });

    it('counts accumulated time when completed while still paused', () => {
        const { commands } = run([
            { type: 'START', plannedSeconds: 3000, atMs: 0 },
            { type: 'PAUSE', atMs: 1200 * s },
            { type: 'COMPLETE', atMs: 9999 * s }, // paused: no extra time
        ]);

        expect(commands[2]).toEqual({ type: 'COMPLETE_SESSION', elapsedSeconds: 1200 });
    });

    it('cancels (does not record) a block shorter than the minimum', () => {
        const { commands } = run([
            { type: 'START', plannedSeconds: 1500, atMs: 0 },
            { type: 'COMPLETE', atMs: (MIN_RECORDED_SECONDS - 1) * s },
        ]);

        expect(commands[1]).toEqual({ type: 'CANCEL_SESSION' });
    });

    it('cancels an in-flight block on CANCEL and resets to idle', () => {
        const { state, commands } = run([
            { type: 'START', plannedSeconds: 1500, atMs: 0 },
            { type: 'CANCEL' },
        ]);

        expect(commands[1]).toEqual({ type: 'CANCEL_SESSION' });
        expect(state).toEqual(initialFocusSessionState);
    });

    it('treats an infinite block (plannedSeconds <= 0) as MAX-capped and records real elapsed', () => {
        const { state, commands } = run([{ type: 'START', plannedSeconds: 0, atMs: 0 }]);
        expect(state.plannedSeconds).toBe(MAX_SESSION_SECONDS);
        expect(commands[0]).toEqual({ type: 'START_SESSION', plannedSeconds: MAX_SESSION_SECONDS });

        const completed = focusSessionReducer(state, { type: 'COMPLETE', atMs: 3600 * s });
        expect(completed.command).toEqual({ type: 'COMPLETE_SESSION', elapsedSeconds: 3600 });
    });

    it('clamps a sub-minimum planned duration up to MIN_RECORDED_SECONDS', () => {
        const { state, commands } = run([{ type: 'START', plannedSeconds: 30, atMs: 0 }]);
        expect(state.plannedSeconds).toBe(MIN_RECORDED_SECONDS);
        expect(commands[0]).toEqual({ type: 'START_SESSION', plannedSeconds: MIN_RECORDED_SECONDS });
    });

    it('clamps an over-maximum planned duration down to MAX_SESSION_SECONDS', () => {
        const { state } = run([{ type: 'START', plannedSeconds: 99 * 60 * 60, atMs: 0 }]);
        expect(state.plannedSeconds).toBe(MAX_SESSION_SECONDS);
    });

    it('ignores lifecycle events that do not apply in the current state', () => {
        expect(focusSessionReducer(initialFocusSessionState, { type: 'PAUSE', atMs: 0 }).command).toEqual({
            type: 'NONE',
        });
        expect(focusSessionReducer(initialFocusSessionState, { type: 'RESUME', atMs: 0 }).command).toEqual({
            type: 'NONE',
        });
        expect(focusSessionReducer(initialFocusSessionState, { type: 'COMPLETE', atMs: 0 }).command).toEqual({
            type: 'NONE',
        });
        expect(focusSessionReducer(initialFocusSessionState, { type: 'CANCEL' }).command).toEqual({ type: 'NONE' });
    });

    it('elapsedSecondsOf reports live running time and is never negative', () => {
        const running: FocusSessionState = {
            status: 'running',
            plannedSeconds: MAX_SESSION_SECONDS,
            accumulatedMs: 300 * s,
            segmentStartMs: 1000 * s,
        };
        expect(elapsedSecondsOf(running, 1100 * s)).toBe(400); // 300 accrued + 100 live
        expect(elapsedSecondsOf(running, 0)).toBe(300); // clock going backwards → only accrued
    });
});
