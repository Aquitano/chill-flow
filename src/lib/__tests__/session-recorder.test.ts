import { describe, expect, it } from 'vitest';
import {
    idleRecorder,
    recordedSessionId,
    recorderFinish,
    recorderStartFailed,
    recorderStarted,
    recorderStarting,
} from '../session-recorder';

const SESSION_ID = 'b6d1f0a2-0000-4000-8000-000000000001';

describe('sessionRecorder', () => {
    it('runs a finish immediately once the row id is known', () => {
        const started = recorderStarted(recorderStarting(), SESSION_ID);
        expect(started.effect).toEqual({ type: 'NONE' });
        expect(recordedSessionId(started.state)).toBe(SESSION_ID);

        const finished = recorderFinish(started.state, { type: 'complete', elapsedSeconds: 1500 });
        expect(finished.effect).toEqual({ type: 'COMPLETE', id: SESSION_ID, elapsedSeconds: 1500 });
        expect(finished.state).toEqual(idleRecorder);
    });

    it('holds a finish that arrives while the start is still in flight, then replays it', () => {
        const queued = recorderFinish(recorderStarting(), { type: 'complete', elapsedSeconds: 90 });
        expect(queued.effect).toEqual({ type: 'NONE' });

        const settled = recorderStarted(queued.state, SESSION_ID);
        expect(settled.effect).toEqual({ type: 'COMPLETE', id: SESSION_ID, elapsedSeconds: 90 });
        expect(settled.state).toEqual(idleRecorder);
    });

    it('replays a queued cancel the same way', () => {
        const queued = recorderFinish(recorderStarting(), { type: 'cancel' });
        const settled = recorderStarted(queued.state, SESSION_ID);

        expect(settled.effect).toEqual({ type: 'CANCEL', id: SESSION_ID });
    });

    it('keeps the latest finish when several land before the id does', () => {
        let state = recorderStarting();
        state = recorderFinish(state, { type: 'complete', elapsedSeconds: 90 }).state;
        state = recorderFinish(state, { type: 'cancel' }).state;

        expect(recorderStarted(state, SESSION_ID).effect).toEqual({ type: 'CANCEL', id: SESSION_ID });
    });

    it('drops a queued finish when the start never produced a row', () => {
        const queued = recorderFinish(recorderStarting(), { type: 'complete', elapsedSeconds: 900 });
        expect(queued.state).toEqual({ status: 'starting', queued: { type: 'complete', elapsedSeconds: 900 } });

        const failed = recorderStartFailed();

        expect(failed.effect).toEqual({ type: 'NONE' });
        expect(failed.state).toEqual(idleRecorder);
    });

    it('does nothing when a finish arrives with no block in flight', () => {
        const result = recorderFinish(idleRecorder, { type: 'complete', elapsedSeconds: 600 });

        expect(result.effect).toEqual({ type: 'NONE' });
        expect(result.state).toEqual(idleRecorder);
    });

    it('has no recorded id until the row exists', () => {
        expect(recordedSessionId(idleRecorder)).toBeNull();
        expect(recordedSessionId(recorderStarting())).toBeNull();
    });
});
