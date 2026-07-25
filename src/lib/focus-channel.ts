'use client';

/**
 * Cross-tab handover for focus blocks.
 *
 * The server keeps one active session per user, so a second tab starting a block cancels the
 * first tab's row — while that first tab keeps its own clock running and banks the
 * overlapping minutes a second time. Announcing a start lets the other tabs stand down at
 * the moment it happens, which is also the honest reading of the feature: focus is one thing
 * at a time. The server-side clamp in completeSession stays the backstop for tabs that never
 * hear the announcement.
 *
 * BroadcastChannel never echoes to the sender, so a tab never hears itself.
 */

const CHANNEL_NAME = 'chillflow:focus';
const FOCUS_STARTED = 'focus-started';

export interface FocusChannel {
    announceStart: () => void;
    close: () => void;
}

export function openFocusChannel(onRemoteStart: () => void): FocusChannel {
    if (typeof BroadcastChannel === 'undefined') {
        return { announceStart: () => {}, close: () => {} };
    }

    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event: MessageEvent<unknown>) => {
        if (event.data === FOCUS_STARTED) onRemoteStart();
    };

    return {
        announceStart: () => channel.postMessage(FOCUS_STARTED),
        close: () => channel.close(),
    };
}
