'use client';

import { getAudioEngine } from './engine';

/*
 * Ambient layers are synthesized live with Web Audio (filtered noise + LFOs),
 * myNoise-style: no audio files, no network, seamless forever. Each layer is a
 * small node graph feeding a per-layer gain into a shared ambient master gain.
 */

export type AmbientLayerId = 'rain' | 'wind' | 'embers' | 'deep';

export type AmbientLayerState = {
    enabled: boolean;
    /** Normalized 0..1 control value (perceptual curve applied at the gain node). */
    volume: number;
};

export type AmbientState = Record<AmbientLayerId, AmbientLayerState>;

export const AMBIENT_LAYERS: { id: AmbientLayerId; label: string; hint: string }[] = [
    { id: 'rain', label: 'Rain', hint: 'Steady rainfall' },
    { id: 'wind', label: 'Wind', hint: 'Slow moving air' },
    { id: 'embers', label: 'Embers', hint: 'Fire crackle' },
    { id: 'deep', label: 'Deep', hint: 'Low rumble' },
];

const STORAGE_KEY = 'audio.ambientLayers';
const DEFAULT_VOLUME = 0.5;

function perceptual(v01: number): number {
    const v = Math.max(0, Math.min(1, v01));
    return v * v;
}

type NoiseColor = 'white' | 'pink' | 'brown';

/**
 * 4s looping noise buffer. The tail is crossfaded into the head so the loop
 * seam is inaudible — critical for brown noise, whose random-walk value at the
 * end never matches the start and would otherwise thump every cycle.
 */
function createNoiseBuffer(ctx: AudioContext, color: NoiseColor): AudioBuffer {
    const seconds = 4;
    const rate = ctx.sampleRate;
    const length = rate * seconds;
    const buffer = ctx.createBuffer(2, length, rate);

    for (let channel = 0; channel < 2; channel += 1) {
        const data = buffer.getChannelData(channel);

        if (color === 'white') {
            for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
        } else if (color === 'pink') {
            // Paul Kellet's economy pink noise approximation.
            let b0 = 0;
            let b1 = 0;
            let b2 = 0;
            for (let i = 0; i < length; i += 1) {
                const white = Math.random() * 2 - 1;
                b0 = 0.99765 * b0 + white * 0.099046;
                b1 = 0.963 * b1 + white * 0.2965164;
                b2 = 0.57 * b2 + white * 1.0526913;
                data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.22;
            }
        } else {
            // Brown noise via leaky integration of white noise.
            let last = 0;
            for (let i = 0; i < length; i += 1) {
                const white = Math.random() * 2 - 1;
                last = (last + 0.02 * white) / 1.02;
                data[i] = last * 3.5;
            }
        }

        const fade = Math.floor(rate * 0.25);
        for (let i = 0; i < fade; i += 1) {
            const t = i / fade;
            const j = length - fade + i;
            data[j] = data[j]! * (1 - t) + data[i]! * t;
        }
    }

    return buffer;
}

function startLoop(ctx: AudioContext, buffer: AudioBuffer): AudioBufferSourceNode {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.start();
    return source;
}

function lfo(ctx: AudioContext, frequency: number, depth: number, target: AudioParam): OscillatorNode {
    const osc = ctx.createOscillator();
    osc.frequency.value = frequency;
    const amount = ctx.createGain();
    amount.gain.value = depth;
    osc.connect(amount);
    amount.connect(target);
    osc.start();
    return osc;
}

type LayerNodes = {
    /** Post-synthesis gain the mixer ramps for volume/fade in-out. */
    gain: GainNode;
    stop: () => void;
};

function buildRain(ctx: AudioContext, out: GainNode): LayerNodes {
    const source = startLoop(ctx, createNoiseBuffer(ctx, 'pink'));
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 320;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 1900;
    const body = ctx.createGain();
    body.gain.value = 0.5;
    // Slow amplitude drift so the rainfall doesn't read as a frozen hiss.
    const drift = lfo(ctx, 0.09, 0.06, body.gain);

    source.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(body);
    body.connect(out);

    return {
        gain: out,
        stop: () => {
            source.stop();
            drift.stop();
            body.disconnect();
        },
    };
}

function buildWind(ctx: AudioContext, out: GainNode): LayerNodes {
    const source = startLoop(ctx, createNoiseBuffer(ctx, 'brown'));
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 260;
    bandpass.Q.value = 0.9;
    const body = ctx.createGain();
    body.gain.value = 0.75;
    // Two incommensurate LFO rates keep the gusts from sounding periodic.
    const sweep = lfo(ctx, 0.05, 110, bandpass.frequency);
    const gust = lfo(ctx, 0.13, 0.18, body.gain);

    source.connect(bandpass);
    bandpass.connect(body);
    body.connect(out);

    return {
        gain: out,
        stop: () => {
            source.stop();
            sweep.stop();
            gust.stop();
            body.disconnect();
        },
    };
}

function buildEmbers(ctx: AudioContext, out: GainNode): LayerNodes {
    // Low "roar" bed.
    const bed = startLoop(ctx, createNoiseBuffer(ctx, 'brown'));
    const bedFilter = ctx.createBiquadFilter();
    bedFilter.type = 'lowpass';
    bedFilter.frequency.value = 300;
    const bedGain = ctx.createGain();
    bedGain.gain.value = 0.45;
    bed.connect(bedFilter);
    bedFilter.connect(bedGain);
    bedGain.connect(out);

    // Crackle: bright noise gated by short randomly-timed envelopes.
    const crackleSource = startLoop(ctx, createNoiseBuffer(ctx, 'white'));
    const crackleFilter = ctx.createBiquadFilter();
    crackleFilter.type = 'highpass';
    crackleFilter.frequency.value = 2400;
    const crackleGain = ctx.createGain();
    crackleGain.gain.value = 0;
    crackleSource.connect(crackleFilter);
    crackleFilter.connect(crackleGain);
    crackleGain.connect(out);

    let timeout: ReturnType<typeof setTimeout> | null = null;
    const scheduleCrackle = () => {
        const now = ctx.currentTime;
        const strength = 0.08 + Math.random() * 0.3;
        crackleGain.gain.cancelScheduledValues(now);
        crackleGain.gain.setValueAtTime(strength, now);
        crackleGain.gain.setTargetAtTime(0, now + 0.004, 0.014);
        timeout = setTimeout(scheduleCrackle, 70 + Math.random() * 420);
    };
    scheduleCrackle();

    return {
        gain: out,
        stop: () => {
            if (timeout) clearTimeout(timeout);
            bed.stop();
            crackleSource.stop();
            bedGain.disconnect();
            crackleGain.disconnect();
        },
    };
}

function buildDeep(ctx: AudioContext, out: GainNode): LayerNodes {
    const source = startLoop(ctx, createNoiseBuffer(ctx, 'brown'));
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 210;
    const body = ctx.createGain();
    body.gain.value = 0.7;

    source.connect(lowpass);
    lowpass.connect(body);
    body.connect(out);

    return {
        gain: out,
        stop: () => {
            source.stop();
            body.disconnect();
        },
    };
}

const BUILDERS: Record<AmbientLayerId, (ctx: AudioContext, out: GainNode) => LayerNodes> = {
    rain: buildRain,
    wind: buildWind,
    embers: buildEmbers,
    deep: buildDeep,
};

function defaultState(): AmbientState {
    const state = {} as AmbientState;
    for (const layer of AMBIENT_LAYERS) {
        state[layer.id] = { enabled: false, volume: DEFAULT_VOLUME };
    }
    return state;
}

class AmbientMixer {
    private state: AmbientState = defaultState();
    private nodes = new Map<AmbientLayerId, LayerNodes>();
    private masterGain: GainNode | null = null;
    private muted = false;
    private eventTarget = new EventTarget();

    constructor() {
        // Only volumes are restored — layers always start disabled so the UI
        // never claims sound the browser won't produce without a gesture.
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved) as Partial<Record<AmbientLayerId, { volume?: number }>>;
                for (const layer of AMBIENT_LAYERS) {
                    const volume = parsed[layer.id]?.volume;
                    if (typeof volume === 'number' && Number.isFinite(volume)) {
                        this.state[layer.id].volume = Math.max(0, Math.min(1, volume));
                    }
                }
            }
        } catch {
            /* ignore corrupt storage */
        }
    }

    getState(): AmbientState {
        const copy = {} as AmbientState;
        for (const layer of AMBIENT_LAYERS) {
            copy[layer.id] = { ...this.state[layer.id] };
        }
        return copy;
    }

    activeCount(): number {
        return AMBIENT_LAYERS.filter((layer) => this.state[layer.id].enabled).length;
    }

    toggleLayer(id: AmbientLayerId): void {
        this.setLayer(id, { enabled: !this.state[id].enabled });
    }

    setLayer(id: AmbientLayerId, patch: Partial<AmbientLayerState>): void {
        const next = { ...this.state[id], ...patch };
        const wasEnabled = this.state[id].enabled;
        this.state[id] = next;

        if (next.enabled && !wasEnabled) {
            this.startLayer(id);
        } else if (!next.enabled && wasEnabled) {
            this.stopLayer(id);
        } else if (next.enabled && patch.volume !== undefined) {
            const nodes = this.nodes.get(id);
            const ctx = this.context();
            if (nodes && ctx) {
                nodes.gain.gain.setTargetAtTime(perceptual(next.volume), ctx.currentTime, 0.05);
            }
        }

        this.persist();
        this.dispatchChange();
    }

    /** Follows the player's mute so "mute" silences the whole room, not just the music. */
    setMuted(muted: boolean): void {
        if (this.muted === muted) return;
        this.muted = muted;
        const ctx = this.context();
        if (this.masterGain && ctx) {
            this.masterGain.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05);
        }
    }

    stopAll(): void {
        for (const layer of AMBIENT_LAYERS) {
            if (this.state[layer.id].enabled) {
                this.setLayer(layer.id, { enabled: false });
            }
        }
    }

    addEventListener(type: 'change', listener: () => void): void {
        this.eventTarget.addEventListener(type, listener);
    }

    removeEventListener(type: 'change', listener: () => void): void {
        this.eventTarget.removeEventListener(type, listener);
    }

    private context(): AudioContext | null {
        try {
            return getAudioEngine().getAudioContext();
        } catch {
            return null;
        }
    }

    private ensureMaster(ctx: AudioContext): GainNode {
        if (this.masterGain) return this.masterGain;
        this.masterGain = ctx.createGain();
        this.masterGain.gain.value = this.muted ? 0 : 1;
        this.masterGain.connect(ctx.destination);
        return this.masterGain;
    }

    private startLayer(id: AmbientLayerId): void {
        const ctx = this.context();
        if (!ctx) {
            this.state[id] = { ...this.state[id], enabled: false };
            return;
        }
        if (ctx.state === 'suspended') {
            // Called from a user gesture (toggle click), so resume is permitted.
            void ctx.resume();
        }

        this.stopLayer(id);

        const master = this.ensureMaster(ctx);
        const layerGain = ctx.createGain();
        layerGain.gain.value = 0;
        layerGain.connect(master);
        const nodes = BUILDERS[id](ctx, layerGain);
        this.nodes.set(id, nodes);
        // Fade in so a toggle never clicks.
        layerGain.gain.setTargetAtTime(perceptual(this.state[id].volume), ctx.currentTime, 0.12);
    }

    private stopLayer(id: AmbientLayerId): void {
        const nodes = this.nodes.get(id);
        if (!nodes) return;
        this.nodes.delete(id);
        const ctx = this.context();
        if (ctx) {
            nodes.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
            setTimeout(() => {
                try {
                    nodes.stop();
                    nodes.gain.disconnect();
                } catch {
                    /* nodes may already be gone */
                }
            }, 400);
        } else {
            try {
                nodes.stop();
            } catch {
                /* ignore */
            }
        }
    }

    private persist(): void {
        try {
            const payload = {} as Record<AmbientLayerId, { volume: number }>;
            for (const layer of AMBIENT_LAYERS) {
                payload[layer.id] = { volume: this.state[layer.id].volume };
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch {
            /* storage unavailable */
        }
    }

    private dispatchChange(): void {
        this.eventTarget.dispatchEvent(new Event('change'));
    }
}

let singleton: AmbientMixer | null = null;

export function getAmbientMixer(): AmbientMixer {
    if (!singleton) singleton = new AmbientMixer();
    return singleton;
}

export type { AmbientMixer };
