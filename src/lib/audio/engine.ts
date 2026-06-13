'use client';

import { getAudioDebugLogger } from './debug';

export type AudioVariant = { codec: 'webm' | 'm4a'; bitrateKbps: number; url: string };
export type AudioTrack = { id: string; title: string; variants?: AudioVariant[]; url?: string };

type AudioEventMap = {
    statechange: CustomEvent<{ isPlaying: boolean }>;
    time: CustomEvent<{ currentTime: number; duration: number; bufferedPercent: number }>;
    ended: CustomEvent<object>;
    error: CustomEvent<{ message: string }>;
    volumechange: CustomEvent<{ volume: number; muted: boolean }>;
};

/**
 * Simple client-side audio engine for streaming one main track and controlling master volume.
 * Uses HTMLAudioElement for streaming and pipes it through Web Audio for gain control.
 */
class AudioEngineImpl {
    private audioContext: AudioContext | null = null;
    private masterGainNode: GainNode | null = null;
    private mediaElement: HTMLAudioElement | null = null;
    private mediaSourceNode: MediaElementAudioSourceNode | null = null;

    private eventTarget = new EventTarget();
    private isPlaying = false;
    private volumeNormalized = 0.5; // 0..1 persisted
    private muted = false;
    private loopEnabled = false;
    private loadToken = 0;

    // Debug (dev-only no-op in production)
    private debugLogger = getAudioDebugLogger();

    private ensureContext(): void {
        if (this.audioContext) {
            this.debugLogger.debug('AudioContext', 'Context already exists, skipping creation');
            return;
        }

        const endTimer = this.debugLogger.time('AudioContext', 'Context initialization');

        try {
            const w = window as Window & { webkitAudioContext?: typeof AudioContext };
            const Ctor = (window as any).AudioContext ?? w.webkitAudioContext;

            if (!Ctor) {
                this.debugLogger.error('AudioContext', 'Web Audio API not supported');
                throw new Error('Web Audio API not supported');
            }

            this.audioContext = new Ctor({ latencyHint: 'interactive' });
            this.debugLogger.info('AudioContext', 'Created audio context', {
                sampleRate: this.audioContext?.sampleRate,
                state: this.audioContext?.state,
                baseLatency: this.audioContext?.baseLatency,
                outputLatency: this.audioContext?.outputLatency,
            });

            // Load persisted volume
            try {
                const saved = localStorage.getItem('audio.masterVolume');
                if (saved != null) {
                    const parsed = Math.max(0, Math.min(1, Number(saved)));
                    this.volumeNormalized = parsed;
                    this.debugLogger.debug('Volume', 'Restored volume from localStorage', {
                        saved,
                        normalized: this.volumeNormalized
                    });
                }
            } catch (err) {
                this.debugLogger.warn('Volume', 'Failed to restore volume from localStorage', err);
            }

            // Create gain node
            this.masterGainNode = this.audioContext?.createGain() ?? null;
            if (this.masterGainNode && this.audioContext) {
                const gainValue = this.perceptual(this.volumeNormalized);
                this.masterGainNode.gain.value = gainValue;
                this.masterGainNode.connect(this.audioContext.destination);
            }

            this.debugLogger.info('AudioGraph', 'Connected master gain node', {
                volumeNormalized: this.volumeNormalized,
                gainValue: this.masterGainNode ? this.perceptual(this.volumeNormalized) : 0,
                muted: this.muted,
            });

        } catch (err) {
            this.debugLogger.error('AudioContext', 'Failed to initialize context', err);
            throw err;
        } finally {
            endTimer();
        }
    }

    /**
     * Maps a normalized 0..1 control value to linear amplitude with a perceptual curve.
     * Account for human logarithmic loudness perception.
     */
    private perceptual(v01: number): number {
        const v = Math.max(0, Math.min(1, v01));
        return v * v;
    }

    /**
     * Create and configure the HTMLAudioElement once, with persistent listeners.
     */
    private ensureMediaElement(): HTMLAudioElement {
        if (this.mediaElement) return this.mediaElement;

        const el = new Audio();
        el.crossOrigin = 'anonymous';
        el.preload = 'auto';
        el.loop = this.loopEnabled;
        // @ts-expect-error playsInline may be missing in lib dom types
        el.playsInline = true;

        el.addEventListener('timeupdate', () => this.dispatchTime());
        el.addEventListener('ended', () => {
            this.isPlaying = false;
            this.dispatch('statechange', { isPlaying: this.isPlaying });
            this.dispatch('ended', {});
        });
        el.addEventListener('play', () => {
            this.isPlaying = true;
            this.dispatch('statechange', { isPlaying: this.isPlaying });
        });
        el.addEventListener('pause', () => {
            this.isPlaying = false;
            this.dispatch('statechange', { isPlaying: this.isPlaying });
        });
        el.addEventListener('error', () => {
            const err = el.error ?? null;
            this.dispatch('error', { message: this.mediaErrorMessage(err as MediaError | null) });
        });
        el.addEventListener('loadedmetadata', () => this.dispatchTime());

        this.mediaElement = el;
        return el;
    }

    /**
     * Connect media element to gain node if needed.
     */
    private connectGraphIfNeeded(): void {
        if (!this.audioContext || !this.masterGainNode || !this.mediaElement) return;
        if (this.mediaSourceNode) return;
        this.mediaSourceNode = this.audioContext.createMediaElementSource(this.mediaElement);
        this.mediaSourceNode.connect(this.masterGainNode);
    }

    /**
     * Await until media element is ready to play or errors.
     */
    private waitUntilReady(loadToken: number): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.mediaElement) return reject(new Error('Media element not initialized'));
            const onCanPlay = () => {
                if (loadToken !== this.loadToken) return;
                cleanup();
                resolve();
            };
            const onLoadedData = () => {
                if (loadToken !== this.loadToken) return;
                const el = this.mediaElement!;
                if (el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
                    cleanup();
                    resolve();
                }
            };
            const onErr = () => {
                if (loadToken !== this.loadToken) return;
                const err = this.mediaElement?.error ?? null;
                cleanup();
                reject(new Error(this.mediaErrorMessage(err as MediaError | null)));
            };
            const cleanup = () => {
                this.mediaElement?.removeEventListener('canplay', onCanPlay);
                this.mediaElement?.removeEventListener('loadeddata', onLoadedData);
                this.mediaElement?.removeEventListener('error', onErr);
            };
            this.mediaElement.addEventListener('canplay', onCanPlay);
            this.mediaElement.addEventListener('loadeddata', onLoadedData);
            this.mediaElement.addEventListener('error', onErr);
            // In case already buffered
            setTimeout(onLoadedData, 0);
        });
    }

    /**
     * Smoothly transitions the master gain to the given target without audible clicks.
    *
     * @param target Linear amplitude in [0, 1]. Caller should apply perceptual mapping already.
     * @param timeMs Approximate ramp duration in milliseconds (default 60 ms).
     */
    private rampGain(target: number, timeMs = 60): void {
        if (!this.audioContext || !this.masterGainNode) return;
        const now = this.audioContext.currentTime;
        const param = this.masterGainNode.gain as AudioParam & { cancelAndHoldAtTime?: (t: number) => void };
        try {
            param.cancelAndHoldAtTime?.(now);
        } catch {
            param.cancelScheduledValues(now);
        }
        const timeConst = Math.max(0.005, timeMs / 1000);
        if (typeof param.setTargetAtTime === 'function') {
            param.setTargetAtTime(target, now, Math.min(0.05, timeConst));
        } else if (typeof param.linearRampToValueAtTime === 'function') {
            param.linearRampToValueAtTime(target, now + timeConst);
        } else {
            param.value = target;
        }
    }

    async init(): Promise<void> {
        this.debugLogger.debug('Engine', 'Initializing audio engine');
        const endTimer = this.debugLogger.time('Engine', 'Engine initialization');

        try {
            this.ensureContext();
            this.debugLogger.debug('Engine', 'Audio engine initialized successfully');
        } catch (err) {
            this.debugLogger.error('Engine', 'Failed to initialize audio engine', err);
            throw err;
        } finally {
            endTimer();
        }
    }

    hasMainTrack(): boolean {
        return Boolean(this.mediaElement?.src);
    }

    private pickVariant(track: AudioTrack): string | null {
        this.debugLogger.debug('TrackSelection', 'Selecting best variant for track', {
            trackId: track.id,
            title: track.title,
            hasDirectUrl: !!track.url,
            variantCount: track.variants?.length ?? 0,
        });

        if (track.url) {
            this.debugLogger.debug('TrackSelection', 'Using direct URL', { url: track.url });
            return track.url;
        }

        const variants = track.variants ?? [];
        if (variants.length === 0) {
            this.debugLogger.warn('TrackSelection', 'No variants available');
            return null;
        }

        const probe = document.createElement('audio');
        const webm = variants.find((v) => v.codec === 'webm');
        const m4a = variants.find((v) => v.codec === 'm4a');

        const webmSupport = webm ? probe.canPlayType('audio/webm') : '';
        const mp4Support = m4a ? (probe.canPlayType('audio/mp4') || probe.canPlayType('audio/aac')) : '';

        this.debugLogger.debug('TrackSelection', 'Codec support check', {
            webmSupport,
            mp4Support,
            variants: variants.map(v => ({ codec: v.codec, bitrate: v.bitrateKbps })),
        });

        if (webm && webmSupport) {
            this.debugLogger.info('TrackSelection', 'Selected WebM variant', {
                codec: webm.codec,
                bitrate: webm.bitrateKbps,
                url: webm.url,
            });
            return webm.url;
        }

        if (m4a && mp4Support) {
            this.debugLogger.info('TrackSelection', 'Selected M4A variant', {
                codec: m4a.codec,
                bitrate: m4a.bitrateKbps,
                url: m4a.url,
            });
            return m4a.url;
        }

        // Fallback to first variant
        const fallback = variants[0];
        if (fallback) {
            this.debugLogger.warn('TrackSelection', 'Using fallback variant (may not be supported)', {
                codec: fallback.codec,
                bitrate: fallback.bitrateKbps,
                url: fallback.url,
            });
            return fallback.url;
        }

        this.debugLogger.error('TrackSelection', 'No playable variant found');
        return null;
    }

    async loadMainTrackFromTrack(track: AudioTrack): Promise<void> {
        this.debugLogger.info('TrackLoader', 'Loading track from AudioTrack object', {
            trackId: track.id,
            title: track.title,
        });

        const url = this.pickVariant(track);
        if (!url) {
            const error = new Error('No playable variant for track');
            this.debugLogger.error('TrackLoader', 'Failed to find playable variant', { track });
            throw error;
        }

        await this.loadMainTrack(url);
    }

    async loadMainTrack(url: string): Promise<void> {
        this.debugLogger.debug('TrackLoader', 'Loading main track', {
            url: url.substring(url.lastIndexOf('/') + 1), // Log filename only for privacy
            fullUrl: url,
        });

        const endTimer = this.debugLogger.time('TrackLoader', 'Track loading');
        this.ensureContext();
        const myToken = ++this.loadToken;

        this.debugLogger.debug('TrackLoader', 'Load token assigned', { token: myToken });

        try {
            if (!this.mediaElement) this.ensureMediaElement();

            this.debugLogger.debug('MediaElement', 'Setting source and loading', { url });
            const el = this.mediaElement!;
            el.src = url;
            el.load();

            this.connectGraphIfNeeded();

            await this.waitUntilReady(myToken);

            this.debugLogger.debug('TrackLoader', 'Track loaded successfully');
            this.debugLogger.logMediaElementState(this.mediaElement);

        } catch (err) {
            this.debugLogger.error('TrackLoader', 'Failed to load track', { error: err, url });
            throw err;
        } finally {
            endTimer();
        }
    }

    async play(): Promise<void> {
        this.debugLogger.debug('Playback', 'Play requested');
        const endTimer = this.debugLogger.time('Playback', 'Play operation');

        try {
            this.ensureContext();

            if (!this.mediaElement) {
                this.debugLogger.error('Playback', 'No main track loaded');
                throw new Error('No main track loaded');
            }

            this.debugLogger.logAudioContextState(this.audioContext);
            this.debugLogger.logMediaElementState(this.mediaElement);

            if (this.audioContext?.state === 'suspended') {
                this.debugLogger.warn('AudioContext', 'Context suspended, attempting to resume');
                try {
                    await this.audioContext.resume();
                    this.debugLogger.info('AudioContext', 'Context resumed successfully');
                } catch (err) {
                    this.debugLogger.warn('AudioContext', 'Failed to resume context - browser may require gesture', err);
                    // Ignore; browser may require a gesture and will surface on play()
                }
            }

            await this.mediaElement.play();
            this.debugLogger.debug('Playback', 'Play operation completed');

        } catch (err: unknown) {
            const name = (err as Error).name || 'PlaybackError';
            const message = (err as Error).message || 'Unknown playback error';

            this.debugLogger.error('Playback', 'Play operation failed', {
                name,
                message,
                error: err,
                contextState: this.audioContext?.state,
                hasTrack: this.hasMainTrack(),
            });

            if (name === 'NotAllowedError') {
                throw new Error('Playback blocked by browser. Please interact to start audio.');
            }
            throw err;
        } finally {
            endTimer();
        }
    }

    pause(): void {
        this.debugLogger.debug('Playback', 'Pause requested');
        if (!this.mediaElement) {
            this.debugLogger.warn('Playback', 'Cannot pause - no media element');
            return;
        }
        this.mediaElement.pause();
        this.debugLogger.debug('Playback', 'Pause completed');
    }

    stop(): void {
        this.debugLogger.debug('Playback', 'Stop requested');
        if (!this.mediaElement) {
            this.debugLogger.warn('Playback', 'Cannot stop - no media element');
            return;
        }
        this.mediaElement.pause();
        this.mediaElement.currentTime = 0;
        this.debugLogger.debug('Playback', 'Stop completed', {
            currentTime: this.mediaElement.currentTime,
        });
    }

    setMasterVolume(volume01: number): void {
        const originalVolume = this.volumeNormalized;
        this.debugLogger.debug('Volume', 'Setting master volume', {
            requested: volume01,
            current: originalVolume,
        });

        this.ensureContext();
        if (!this.masterGainNode) {
            this.debugLogger.warn('Volume', 'Cannot set volume - no master gain node');
            return;
        }

        this.volumeNormalized = Math.max(0, Math.min(1, volume01));

        try {
            localStorage.setItem('audio.masterVolume', String(this.volumeNormalized));
            this.debugLogger.debug('Volume', 'Persisted volume to localStorage', {
                volume: this.volumeNormalized
            });
        } catch (err) {
            this.debugLogger.warn('Volume', 'Failed to persist volume to localStorage', err);
        }

        const target = this.muted ? 0 : this.perceptual(this.volumeNormalized);
        this.debugLogger.debug('Volume', 'Calculated gain target', {
            volumeNormalized: this.volumeNormalized,
            perceptualGain: this.perceptual(this.volumeNormalized),
            actualTarget: target,
            muted: this.muted,
        });

        this.rampGain(target, 60);
        this.dispatch('volumechange', { volume: this.volumeNormalized, muted: this.muted });

        this.debugLogger.info('Volume', 'Master volume updated', {
            from: originalVolume,
            to: this.volumeNormalized,
            gainTarget: target,
        });
    }

    getMasterVolume(): number {
        return this.volumeNormalized;
    }

    /**
     * Enable/disable seamless looping of the current track. When enabled the media
     * element repeats itself and does not emit an `ended` event.
     */
    setLoop(value: boolean): void {
        this.loopEnabled = value;
        if (this.mediaElement) {
            this.mediaElement.loop = value;
        }
        this.debugLogger.debug('Playback', 'Loop set', { loop: value });
    }

    getLoop(): boolean {
        return this.loopEnabled;
    }

    mute(): void {
        this.debugLogger.debug('Volume', 'Muting audio');
        this.muted = true;
        this.rampGain(0, 60);
        this.dispatch('volumechange', { volume: this.volumeNormalized, muted: this.muted });
        this.debugLogger.debug('Volume', 'Audio muted', { volume: this.volumeNormalized });
    }

    unmute(): void {
        this.debugLogger.debug('Volume', 'Unmuting audio');
        this.muted = false;
        const target = this.perceptual(this.volumeNormalized);
        this.rampGain(target, 60);
        this.dispatch('volumechange', { volume: this.volumeNormalized, muted: this.muted });
        this.debugLogger.debug('Volume', 'Audio unmuted', {
            volume: this.volumeNormalized,
            gainTarget: target,
        });
    }

    setPlaybackRate(rate: number): void {
        const clampedRate = Math.max(0.25, Math.min(4, rate));
        this.debugLogger.debug('Playback', 'Setting playback rate', {
            requested: rate,
            clamped: clampedRate,
        });

        if (!this.mediaElement) {
            this.debugLogger.warn('Playback', 'Cannot set playback rate - no media element');
            return;
        }

        this.mediaElement.playbackRate = clampedRate;
        this.debugLogger.debug('Playback', 'Playback rate set', { rate: clampedRate });
    }

    seek(seconds: number): void {
        this.debugLogger.debug('Playback', 'Seeking to position', {
            requested: seconds,
            currentTime: this.mediaElement?.currentTime ?? 0,
        });

        if (!this.mediaElement) {
            this.debugLogger.warn('Playback', 'Cannot seek - no media element');
            return;
        }

        const duration = this.mediaElement.duration || Infinity;
        const t = Math.max(0, Math.min(duration, seconds));
        this.mediaElement.currentTime = t;

        this.debugLogger.debug('Playback', 'Seek completed', {
            targetTime: t,
            duration,
            actualTime: this.mediaElement.currentTime,
        });
    }

    getCurrentTime(): number {
        return this.mediaElement?.currentTime ?? 0;
    }
    getDuration(): number {
        return this.mediaElement?.duration ?? 0;
    }
    getBufferedPercent(): number {
        const el = this.mediaElement;
        if (!el) return 0;
        try {
            const time = el.currentTime;
            for (let i = 0; i < el.buffered.length; i++) {
                const start = el.buffered.start(i);
                const end = el.buffered.end(i);
                if (time >= start && time <= end) {
                    const dur = el.duration || 0;
                    return dur ? Math.min(1, end / dur) : 0;
                }
            }
        } catch {
            /* ignore */
        }
        return 0;
    }

    addEventListener<K extends keyof AudioEventMap>(
        type: K,
        listener: (ev: AudioEventMap[K]) => void,
        options?: boolean | AddEventListenerOptions,
    ): void {
        this.eventTarget.addEventListener(type, listener as EventListener, options);
    }

    removeEventListener<K extends keyof AudioEventMap>(
        type: K,
        listener: (ev: AudioEventMap[K]) => void,
        options?: boolean | EventListenerOptions,
    ): void {
        this.eventTarget.removeEventListener(type, listener as EventListener, options);
    }

    private dispatch<K extends keyof AudioEventMap>(type: K, detail: AudioEventMap[K]['detail']): void {
        const evt = new CustomEvent(type as any, { detail }) as AudioEventMap[K];

        if (type === 'error' || type === 'ended') {
            this.debugLogger.info('Events', `Dispatching ${type} event`, detail);
        } else {
            this.debugLogger.debug('Events', `Dispatching ${type} event`, detail);
        }

        this.eventTarget.dispatchEvent(evt);
    }

    private dispatchTime(): void {
        this.dispatch('time', {
            currentTime: this.getCurrentTime(),
            duration: this.getDuration(),
            bufferedPercent: this.getBufferedPercent(),
        });
    }

    private mediaErrorMessage(err: MediaError | null): string {
        if (!err) return 'Unknown audio error';
        switch (err.code) {
            case MediaError.MEDIA_ERR_ABORTED:
                return 'Audio load aborted';
            case MediaError.MEDIA_ERR_NETWORK:
                return 'Network error while loading audio';
            case MediaError.MEDIA_ERR_DECODE:
                return 'Audio decode error';
            case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                return 'Audio source not supported';
            default:
                return `Audio error (${err.code})`;
        }
    }

    /**
     * Cleanup method for development debugging
     */
    destroy(): void {
        this.debugLogger.info('Engine', 'Destroying audio engine');

        if (this.mediaElement) {
            this.debugLogger.debug('Engine', 'Cleaning up media element');
            this.mediaElement.pause();
            this.mediaElement.src = '';
            this.mediaElement.load();
        }

        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.debugLogger.debug('Engine', 'Closing audio context');
            this.audioContext.close().catch(err => {
                this.debugLogger.warn('Engine', 'Failed to close audio context', err);
            });
        }

        this.debugLogger.info('Engine', 'Audio engine destroyed');
    }

    /**
     * Debug method to get current engine state
     */
    getDebugState(): Record<string, unknown> {
        return {
            hasAudioContext: !!this.audioContext,
            audioContextState: this.audioContext?.state,
            hasMediaElement: !!this.mediaElement,
            hasGainNode: !!this.masterGainNode,
            hasSourceNode: !!this.mediaSourceNode,
            isPlaying: this.isPlaying,
            volumeNormalized: this.volumeNormalized,
            muted: this.muted,
            loadToken: this.loadToken,
            hasTrack: this.hasMainTrack(),
            currentTime: this.getCurrentTime(),
            duration: this.getDuration(),
            bufferedPercent: this.getBufferedPercent(),
        };
    }
}

let singleton: AudioEngineImpl | null = null;

export function getAudioEngine(): AudioEngineImpl {
    if (!singleton) {
        const logger = getAudioDebugLogger();
        logger.info('Engine', 'Creating new AudioEngine singleton');
        singleton = new AudioEngineImpl();
    }
    return singleton;
}

declare global {
    interface Window {
        __audioEngine?: ReturnType<typeof getAudioEngine>;
        __audioDebugLogger?: ReturnType<typeof getAudioDebugLogger>;
    }
}

if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
    try {
        window.__audioEngine = getAudioEngine();
        window.__audioDebugLogger = getAudioDebugLogger();

        (window as unknown as Record<string, unknown>).__audioDebugHelpers = {
            getEngineState: () => window.__audioEngine?.getDebugState(),
            logAudioContext: () => {
                const engine = window.__audioEngine as unknown as Record<string, unknown>;
                if (engine?.audioContext) {
                    window.__audioDebugLogger?.logAudioContextState(engine.audioContext as AudioContext);
                }
            },
            logMediaElement: () => {
                const engine = window.__audioEngine as unknown as Record<string, unknown>;
                if (engine?.mediaElement) {
                    window.__audioDebugLogger?.logMediaElementState(engine.mediaElement as HTMLAudioElement);
                }
            },
            clearDebugLog: () => window.__audioDebugLogger?.clear(),
            getDebugEvents: () => window.__audioDebugLogger?.getEvents(),
        };

    } catch {
        /* ignore */
    }
}
