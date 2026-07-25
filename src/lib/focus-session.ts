/**
 * Pure focus-session lifecycle reducer.
 *
 * The workspace timer (focus countdown, infinite focus, and Pomodoro focus blocks)
 * all funnel through this reducer so that *actual* focused time is recorded
 * consistently — independent of which mode produced it. The reducer is deliberately
 * pure (no clocks, no network): callers pass wall-clock timestamps in and receive a
 * command describing the API call to make. This keeps the lifecycle unit-testable.
 *
 * Key rules:
 * - One logical focus block can span multiple run/pause segments without creating
 *   duplicate sessions (pausing accumulates time; it does not start a new session).
 * - Elapsed time is measured from wall-clock segment timestamps, not interval ticks,
 *   and is capped at the planned duration for finite timers.
 * - A block that ran for at least MIN_RECORDED_SECONDS is COMPLETEd; anything shorter
 *   (or explicitly abandoned via CANCEL) is canceled and does not count.
 */

/** Minimum real focus time before a block is recorded as a completed session. */
export const MIN_RECORDED_SECONDS = 60;

/** Server validation caps planned/elapsed at 12 hours; mirror that here. */
export const MAX_SESSION_SECONDS = 12 * 60 * 60;

export type FocusSessionStatus = 'idle' | 'running' | 'paused';

export interface FocusSessionState {
    status: FocusSessionStatus;
    /** Capped planned duration in seconds; infinite blocks use MAX_SESSION_SECONDS. */
    plannedSeconds: number;
    /** Focus time accumulated across completed (paused) segments, in ms. */
    accumulatedMs: number;
    /** Wall-clock start of the current running segment, or null when not running. */
    segmentStartMs: number | null;
}

export const initialFocusSessionState: FocusSessionState = {
    status: 'idle',
    plannedSeconds: 0,
    accumulatedMs: 0,
    segmentStartMs: null,
};

export type FocusSessionEvent =
    /** Focus begins. `plannedSeconds <= 0` means an open-ended (infinite) block. */
    | { type: 'START'; plannedSeconds: number; atMs: number }
    /** Focus paused but resumable — keeps the active session, accumulates time. */
    | { type: 'PAUSE'; atMs: number }
    /** Focus resumed after a pause. */
    | { type: 'RESUME'; atMs: number }
    /** Block finished naturally (timer hit 0, Pomodoro focus rolled to break, unload). */
    | { type: 'COMPLETE'; atMs: number }
    /** Block abandoned (reset / mode switch) — never counts as focus time. */
    | { type: 'CANCEL' };

export type FocusSessionCommand =
    | { type: 'NONE' }
    | { type: 'START_SESSION'; plannedSeconds: number }
    | { type: 'COMPLETE_SESSION'; elapsedSeconds: number }
    | { type: 'CANCEL_SESSION' };

export interface FocusSessionResult {
    state: FocusSessionState;
    command: FocusSessionCommand;
}

function clampPlanned(planned: number): number {
    if (!Number.isFinite(planned) || planned <= 0) {
        return MAX_SESSION_SECONDS;
    }
    return Math.min(Math.max(Math.round(planned), MIN_RECORDED_SECONDS), MAX_SESSION_SECONDS);
}

/** Total elapsed focus seconds for the current block, capped at the planned duration. */
export function elapsedSecondsOf(state: FocusSessionState, atMs: number): number {
    const runningMs =
        state.status === 'running' && state.segmentStartMs != null ? Math.max(0, atMs - state.segmentStartMs) : 0;
    const totalSeconds = Math.round((state.accumulatedMs + runningMs) / 1000);
    const cap = state.plannedSeconds > 0 ? state.plannedSeconds : MAX_SESSION_SECONDS;
    return Math.max(0, Math.min(totalSeconds, cap));
}

/**
 * Timer state either side of a commit, as the session lifecycle sees it. Deliberately
 * structural rather than importing the store's types: this module stays free of clocks,
 * network, and store.
 */
export interface TimerTransition {
    /** A focus phase was running at the previous commit. */
    wasFocusRunning: boolean;
    /** A focus phase is running now. */
    isFocusRunning: boolean;
    /** The phase now on the dial is a Pomodoro break — separates a handover from a pause. */
    isBreak: boolean;
    timerMode: 'focus' | 'pomodoro';
    timerSeconds: number;
    isOpenEnded: boolean;
    /** The user reset the dial in this commit (button, ⇧S, or the command palette). */
    wasReset: boolean;
    sessionStatus: FocusSessionStatus;
    atMs: number;
}

/**
 * Decide which lifecycle event a timer transition means, or null for none. Kept out of the
 * component so the run/pause/reset matrix is testable without rendering a dial.
 */
export function sessionEventForTransition(transition: TimerTransition): FocusSessionEvent | null {
    const { isBreak, timerMode, timerSeconds, isOpenEnded, sessionStatus, atMs } = transition;

    // Reset abandons the block whether it was running or paused, so it is decided before
    // the run/stop transition it also causes. Open-ended focus has no countdown to end it,
    // making reset the only way to finish one — bank that time instead of discarding it.
    if (transition.wasReset) {
        if (sessionStatus === 'idle') return null;
        return isOpenEnded ? { type: 'COMPLETE', atMs } : { type: 'CANCEL' };
    }

    if (!transition.wasFocusRunning && transition.isFocusRunning) {
        if (sessionStatus === 'paused') return { type: 'RESUME', atMs };
        if (isOpenEnded || timerSeconds >= MIN_RECORDED_SECONDS) {
            return { type: 'START', plannedSeconds: isOpenEnded ? 0 : timerSeconds, atMs };
        }
        return null;
    }

    if (transition.wasFocusRunning && !transition.isFocusRunning) {
        // A focus phase that gave way to a break finished, whether or not the break started
        // itself — so this reads the phase rather than whether the clock is still running.
        if (isBreak) return { type: 'COMPLETE', atMs };
        // A finite focus countdown that reached zero finished. Open-ended focus holds
        // timerSeconds at 0 for its whole run, so it can only have been paused.
        if (timerMode === 'focus' && !isOpenEnded && timerSeconds === 0) return { type: 'COMPLETE', atMs };
        return { type: 'PAUSE', atMs };
    }

    return null;
}

export function focusSessionReducer(state: FocusSessionState, event: FocusSessionEvent): FocusSessionResult {
    switch (event.type) {
        case 'START': {
            // Ignore a redundant START while a block is already in flight.
            if (state.status !== 'idle') {
                return { state, command: { type: 'NONE' } };
            }
            const plannedSeconds = clampPlanned(event.plannedSeconds);
            return {
                state: { status: 'running', plannedSeconds, accumulatedMs: 0, segmentStartMs: event.atMs },
                command: { type: 'START_SESSION', plannedSeconds },
            };
        }

        case 'PAUSE': {
            if (state.status !== 'running' || state.segmentStartMs == null) {
                return { state, command: { type: 'NONE' } };
            }
            const accumulatedMs = state.accumulatedMs + Math.max(0, event.atMs - state.segmentStartMs);
            return {
                state: { ...state, status: 'paused', accumulatedMs, segmentStartMs: null },
                command: { type: 'NONE' },
            };
        }

        case 'RESUME': {
            if (state.status !== 'paused') {
                return { state, command: { type: 'NONE' } };
            }
            return {
                state: { ...state, status: 'running', segmentStartMs: event.atMs },
                command: { type: 'NONE' },
            };
        }

        case 'COMPLETE': {
            if (state.status === 'idle') {
                return { state, command: { type: 'NONE' } };
            }
            const elapsedSeconds = elapsedSecondsOf(state, event.atMs);
            if (elapsedSeconds >= MIN_RECORDED_SECONDS) {
                return { state: { ...initialFocusSessionState }, command: { type: 'COMPLETE_SESSION', elapsedSeconds } };
            }
            return { state: { ...initialFocusSessionState }, command: { type: 'CANCEL_SESSION' } };
        }

        case 'CANCEL': {
            if (state.status === 'idle') {
                return { state, command: { type: 'NONE' } };
            }
            return { state: { ...initialFocusSessionState }, command: { type: 'CANCEL_SESSION' } };
        }

        default:
            return { state, command: { type: 'NONE' } };
    }
}
