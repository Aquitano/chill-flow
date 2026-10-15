'use client';

import { getAudioEngine } from './engine';

/**
 * A short synthesized tone pair marking a timer boundary. Notifications need permission
 * the user may never grant, and a background tab shows nothing at all — the chime is the
 * one cue that always lands. It is synthesized through the shared AudioContext rather
 * than shipped as an asset, so it costs no network and no autoplay negotiation.
 *
 * Deliberately independent of the music volume and mute: this is an alert, not a layer of
 * the mix. Users who don't want it turn off the timer-sound preference.
 */
const CHIME_GAIN = 0.16;
const TONE_SECONDS = 0.9;

/** Warm intervals — a settling fall to close a block, a lift to open one. */
const TONES: Record<ChimeKind, [number, number]> = {
    complete: [660, 440],
    resume: [440, 660],
};

export type ChimeKind = 'complete' | 'resume';

/** A chime placed on the audio timeline ahead of time; see scheduleTimerChime. */
export interface ScheduledChime {
    /**
     * Whether the chime's start time has passed on the audio clock — it sounded, or is
     * sounding. A context suspended since scheduling never advances its clock, so an
     * inaudible chime correctly reads as not having sounded.
     */
    hasSounded: () => boolean;
    /** Silence the chime if it hasn't started yet; one already sounding is left alone. */
    cancelIfPending: () => void;
}

function readAudioContext(): AudioContext | null {
    try {
        return getAudioEngine().getAudioContext();
    } catch {
        return null;
    }
}

interface ToneNodes {
    oscillator: OscillatorNode;
    gain: GainNode;
}

function scheduleTones(context: AudioContext, kind: ChimeKind, startAt: number): ToneNodes[] {
    return TONES[kind].map((frequency, index) => {
        const at = startAt + index * (TONE_SECONDS / 2);
        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, at);
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(CHIME_GAIN, at + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + TONE_SECONDS);

        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(at);
        oscillator.stop(at + TONE_SECONDS);

        return { oscillator, gain };
    });
}

/**
 * Create and resume the shared context. Call inside the user gesture that starts a
 * timer: a context unlocked here keeps its clock running while the tab is hidden, so a
 * chime scheduled later actually renders at its boundary.
 */
export function unlockTimerChime(): void {
    const context = readAudioContext();
    if (context?.state === 'suspended') {
        void context.resume().catch(() => undefined);
    }
}

export function playTimerChime(kind: ChimeKind): boolean {
    const context = readAudioContext();
    if (!context) {
        return false;
    }

    // The timer was started by a click, so the context is unlocked by now; resuming is
    // only for the case where the browser suspended it while the tab sat in the background.
    if (context.state === 'suspended') {
        void context.resume().catch(() => undefined);
    }

    try {
        scheduleTones(context, kind, context.currentTime + 0.02);
        return true;
    } catch {
        // A failed cue must never take the timer down with it.
        return false;
    }
}

/**
 * Place a chime on the AudioContext timeline `delaySeconds` from now. The audio thread
 * keeps rendering while the browser throttles hidden-tab JS (Chrome drops timers to once
 * a minute after five minutes), so a chime scheduled when a countdown starts rings at
 * the boundary even when no timer callback gets to run there. Null when there is no
 * context to schedule into.
 */
export function scheduleTimerChime(kind: ChimeKind, delaySeconds: number): ScheduledChime | null {
    const context = readAudioContext();
    if (!context) {
        return null;
    }

    if (context.state === 'suspended') {
        void context.resume().catch(() => undefined);
    }

    const startAt = context.currentTime + Math.max(0, delaySeconds);
    let nodes: ToneNodes[];
    try {
        nodes = scheduleTones(context, kind, startAt);
    } catch {
        return null;
    }

    return {
        hasSounded: () => context.currentTime >= startAt,
        cancelIfPending: () => {
            if (context.currentTime >= startAt) {
                return;
            }
            for (const { oscillator, gain } of nodes) {
                try {
                    oscillator.stop();
                    oscillator.disconnect();
                    gain.disconnect();
                } catch {
                    // A cancel that fails only risks a duplicate ring; never let it throw.
                }
            }
        },
    };
}
