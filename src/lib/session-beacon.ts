'use client';

import type { RecorderEffect } from './session-recorder';

/**
 * Send a finished block over a transport that survives unload.
 *
 * A React Query mutation is an ordinary fetch, and the browser is free to abandon it while
 * the page is going away — which is exactly when the longest blocks tend to end. `keepalive`
 * is the transport it promises to finish, at the cost of a plain-JSON body, hence the
 * dedicated route.
 */
export function flushSessionBeacon(effect: RecorderEffect): void {
    if (effect.type === 'NONE') return;

    const body =
        effect.type === 'COMPLETE'
            ? { outcome: 'completed', id: effect.id, elapsedSeconds: effect.elapsedSeconds }
            : { outcome: 'canceled', id: effect.id };

    void fetch('/api/sessions/flush', {
        method: 'POST',
        keepalive: true,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }).catch(() => {
        // The page is going away; there is nobody left to tell. Session recovery on the
        // next load settles anything this failed to write.
    });
}
