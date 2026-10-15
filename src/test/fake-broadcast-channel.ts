/** In-memory BroadcastChannel: jsdom has none, and cross-tab tests need a real bus. */
export class TestBroadcastChannel {
    static buses = new Map<string, Set<TestBroadcastChannel>>();
    onmessage: ((event: { data: unknown }) => void) | null = null;

    constructor(readonly name: string) {
        const peers = TestBroadcastChannel.buses.get(name) ?? new Set();
        peers.add(this);
        TestBroadcastChannel.buses.set(name, peers);
    }

    postMessage(data: unknown) {
        // Delivered on the microtask queue like the real API, never inline — so a test
        // that forgets to flush fails instead of passing on ordering a browser won't give.
        for (const peer of TestBroadcastChannel.buses.get(this.name) ?? []) {
            if (peer !== this) queueMicrotask(() => peer.onmessage?.({ data }));
        }
    }

    close() {
        TestBroadcastChannel.buses.get(this.name)?.delete(this);
    }
}
