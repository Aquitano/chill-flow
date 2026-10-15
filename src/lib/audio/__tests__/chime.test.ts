import { afterEach, describe, expect, it, vi } from 'vitest';

const fakeContext = {
    currentTime: 100,
    state: 'running',
    destination: {},
    resume: vi.fn(),
    createOscillator: vi.fn(),
    createGain: vi.fn(),
};

vi.mock('../engine', () => ({
    getAudioEngine: () => ({ getAudioContext: () => fakeContext }),
}));

import { scheduleTimerChime } from '../chime';

function makeOscillator() {
    return {
        type: '',
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
    };
}

function makeGain() {
    return {
        gain: {
            setValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
    };
}

function armFakeNodes() {
    const oscillators = [makeOscillator(), makeOscillator()];
    let next = 0;
    fakeContext.createOscillator.mockImplementation(() => oscillators[next++]);
    fakeContext.createGain.mockImplementation(makeGain);
    return oscillators;
}

describe('scheduleTimerChime', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        fakeContext.currentTime = 100;
    });

    it('places both tones on the audio timeline at the deadline', () => {
        const oscillators = armFakeNodes();

        const chime = scheduleTimerChime('complete', 60);

        expect(chime).not.toBeNull();
        expect(oscillators[0]!.start).toHaveBeenCalledWith(160);
        expect(oscillators[1]!.start).toHaveBeenCalledWith(160.45);
    });

    it('cancels a chime whose start time has not been reached', () => {
        const oscillators = armFakeNodes();
        const chime = scheduleTimerChime('complete', 60)!;

        expect(chime.hasSounded()).toBe(false);
        chime.cancelIfPending();

        // stop(at) from scheduling plus the immediate stop() from the cancel.
        expect(oscillators[0]!.stop).toHaveBeenCalledTimes(2);
        expect(oscillators[0]!.disconnect).toHaveBeenCalled();
    });

    it('leaves a chime alone once the audio clock has passed its start', () => {
        const oscillators = armFakeNodes();
        const chime = scheduleTimerChime('complete', 60)!;

        fakeContext.currentTime = 161;

        expect(chime.hasSounded()).toBe(true);
        chime.cancelIfPending();

        expect(oscillators[0]!.stop).toHaveBeenCalledTimes(1);
        expect(oscillators[0]!.disconnect).not.toHaveBeenCalled();
    });
});
