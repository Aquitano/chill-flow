/**
 * The API side of a focus block.
 *
 * `sessions.start` is a round trip, so a block can finish before its row exists — a short
 * Pomodoro, a quick reset, or a reload all beat the response back. This holds the finishing
 * command until the id arrives instead of dropping the focus time on the floor.
 *
 * Pure and clock-free like the lifecycle reducer it sits behind: callers hold the state,
 * feed it events, and run the effect they get back.
 */

/** How a block ended, as the API sees it. */
export type SessionFinish = { type: 'complete'; elapsedSeconds: number } | { type: 'cancel' };

export type RecorderState =
    | { status: 'idle' }
    /** START is in flight; `queued` holds a finish that arrived before the id did. */
    | { status: 'starting'; queued: SessionFinish | null }
    | { status: 'active'; id: string };

export type RecorderEffect =
    | { type: 'NONE' }
    | { type: 'COMPLETE'; id: string; elapsedSeconds: number }
    | { type: 'CANCEL'; id: string };

export interface RecorderResult {
    state: RecorderState;
    effect: RecorderEffect;
}

export const idleRecorder: RecorderState = { status: 'idle' };

/** The id of the row currently being recorded into, or null while none exists yet. */
export function recordedSessionId(state: RecorderState): string | null {
    return state.status === 'active' ? state.id : null;
}

function effectFor(finish: SessionFinish, id: string): RecorderEffect {
    return finish.type === 'complete'
        ? { type: 'COMPLETE', id, elapsedSeconds: finish.elapsedSeconds }
        : { type: 'CANCEL', id };
}

/** A start request went out. */
export function recorderStarting(): RecorderState {
    return { status: 'starting', queued: null };
}

/** The row exists. Runs whatever finish arrived while the start was in flight. */
export function recorderStarted(state: RecorderState, id: string): RecorderResult {
    const queued = state.status === 'starting' ? state.queued : null;

    if (!queued) {
        return { state: { status: 'active', id }, effect: { type: 'NONE' } };
    }

    return { state: idleRecorder, effect: effectFor(queued, id) };
}

/** The row was never created, so a queued finish has nothing to write to. */
export function recorderStartFailed(): RecorderResult {
    return { state: idleRecorder, effect: { type: 'NONE' } };
}

export function recorderFinish(state: RecorderState, finish: SessionFinish): RecorderResult {
    switch (state.status) {
        case 'starting':
            // A second finish before the id lands can only mean the block ended again after
            // an early stop, so the latest one is the truth.
            return { state: { status: 'starting', queued: finish }, effect: { type: 'NONE' } };
        case 'active':
            return { state: idleRecorder, effect: effectFor(finish, state.id) };
        default:
            return { state, effect: { type: 'NONE' } };
    }
}
