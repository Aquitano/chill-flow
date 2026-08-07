import { afterEach, describe, expect, it, vi } from 'vitest';
import { equalPowerCurves, getAudioEngine } from '../engine';

/**
 * The fake media element resolves its readiness through a zero-delay timer, so a load only
 * settles once the clock is advanced.
 */
async function loadTrack(engine: ReturnType<typeof getAudioEngine>, url: string): Promise<void> {
    const loading = engine.loadMainTrack(url);
    await vi.advanceTimersByTimeAsync(1);
    return loading;
}

/** The fade curve the engine last scheduled against one deck's gain. */
function scheduledCurve(engine: ReturnType<typeof getAudioEngine>, deckIndex: number): Float32Array {
    const { decks } = engine as unknown as { decks: Array<{ gainNode: GainNode }> };
    const scheduled = decks[deckIndex]!.gainNode.gain.setValueCurveAtTime as unknown as ReturnType<typeof vi.fn>;
    return scheduled.mock.lastCall![0] as Float32Array;
}

describe('AudioEngine', () => {
    // The engine is a module singleton, so the active lane, decks, and play state would
    // otherwise carry into the next test and make these assertions order-dependent.
    afterEach(() => getAudioEngine().destroy());

    it('initializes and exposes engine methods', async () => {
        const engine = getAudioEngine();
        await engine.init();
        expect(engine.getMasterVolume()).toBeGreaterThanOrEqual(0);
        expect(engine.getMasterVolume()).toBeLessThanOrEqual(1);
        expect(engine.hasMainTrack()).toBe(false);
    });

    it('loads a track and updates hasMainTrack', async () => {
        const engine = getAudioEngine();
        await engine.init();
        await engine.loadMainTrack('https://example.com/audio.webm');
        expect(engine.hasMainTrack()).toBe(true);
    });

    it('plays and pauses without throwing', async () => {
        const engine = getAudioEngine();
        await engine.init();
        await engine.loadMainTrack('https://example.com/audio.webm');
        const states: boolean[] = [];
        engine.addEventListener('statechange', (e: CustomEvent<{ isPlaying: boolean }>) => { states.push(e.detail!.isPlaying); });
        await expect(engine.play()).resolves.toBeUndefined();
        expect(states.length).toBeGreaterThan(0);
        expect(states[states.length - 1]!).toBe(true);
        engine.pause();
        expect(states.length).toBeGreaterThan(0);
        expect(states[states.length - 1]!).toBe(false);
    });

    it('sets and persists volume with perceptual mapping', async () => {
        const engine = getAudioEngine();
        await engine.init();
        engine.setMasterVolume(0.7);
        expect(engine.getMasterVolume()).toBeCloseTo(0.7, 3);
        // @ts-expect-error test shim injects vi-mock
        const calls = globalThis.localStorage.setItem.mock.calls;
        expect(calls[0]).toEqual(['audio.masterVolume', '0.7']);
    });

    it('mute/unmute toggles volumechange events', async () => {
        const engine = getAudioEngine();
        await engine.init();
        const volEvents: Array<{ volume: number; muted: boolean }> = [];
        engine.addEventListener('volumechange', (e: CustomEvent<{ volume: number; muted: boolean }>) => volEvents.push(e.detail!));
        engine.mute();
        engine.unmute();
        expect(volEvents.length).toBeGreaterThanOrEqual(2);
        expect(volEvents[0]!.muted).toBe(true);
        expect(volEvents[volEvents.length - 1]!.muted).toBe(false);
    });

    it('hands over to the incoming track instead of cutting to it', async () => {
        vi.useFakeTimers();
        try {
            const engine = getAudioEngine();
            await engine.init();
            await loadTrack(engine, 'https://example.com/first.webm');
            await engine.play();

            const beforeSwap = engine.getDebugState();
            await loadTrack(engine, 'https://example.com/second.webm');
            const duringFade = engine.getDebugState();

            // The incoming track takes the other lane and owns playback immediately, while
            // the outgoing one is still audible underneath it.
            expect(duringFade.activeDeckIndex).not.toBe(beforeSwap.activeDeckIndex);
            expect(duringFade.isCrossfading).toBe(true);
            expect(engine.hasMainTrack()).toBe(true);

            await vi.advanceTimersByTimeAsync(2000);
            expect(engine.getDebugState().isCrossfading).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('fades the incoming deck up while the outgoing one comes down', async () => {
        vi.useFakeTimers();
        try {
            const engine = getAudioEngine();
            await engine.init();
            await loadTrack(engine, 'https://example.com/first.webm');
            await engine.play();

            const outgoingIndex = engine.getDebugState().activeDeckIndex as number;
            await loadTrack(engine, 'https://example.com/second.webm');
            const incomingIndex = engine.getDebugState().activeDeckIndex as number;

            const fadeIn = scheduledCurve(engine, incomingIndex);
            const fadeOut = scheduledCurve(engine, outgoingIndex);
            expect(fadeIn[0]).toBeCloseTo(0, 6);
            expect(fadeIn[fadeIn.length - 1]).toBeCloseTo(1, 6);
            expect(fadeOut[0]).toBeCloseTo(1, 6);
            expect(fadeOut[fadeOut.length - 1]).toBeCloseTo(0, 6);
        } finally {
            vi.useRealTimers();
        }
    });

    it('cuts a fade short on pause, so the outgoing track stops with the player', async () => {
        vi.useFakeTimers();
        try {
            const engine = getAudioEngine();
            await engine.init();
            await loadTrack(engine, 'https://example.com/first.webm');
            await engine.play();
            await loadTrack(engine, 'https://example.com/second.webm');
            expect(engine.getDebugState().isCrossfading).toBe(true);

            engine.pause();
            expect(engine.getDebugState().isCrossfading).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('swaps without a fade when nothing is playing', async () => {
        vi.useFakeTimers();
        try {
            const engine = getAudioEngine();
            await engine.init();
            await loadTrack(engine, 'https://example.com/first.webm');
            await engine.play();
            engine.pause();

            const beforeSwap = engine.getDebugState();
            await loadTrack(engine, 'https://example.com/second.webm');
            const afterSwap = engine.getDebugState();

            // No seam to cover while paused, so the track loads into the lane already on air.
            expect(afterSwap.activeDeckIndex).toBe(beforeSwap.activeDeckIndex);
            expect(afterSwap.isCrossfading).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('time event includes currentTime, duration, bufferedPercent', async () => {
        const engine = getAudioEngine();
        await engine.init();
        await engine.loadMainTrack('https://example.com/audio.webm');
        const times: Array<{ currentTime: number; duration: number; bufferedPercent: number }> = [];
        engine.addEventListener('time', (e: CustomEvent<{ currentTime: number; duration: number; bufferedPercent: number }>) => times.push(e.detail!));
        // Ensure at least one dispatch occurs after listener registration
        (engine as unknown as { dispatchTime: () => void }).dispatchTime();
        expect(times.length).toBeGreaterThan(0);
        expect(times[0]!.duration).toBeGreaterThan(0);
        expect(times[0]!.bufferedPercent).toBeGreaterThanOrEqual(0);
        expect(times[0]!.bufferedPercent).toBeLessThanOrEqual(1);
    });
});

describe('equalPowerCurves', () => {
    it('runs a full swap from one track to the other', () => {
        const { fadeIn, fadeOut } = equalPowerCurves(64);
        expect(fadeIn[0]).toBeCloseTo(0, 6);
        expect(fadeIn[fadeIn.length - 1]).toBeCloseTo(1, 6);
        expect(fadeOut[0]).toBeCloseTo(1, 6);
        expect(fadeOut[fadeOut.length - 1]).toBeCloseTo(0, 6);
    });

    it('holds constant power throughout, which is what stops the midpoint sagging', () => {
        const { fadeIn, fadeOut } = equalPowerCurves(64);
        for (let index = 0; index < fadeIn.length; index += 1) {
            expect(fadeIn[index]! ** 2 + fadeOut[index]! ** 2).toBeCloseTo(1, 6);
        }
    });
});
