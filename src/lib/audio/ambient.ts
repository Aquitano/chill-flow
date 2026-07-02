'use client';

import { AmbientSound } from '@/models/app';
import { getAudioEngine } from './engine';

/*
 * The ambient mixer is a board of AMBIENT_SLOT_COUNT slots fed from the sound
 * library (ambient_sounds in the DB — it grows without client changes). Each
 * filled slot is a decoded AudioBuffer looping through a per-slot gain into a
 * shared ambient master gain. A single power flag gates all ambient audio; it
 * always starts off so nothing plays without a gesture, while the board layout
 * itself persists across sessions.
 */

export const AMBIENT_SLOT_COUNT = 8;

export type AmbientSlot = {
    soundId: string;
    /** Normalized 0..1 control value (perceptual curve applied at the gain node). */
    volume: number;
    muted: boolean;
    /** True while the slot's buffer is being fetched/decoded. */
    loading: boolean;
};

export type AmbientBoard = (AmbientSlot | null)[];

const BOARD_STORAGE_KEY = 'audio.ambientBoard';
const DEFAULT_VOLUME = 0.5;

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function perceptual(v01: number): number {
    const v = clamp01(v01);
    return v * v;
}

/**
 * Crossfade the buffer's tail into a copy of its head so the loop seam is
 * inaudible regardless of how the source file was cut.
 */
function makeSeamless(buffer: AudioBuffer): AudioBuffer {
    const fade = Math.min(Math.floor(buffer.sampleRate * 0.5), Math.floor(buffer.length / 4));
    if (fade < 2) return buffer;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < fade; i += 1) {
            const t = i / fade;
            const j = buffer.length - fade + i;
            data[j] = data[j]! * (1 - t) + data[i]! * t;
        }
    }
    return buffer;
}

type ChannelNodes = {
    source: AudioBufferSourceNode;
    gain: GainNode;
};

type AmbientEventType = 'change' | 'error';

class AmbientMixer {
    private sounds = new Map<string, AmbientSound>();
    private order: string[] = [];
    private board: AmbientBoard = Array.from({ length: AMBIENT_SLOT_COUNT }, () => null);
    private powered = false;
    private buffers = new Map<string, Promise<AudioBuffer>>();
    private nodes = new Map<string, ChannelNodes>();
    private masterGain: GainNode | null = null;
    private muted = false;
    private eventTarget = new EventTarget();

    constructor() {
        // The board layout is restored, but power always starts off so the UI
        // never claims sound the browser won't produce without a gesture.
        try {
            const saved = localStorage.getItem(BOARD_STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved) as unknown;
                if (Array.isArray(parsed)) {
                    parsed.slice(0, AMBIENT_SLOT_COUNT).forEach((entry, index) => {
                        const slot = entry as { soundId?: unknown; volume?: unknown; muted?: unknown } | null;
                        if (slot && typeof slot.soundId === 'string') {
                            this.board[index] = {
                                soundId: slot.soundId,
                                volume:
                                    typeof slot.volume === 'number' && Number.isFinite(slot.volume)
                                        ? clamp01(slot.volume)
                                        : DEFAULT_VOLUME,
                                muted: slot.muted === true,
                                loading: false,
                            };
                        }
                    });
                }
            }
        } catch {
            /* ignore corrupt storage */
        }
    }

    /** Install/refresh the library definitions (from the ambient catalog query). */
    setSounds(sounds: AmbientSound[]): void {
        this.sounds = new Map(sounds.map((sound) => [sound.id, sound]));
        this.order = sounds.map((sound) => sound.id);
        // Slots pointing at retired sounds are cleared rather than lingering broken.
        this.board = this.board.map((slot) => {
            if (slot && !this.sounds.has(slot.soundId)) {
                this.stopSound(slot.soundId);
                return null;
            }
            return slot;
        });
        this.dispatchChange();
    }

    getSounds(): AmbientSound[] {
        return this.order.map((id) => this.sounds.get(id)).filter((sound): sound is AmbientSound => Boolean(sound));
    }

    getBoard(): AmbientBoard {
        return this.board.map((slot) => (slot ? { ...slot } : null));
    }

    isPowered(): boolean {
        return this.powered;
    }

    /** Audible layer count (0 while powered off) — drives the dock badge. */
    activeCount(): number {
        if (!this.powered) return 0;
        return this.board.filter((slot) => slot && !slot.muted).length;
    }

    /** Master switch for all ambient audio. Call from a user gesture. */
    setPowered(on: boolean): void {
        if (this.powered === on) return;
        this.powered = on;
        for (const slot of this.board) {
            if (!slot) continue;
            if (on && !slot.muted) {
                void this.startSound(slot.soundId);
            } else {
                this.stopSound(slot.soundId);
            }
        }
        this.dispatchChange();
    }

    /** Add a library sound to the first empty slot. Returns false when the board is full. */
    addSound(soundId: string): boolean {
        if (!this.sounds.has(soundId)) return false;
        if (this.board.some((slot) => slot?.soundId === soundId)) return false;
        const index = this.board.findIndex((slot) => slot === null);
        if (index === -1) return false;
        this.board[index] = { soundId, volume: DEFAULT_VOLUME, muted: false, loading: false };
        if (this.powered) void this.startSound(soundId);
        this.persist();
        this.dispatchChange();
        return true;
    }

    removeSlot(index: number): void {
        const slot = this.board[index];
        if (!slot) return;
        this.stopSound(slot.soundId);
        this.board[index] = null;
        this.persist();
        this.dispatchChange();
    }

    setSlotVolume(index: number, volume: number): void {
        const slot = this.board[index];
        if (!slot) return;
        slot.volume = clamp01(volume);
        const ctx = this.context();
        const nodes = this.nodes.get(slot.soundId);
        if (nodes && ctx) {
            nodes.gain.gain.setTargetAtTime(this.targetGain(slot), ctx.currentTime, 0.05);
        } else if (this.powered && !slot.muted) {
            // Dragging a fader is a gesture: it may also wake a slot that failed to load.
            void this.startSound(slot.soundId);
        }
        this.persist();
        this.dispatchChange();
    }

    toggleSlotMute(index: number): void {
        const slot = this.board[index];
        if (!slot) return;
        slot.muted = !slot.muted;
        if (this.powered) {
            if (slot.muted) {
                this.stopSound(slot.soundId);
            } else {
                void this.startSound(slot.soundId);
            }
        }
        this.persist();
        this.dispatchChange();
    }

    /**
     * Load a named mix: the first AMBIENT_SLOT_COUNT sounds with a level > 0
     * fill the board (catalog order) and ambience powers on. Unknown ids are
     * ignored.
     */
    applyMix(levels: Record<string, number>): void {
        const incoming = this.order.filter((id) => (levels[id] ?? 0) > 0).slice(0, AMBIENT_SLOT_COUNT);
        const keep = new Set(incoming);
        for (const slot of this.board) {
            if (slot && !keep.has(slot.soundId)) this.stopSound(slot.soundId);
        }
        this.board = Array.from({ length: AMBIENT_SLOT_COUNT }, (_, index) => {
            const soundId = incoming[index];
            if (!soundId) return null;
            return { soundId, volume: clamp01((levels[soundId] ?? 0) / 100), muted: false, loading: false };
        });
        this.powered = true;
        for (const soundId of incoming) {
            void this.startSound(soundId);
        }
        this.persist();
        this.dispatchChange();
    }

    /** Snapshot of the audible board as levels (0..100), for saving as a mix. */
    currentLevels(): Record<string, number> {
        const levels: Record<string, number> = {};
        for (const slot of this.board) {
            if (slot && !slot.muted && slot.volume > 0) {
                levels[slot.soundId] = Math.round(slot.volume * 100);
            }
        }
        return levels;
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

    addEventListener(type: AmbientEventType, listener: (event: Event) => void): void {
        this.eventTarget.addEventListener(type, listener);
    }

    removeEventListener(type: AmbientEventType, listener: (event: Event) => void): void {
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

    private slotFor(soundId: string): AmbientSlot | null {
        return this.board.find((slot) => slot?.soundId === soundId) ?? null;
    }

    /** Volume with the perceptual curve and the sound's catalog loudness trim applied. */
    private targetGain(slot: AmbientSlot): number {
        const sound = this.sounds.get(slot.soundId);
        if (!sound) return 0;
        return perceptual(slot.volume) * (sound.gainPercent / 100);
    }

    private loadBuffer(soundId: string, ctx: AudioContext): Promise<AudioBuffer> {
        const cached = this.buffers.get(soundId);
        if (cached) return cached;

        const sound = this.sounds.get(soundId);
        if (!sound) return Promise.reject(new Error('Unknown ambient sound.'));

        const promise = fetch(sound.audioUrl)
            .then((response) => {
                if (!response.ok) throw new Error(`Failed to fetch ambient audio (${response.status}).`);
                return response.arrayBuffer();
            })
            .then((data) => ctx.decodeAudioData(data))
            .then(makeSeamless);

        // Drop failed loads from the cache so a later attempt retries the download.
        promise.catch(() => this.buffers.delete(soundId));
        this.buffers.set(soundId, promise);
        return promise;
    }

    private async startSound(soundId: string): Promise<void> {
        const ctx = this.context();
        const slot = this.slotFor(soundId);
        if (!slot || !ctx) return;
        if (ctx.state === 'suspended') {
            // Reached from a user gesture (power/toggle/add), so resume is permitted.
            void ctx.resume();
        }
        if (this.nodes.has(soundId)) return;

        slot.loading = true;
        this.dispatchChange();

        try {
            const buffer = await this.loadBuffer(soundId, ctx);
            // The slot may have been muted, cleared, or powered down while downloading.
            const current = this.slotFor(soundId);
            if (!this.powered || !current || current.muted || this.nodes.has(soundId)) return;

            const master = this.ensureMaster(ctx);
            const gain = ctx.createGain();
            gain.gain.value = 0;
            gain.connect(master);

            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.loop = true;
            source.connect(gain);
            source.start();

            this.nodes.set(soundId, { source, gain });
            // Fade in so a toggle never clicks.
            gain.gain.setTargetAtTime(this.targetGain(current), ctx.currentTime, 0.12);
        } catch {
            const sound = this.sounds.get(soundId);
            const current = this.slotFor(soundId);
            if (current) current.muted = true;
            this.eventTarget.dispatchEvent(
                new CustomEvent('error', {
                    detail: {
                        message: `Couldn't load ${sound?.label ?? 'that sound'} — check your connection and retry.`,
                    },
                }),
            );
        } finally {
            const current = this.slotFor(soundId);
            if (current) current.loading = false;
            this.dispatchChange();
        }
    }

    private stopSound(soundId: string): void {
        const nodes = this.nodes.get(soundId);
        if (!nodes) return;
        this.nodes.delete(soundId);
        const ctx = this.context();
        if (ctx) {
            nodes.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
            setTimeout(() => {
                try {
                    nodes.source.stop();
                    nodes.gain.disconnect();
                } catch {
                    /* nodes may already be gone */
                }
            }, 400);
        } else {
            try {
                nodes.source.stop();
            } catch {
                /* ignore */
            }
        }
    }

    private persist(): void {
        try {
            const payload = this.board.map((slot) =>
                slot ? { soundId: slot.soundId, volume: slot.volume, muted: slot.muted } : null,
            );
            localStorage.setItem(BOARD_STORAGE_KEY, JSON.stringify(payload));
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
