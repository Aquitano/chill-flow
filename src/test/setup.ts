import { beforeEach, vi } from 'vitest';

class FakeGainNode {
    gain = { value: 1, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() };
    connect = vi.fn();
}

class FakeAudioContext {
    state: 'running' | 'suspended' = 'running';
    currentTime = 0;
    destination = {};
    createGain() { return new FakeGainNode() as unknown as GainNode; }
    createMediaElementSource(_: HTMLAudioElement) { return { connect: vi.fn() } as unknown as MediaElementAudioSourceNode; }
    resume = vi.fn(async () => { this.state = 'running'; });
}

class FakeBuffered {
    constructor(private ranges: Array<[number, number]>) { }
    get length() { return this.ranges.length; }
    start(i: number) { return this.ranges[i]?.[0] ?? 0; }
    end(i: number) { return this.ranges[i]?.[1] ?? 0; }
}

class FakeAudioElement extends EventTarget implements Partial<HTMLAudioElement> {
    src = '';
    currentTime = 0;
    duration = 60;
    loop = false;
    paused = true;
    ended = false;
    muted = false;
    volume = 1;
    preload: 'none' | 'metadata' | 'auto' = 'none';
    crossOrigin: string | null = null;
    playbackRate = 1;
    error = null;
    readyState = 0;
    buffered = new FakeBuffered([[0, 30]]);
    load = vi.fn(() => {
        this.readyState = (HTMLMediaElement).HAVE_FUTURE_DATA ?? 3;
        this.dispatchEvent(new Event('loadeddata'));
        this.dispatchEvent(new Event('canplay'));
        this.dispatchEvent(new Event('loadedmetadata'));
    });
    play = vi.fn(async () => {
        this.paused = false;
        this.dispatchEvent(new Event('play'));
    });
    pause = vi.fn(() => {
        this.paused = true;
        this.dispatchEvent(new Event('pause'));
    });
}

beforeEach(() => {
    const g = globalThis as unknown as Record<string, unknown> & { window: { AudioContext: typeof FakeAudioContext } };
    g.window = g.window || {};

    const storage: Record<string, string> = {};
    g.localStorage = {
        get length() { return Object.keys(storage).length; },
        clear() { Object.keys(storage).forEach((k) => delete storage[k]); },
        getItem(key: string) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null; },
        key(index: number) { return Object.keys(storage)[index] ?? null; },
        removeItem(key: string) { delete storage[key]; },
        setItem: vi.fn((key: string, value: string) => { storage[key] = value; }),
    } as Storage;

    g.window.AudioContext = FakeAudioContext;
    g.AudioContext = FakeAudioContext;
    g.webkitAudioContext = undefined;
    g.Audio = FakeAudioElement;
    g.HTMLMediaElement = {
        HAVE_NOTHING: 0,
        HAVE_METADATA: 1,
        HAVE_CURRENT_DATA: 2,
        HAVE_FUTURE_DATA: 3,
        HAVE_ENOUGH_DATA: 4,
        NETWORK_EMPTY: 0,
        NETWORK_IDLE: 1,
        NETWORK_LOADING: 2,
        NETWORK_NO_SOURCE: 3,
    };
});
