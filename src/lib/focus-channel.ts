'use client';

/**
 * Cross-tab coordination for focus blocks.
 *
 * The server keeps one active session per user, so a second tab starting a block cancels the
 * first tab's row — while that first tab keeps its own clock running and banks the
 * overlapping minutes a second time. Announcing a start lets the other tabs stand down at
 * the moment it happens, which is also the honest reading of the feature: focus is one thing
 * at a time. The server-side clamp in completeSession stays the backstop for tabs that never
 * hear the announcement.
 *
 * The same channel answers who owns a session row, so a tab restoring the timer snapshot can
 * tell a block this device abandoned from one another tab is still filling.
 *
 * BroadcastChannel never echoes to the sender, so a tab never hears itself.
 */

const CHANNEL_NAME = 'chillflow:focus';

/**
 * How long to wait for a tab to claim a session before treating it as unowned. Long enough
 * for a hidden tab to answer — message delivery is not throttled the way its timers are —
 * and short enough to be invisible against the workspace's own load.
 */
const OWNER_REPLY_TIMEOUT_MS = 300;

type FocusMessage =
    | { type: 'focus-started' }
    | { type: 'owner-query'; sessionId: string }
    | { type: 'owner-claim'; sessionId: string };

function focusMessageOf(data: unknown): FocusMessage | null {
    if (!data || typeof data !== 'object') return null;

    const candidate = data as { type?: unknown; sessionId?: unknown };
    if (candidate.type === 'focus-started') {
        return { type: 'focus-started' };
    }
    if (
        (candidate.type === 'owner-query' || candidate.type === 'owner-claim') &&
        typeof candidate.sessionId === 'string'
    ) {
        return { type: candidate.type, sessionId: candidate.sessionId };
    }

    return null;
}

export interface FocusChannel {
    announceStart: () => void;
    close: () => void;
}

export interface FocusChannelHandlers {
    /** Another tab has taken the focus block over. */
    onRemoteStart: () => void;
    /** Whether this tab is still recording into that session row. */
    ownsSession: (sessionId: string) => boolean;
}

export function openFocusChannel({ onRemoteStart, ownsSession }: FocusChannelHandlers): FocusChannel {
    if (typeof BroadcastChannel === 'undefined') {
        return { announceStart: () => {}, close: () => {} };
    }

    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event: MessageEvent<unknown>) => {
        const message = focusMessageOf(event.data);
        if (!message) return;

        if (message.type === 'focus-started') {
            onRemoteStart();
            return;
        }
        if (message.type === 'owner-query' && ownsSession(message.sessionId)) {
            channel.postMessage({ type: 'owner-claim', sessionId: message.sessionId } satisfies FocusMessage);
        }
    };

    return {
        announceStart: () => channel.postMessage({ type: 'focus-started' } satisfies FocusMessage),
        close: () => channel.close(),
    };
}

/**
 * Whether another tab is still recording into `sessionId`.
 *
 * The timer snapshot lives in localStorage, which every tab shares, so opening a second tab
 * hands it a snapshot naming the row the first tab is still filling. Recovering that row
 * would complete it out from under a block that is still running, so ask before settling
 * anything. Silence is the crash this recovery exists for: no tab is left to answer.
 */
export function askSessionOwner(sessionId: string, timeoutMs: number = OWNER_REPLY_TIMEOUT_MS): Promise<boolean> {
    if (typeof BroadcastChannel === 'undefined') {
        return Promise.resolve(false);
    }

    return new Promise((resolve) => {
        const channel = new BroadcastChannel(CHANNEL_NAME);
        let timer: ReturnType<typeof setTimeout>;

        const settle = (owned: boolean) => {
            clearTimeout(timer);
            channel.close();
            resolve(owned);
        };

        channel.onmessage = (event: MessageEvent<unknown>) => {
            const message = focusMessageOf(event.data);
            if (message?.type === 'owner-claim' && message.sessionId === sessionId) {
                settle(true);
            }
        };

        timer = setTimeout(() => settle(false), timeoutMs);
        channel.postMessage({ type: 'owner-query', sessionId } satisfies FocusMessage);
    });
}
