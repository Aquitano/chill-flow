'use client';

import { getAudioDebugLogger } from './debug';

type AudioEventMap = {
    statechange: CustomEvent<{ isPlaying: boolean }>;
    time: CustomEvent<{ currentTime: number; duration: number; bufferedPercent: number }>;
    ended: CustomEvent<object>;
    error: CustomEvent<{ message: string }>;
    volumechange: CustomEvent<{ volume: number; muted: boolean }>;
};

/**
 * How long one track takes to hand over to the next when a track is swapped mid-playback.
 *
 * This covers a swap over live audio — a skip, or picking something else from the library.
 * A track that runs out on its own has already stopped by the time the next one is handed
 * over, and fading there would mean holding the queue's next URL before the current track
 * ends, which the engine is never told.
 */
const CROSSFADE_MS = 1500;

const FADE_CURVE_POINTS = 64;

/**
 * Equal-power fade curves. Two linear ramps would sag audibly at the midpoint: uncorrelated
 * tracks sum in power rather than amplitude, so both sitting at half gain is quieter than
 * either at full. The sin/cos pair keeps the sum constant right across the handover.
 */
export function equalPowerCurves(points: number): { fadeIn: Float32Array; fadeOut: Float32Array } {
    const fadeIn = new Float32Array(points);
    const fadeOut = new Float32Array(points);

    for (let index = 0; index < points; index += 1) {
        const position = (index / (points - 1)) * (Math.PI / 2);
        fadeIn[index] = Math.sin(position);
        fadeOut[index] = Math.cos(position);
    }

    return { fadeIn, fadeOut };
}

const { fadeIn: FADE_IN_CURVE, fadeOut: FADE_OUT_CURVE } = equalPowerCurves(FADE_CURVE_POINTS);

/**
 * One playback lane. Two of them alternate so an outgoing track can still be heard while the
 * incoming one is already playing — a single element can only hold one source at a time, and
 * `createMediaElementSource` may only ever be called once per element, so the lanes are
 * built up front and reused rather than created per track.
 */
interface Deck {
    element: HTMLAudioElement;
    sourceNode: MediaElementAudioSourceNode | null;
    gainNode: GainNode | null;
}

/**
 * Simple client-side audio engine for streaming one main track and controlling master volume.
 * Uses HTMLAudioElement for streaming and pipes it through Web Audio for gain control.
 */
class AudioEngineImpl {
    private audioContext: AudioContext | null = null;
    private masterGainNode: GainNode | null = null;
    private decks: Deck[] = [];
    private activeDeckIndex = 0;
    /** Parks the outgoing deck once its fade has finished; null when no fade is running. */
    private fadeOutTimer: ReturnType<typeof setTimeout> | null = null;

    private eventTarget = new EventTarget();
    private isPlaying = false;
    private volumeNormalized = 0.5; // 0..1 persisted
    private muted = false;
    private loopEnabled = false;
    private loadToken = 0;

    private debugLogger = getAudioDebugLogger();

    private get activeDeck(): Deck | null {
        return this.decks[this.activeDeckIndex] ?? null;
    }

    private get mediaElement(): HTMLAudioElement | null {
        return this.activeDeck?.element ?? null;
    }

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

            this.ensureDecks();

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

    private ensureDecks(): void {
        if (this.decks.length > 0) return;
        this.decks = [this.createDeck(), this.createDeck()];
        this.debugLogger.info('AudioGraph', 'Created playback decks', { count: this.decks.length });
    }

    private createDeck(): Deck {
        const el = new Audio();
        el.crossOrigin = 'anonymous';
        el.preload = 'auto';
        el.loop = this.loopEnabled;
        // @ts-expect-error playsInline may be missing in lib dom types
        el.playsInline = true;

        const deck: Deck = { element: el, sourceNode: null, gainNode: null };

        if (this.audioContext && this.masterGainNode) {
            deck.gainNode = this.audioContext.createGain();
            // Silent until it takes over; the deck that is live opens itself to 1 below.
            deck.gainNode.gain.value = 0;
            deck.gainNode.connect(this.masterGainNode);
            deck.sourceNode = this.audioContext.createMediaElementSource(el);
            deck.sourceNode.connect(deck.gainNode);
        }

        // Only the deck currently on air speaks for the engine. The other one is mid-fade or
        // parked, and its timeupdate/pause/ended events are not the playback the user sees.
        const isOnAir = () => this.activeDeck === deck;

        el.addEventListener('timeupdate', () => {
            if (isOnAir()) this.dispatchTime();
        });
        el.addEventListener('ended', () => {
            if (!isOnAir()) return;
            this.isPlaying = false;
            this.dispatch('statechange', { isPlaying: this.isPlaying });
            this.dispatch('ended', {});
        });
        el.addEventListener('play', () => {
            if (!isOnAir()) return;
            this.isPlaying = true;
            this.dispatch('statechange', { isPlaying: this.isPlaying });
        });
        el.addEventListener('pause', () => {
            if (!isOnAir()) return;
            this.isPlaying = false;
            this.dispatch('statechange', { isPlaying: this.isPlaying });
        });
        el.addEventListener('error', () => {
            if (!isOnAir()) return;
            const err = el.error ?? null;
            this.dispatch('error', { message: this.mediaErrorMessage(err as MediaError | null) });
        });
        el.addEventListener('loadedmetadata', () => {
            if (isOnAir()) this.dispatchTime();
        });

        return deck;
    }

    /**
     * Settles as soon as the deck can play, or the load is superseded by a newer one. A
     * superseded load resolves rather than rejecting: being replaced is not a failure the
     * user should hear about, and `loadMainTrack` rechecks the token before it touches a
     * deck the newer load now owns. Leaving it pending instead would strand the caller's
     * promise and leave these listeners on an element the newer load is about to reuse.
     */
    private waitUntilReady(deck: Deck, loadToken: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const el = deck.element;
            const isSuperseded = () => loadToken !== this.loadToken;
            const onCanPlay = () => {
                cleanup();
                resolve();
            };
            const onLoadedData = () => {
                if (isSuperseded() || el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
                    cleanup();
                    resolve();
                }
            };
            const onErr = () => {
                cleanup();
                if (isSuperseded()) {
                    resolve();
                    return;
                }
                const err = el.error ?? null;
                reject(new Error(this.mediaErrorMessage(err as MediaError | null)));
            };
            const cleanup = () => {
                el.removeEventListener('canplay', onCanPlay);
                el.removeEventListener('loadeddata', onLoadedData);
                el.removeEventListener('error', onErr);
            };
            el.addEventListener('canplay', onCanPlay);
            el.addEventListener('loadeddata', onLoadedData);
            el.addEventListener('error', onErr);
            // In case already buffered
            setTimeout(onLoadedData, 0);
        });
    }

    /**
     * Cuts any handover still in flight short and silences every lane but the one on air.
     * Anything that stops or redirects playback has to go through here first, or the fade's
     * own timer will later park a deck that has since been given a new track.
     */
    private endCrossfade(): void {
        if (this.fadeOutTimer) {
            clearTimeout(this.fadeOutTimer);
            this.fadeOutTimer = null;
        }

        for (const deck of this.decks) {
            if (deck === this.activeDeck) {
                this.openDeck(deck);
            } else {
                this.parkDeck(deck);
            }
        }
    }

    /**
     * Brings a deck to full gain, dropping any fade still scheduled against it. A curve keeps
     * advancing in audio-context time whether or not the element is playing, so a deck left on
     * one would come back at partial gain when playback resumes.
     */
    private openDeck(deck: Deck): void {
        if (!deck.gainNode) return;
        deck.gainNode.gain.cancelScheduledValues(this.audioContext?.currentTime ?? 0);
        deck.gainNode.gain.value = 1;
    }

    /** Silences a deck and rewinds it, so the lane is clean before it is reused. */
    private parkDeck(deck: Deck): void {
        deck.element.pause();
        deck.element.currentTime = 0;
        if (deck.gainNode) {
            deck.gainNode.gain.cancelScheduledValues(this.audioContext?.currentTime ?? 0);
            deck.gainNode.gain.value = 0;
        }
    }

    private scheduleFade(deck: Deck, curve: Float32Array, startTime: number, seconds: number): void {
        const param = deck.gainNode?.gain;
        if (!param) return;

        param.cancelScheduledValues(startTime);

        if (typeof param.setValueCurveAtTime === 'function') {
            param.setValueCurveAtTime(curve, startTime, seconds);
        } else {
            param.value = curve[curve.length - 1] ?? 0;
        }
    }

    /**
     * Hands playback from the deck on air to the one holding the incoming track. The swap
     * lands before the fade is scheduled so the new track owns the engine's events for its
     * whole entrance — the outgoing deck is still audible, but it is no longer the playback
     * the UI reports on.
     */
    private crossfade(incoming: Deck, outgoing: Deck): void {
        this.activeDeckIndex = this.decks.indexOf(incoming);

        const seconds = CROSSFADE_MS / 1000;
        const startTime = this.audioContext?.currentTime ?? 0;
        this.scheduleFade(incoming, FADE_IN_CURVE, startTime, seconds);
        this.scheduleFade(outgoing, FADE_OUT_CURVE, startTime, seconds);

        this.fadeOutTimer = setTimeout(() => {
            this.fadeOutTimer = null;
            this.parkDeck(outgoing);
        }, CROSSFADE_MS);

        this.debugLogger.info('TrackLoader', 'Crossfading to the incoming track', { ms: CROSSFADE_MS });
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

    /**
     * Expose the shared AudioContext so sibling audio modules (ambient layer
     * synthesis) render into the same output graph instead of opening a second
     * context. Creates the context on first call.
     */
    getAudioContext(): AudioContext | null {
        this.ensureContext();
        return this.audioContext;
    }

    async loadMainTrack(url: string): Promise<void> {
        this.debugLogger.debug('TrackLoader', 'Loading main track', {
            url: url.substring(url.lastIndexOf('/') + 1), // Log filename only for privacy
            fullUrl: url,
        });

        const endTimer = this.debugLogger.time('TrackLoader', 'Track loading');
        this.ensureContext();
        this.ensureDecks();
        const myToken = ++this.loadToken;

        this.debugLogger.debug('TrackLoader', 'Load token assigned', { token: myToken });

        try {
            const outgoing = this.activeDeck;
            if (!outgoing) throw new Error('Media element not initialized');

            // Only worth a fade when something is actually playing — there is no seam to
            // cover on the first load, or while the player sits paused.
            const shouldCrossfade = this.isPlaying && Boolean(outgoing.element.src);
            const incoming = shouldCrossfade ? this.idleDeck(outgoing) : outgoing;

            // A fade still running owns the lane we are about to reuse, so retire it first.
            this.endCrossfade();

            this.debugLogger.debug('MediaElement', 'Setting source and loading', { url, crossfade: shouldCrossfade });
            incoming.element.src = url;
            incoming.element.load();

            await this.waitUntilReady(incoming, myToken);

            // A newer load arrived while this one was buffering; the decks are its business now.
            if (myToken !== this.loadToken) return;

            if (shouldCrossfade) {
                await incoming.element.play();
                this.crossfade(incoming, outgoing);
            } else {
                // Nothing to blend with, so the lane simply opens.
                this.openDeck(incoming);
            }

            this.debugLogger.debug('TrackLoader', 'Track loaded successfully');
            this.debugLogger.logMediaElementState(this.mediaElement);

        } catch (err) {
            this.debugLogger.error('TrackLoader', 'Failed to load track', { error: err, url });
            throw err;
        } finally {
            endTimer();
        }
    }

    private idleDeck(active: Deck): Deck {
        return this.decks.find((deck) => deck !== active) ?? active;
    }

    async play(): Promise<void> {
        this.debugLogger.debug('Playback', 'Play requested');
        const endTimer = this.debugLogger.time('Playback', 'Play operation');

        try {
            this.ensureContext();

            // The decks exist from the moment the context does, so a loaded source — not a
            // live element — is what says there is anything to play.
            if (!this.mediaElement || !this.hasMainTrack()) {
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
        // Otherwise the outgoing track of a fade in flight keeps playing under a paused
        // player until its timer catches up.
        this.endCrossfade();
        this.mediaElement.pause();
        this.debugLogger.debug('Playback', 'Pause completed');
    }

    stop(): void {
        this.debugLogger.debug('Playback', 'Stop requested');
        const active = this.activeDeck;
        if (!active) {
            this.debugLogger.warn('Playback', 'Cannot stop - no media element');
            return;
        }

        this.endCrossfade();
        active.element.pause();
        active.element.currentTime = 0;

        this.debugLogger.debug('Playback', 'Stop completed', {
            currentTime: active.element.currentTime,
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
        // Both lanes, so the setting survives the next handover rather than reverting to
        // whatever the incoming deck was built with.
        for (const deck of this.decks) {
            deck.element.loop = value;
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

    destroy(): void {
        this.debugLogger.info('Engine', 'Destroying audio engine');

        this.endCrossfade();

        for (const deck of this.decks) {
            this.debugLogger.debug('Engine', 'Cleaning up media element');
            deck.element.pause();
            deck.element.src = '';
            deck.element.load();
        }

        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.debugLogger.debug('Engine', 'Closing audio context');
            this.audioContext.close().catch(err => {
                this.debugLogger.warn('Engine', 'Failed to close audio context', err);
            });
        }

        // ensureContext() short-circuits on a non-null context, so anything the singleton
        // still points at here is a graph a later caller would silently build on top of.
        this.decks = [];
        this.activeDeckIndex = 0;
        this.masterGainNode = null;
        this.audioContext = null;
        this.isPlaying = false;

        this.debugLogger.info('Engine', 'Audio engine destroyed');
    }

    getDebugState(): Record<string, unknown> {
        return {
            hasAudioContext: !!this.audioContext,
            audioContextState: this.audioContext?.state,
            hasMediaElement: !!this.mediaElement,
            hasGainNode: !!this.masterGainNode,
            hasSourceNode: this.decks.every((deck) => !!deck.sourceNode),
            activeDeckIndex: this.activeDeckIndex,
            isCrossfading: this.fadeOutTimer !== null,
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
