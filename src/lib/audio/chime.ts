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

function readAudioContext(): AudioContext | null {
    try {
        return getAudioEngine().getAudioContext();
    } catch {
        return null;
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
        const startAt = context.currentTime + 0.02;
        TONES[kind].forEach((frequency, index) => {
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
        });
        return true;
    } catch {
        // A failed cue must never take the timer down with it.
        return false;
    }
}
