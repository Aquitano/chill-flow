import { afterEach, describe, expect, it, vi } from 'vitest';
import { askSessionOwner, openFocusChannel } from '../focus-channel';

const SESSION_ID = 'b6d1f0a2-0000-4000-8000-000000000001';
const OTHER_SESSION_ID = 'b6d1f0a2-0000-4000-8000-000000000002';

const openChannels: Array<{ close: () => void }> = [];

function openTab(ownedSessionId: string | null, onRemoteStart = vi.fn()) {
    const channel = openFocusChannel({
        onRemoteStart,
        ownsSession: (sessionId) => sessionId === ownedSessionId,
    });
    openChannels.push(channel);
    return { channel, onRemoteStart };
}

afterEach(() => {
    openChannels.splice(0).forEach((channel) => channel.close());
});

describe('focusChannel', () => {
    it('tells the other tabs a block has started', async () => {
        const listener = openTab(null);
        openTab(null).channel.announceStart();

        await vi.waitFor(() => expect(listener.onRemoteStart).toHaveBeenCalledTimes(1));
    });

    it('reports a session another tab is still recording into as owned', async () => {
        openTab(SESSION_ID);

        await expect(askSessionOwner(SESSION_ID)).resolves.toBe(true);
    });

    it('reports a session no tab answers for as unowned, which is the crash case', async () => {
        openTab(OTHER_SESSION_ID);

        await expect(askSessionOwner(SESSION_ID)).resolves.toBe(false);
    });

    it('reports every session as unowned where BroadcastChannel is missing', async () => {
        vi.stubGlobal('BroadcastChannel', undefined);

        try {
            await expect(askSessionOwner(SESSION_ID)).resolves.toBe(false);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
