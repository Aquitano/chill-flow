'use client';

import { AmbiencePanel } from '@/components/app/AmbiencePanel';
import { LibraryPanel } from '@/components/app/LibraryPanel';
import { TrackArt } from '@/components/app/TrackArt';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useTrackLike } from '@/hooks/use-track-like';
import { useAmbient } from '@/lib/audio/useAmbient';
import { useAudioEngineState } from '@/lib/audio/useAudioEngine';
import { LIKED_SCENE, sceneLabel } from '@/lib/tracks';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { AnimatePresence, motion } from 'framer-motion';
import {
    ChevronUp,
    Heart,
    Music,
    Pause,
    Play,
    Repeat,
    SkipBack,
    SkipForward,
    Volume2,
    VolumeX,
    Waves,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

// Single toast id so the concurrent signals for one failure (the rejected load/play
// promise and the element's 'error' event) collapse into one notification, and a later
// failure replaces the old toast instead of stacking.
const AUDIO_ERROR_TOAST_ID = 'audio-error';

function formatClock(totalSeconds: number): string {
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
    const seconds = Math.floor(totalSeconds);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function toAudioErrorMessage(err: unknown): string {
    return err instanceof Error && err.message ? err.message : 'Unknown audio error';
}

export const PlayerDock: React.FC = () => {
    const { engine, state: audio } = useAudioEngineState();
    const { mixer, activeCount: ambientCount } = useAmbient();
    const toggleLike = useTrackLike();

    const isPlayingStore = useAppStore((state) => state.isPlaying);
    const volume = useAppStore((state) => state.volume);
    const togglePlay = useAppStore((state) => state.togglePlay);
    const setIsPlaying = useAppStore((state) => state.setIsPlaying);
    const setVolume = useAppStore((state) => state.setVolume);
    const currentTrack = useAppStore((state) => state.currentTrack);
    const likedTrackIds = useAppStore((state) => state.likedTrackIds);
    const previousTrack = useAppStore((state) => state.previousTrack);
    const nextTrack = useAppStore((state) => state.nextTrack);
    const repeatEnabled = useAppStore((state) => state.repeatEnabled);
    const toggleRepeat = useAppStore((state) => state.toggleRepeat);
    const currentMode = useAppStore((state) => state.currentMode);
    const modes = useAppStore((state) => state.modes);
    const sessionSummary = useAppStore((state) => state.sessionSummary);
    const activeScene = useAppStore((state) => state.activeScene);
    const activeOverlay = useAppStore((state) => state.activeOverlay);
    const toggleOverlay = useAppStore((state) => state.toggleOverlay);
    const setOverlay = useAppStore((state) => state.setOverlay);

    const showStreak = modes[currentMode]?.showStreak ?? false;
    const isLiked = currentTrack ? likedTrackIds.includes(currentTrack.id) : false;
    const libraryOpen = activeOverlay === 'library';
    const ambienceOpen = activeOverlay === 'ambience';

    // Skip and next follow the library filter, so the filter has to be visible from the
    // dock too — otherwise a queue of three tracks looks like a broken skip button.
    const queueLabel = activeScene === null ? null : activeScene === LIKED_SCENE ? 'Liked' : sceneLabel(activeScene);

    // Playback progress / scrubber state. While the user drags, `scrubValue` overrides
    // the live currentTime so the thumb doesn't fight per-second time updates; the seek
    // is committed (and scrubbing released) on pointer-up.
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    const canScrub = audio.hasTrack && duration > 0;
    const [scrubValue, setScrubValue] = useState<number | null>(null);
    const sliderPosition = Math.min(scrubValue ?? audio.currentTime, duration || 0);

    // The store's `volume` is the single source of truth — it is hydrated from the
    // account preferences (see AppShell) and pushed down to the engine here. We do NOT
    // read the engine's localStorage volume back into the store, so the per-account
    // value wins across devices instead of being clobbered by a stale local value.
    useEffect(() => {
        try {
            engine.setMasterVolume((volume?.[0] ?? 50) / 100);
        } catch {
            // Ignore engine sync failures here and allow playback UI to remain responsive.
        }
    }, [engine, volume]);

    // Mute silences the whole room: the ambient layers follow the player's mute state.
    useEffect(() => {
        mixer.setMuted(audio.muted);
    }, [mixer, audio.muted]);

    // The Zustand store's `isPlaying` is the single source of truth for playback
    // intent. The engine is driven FROM the store (below), so any path that flips
    // `isPlaying` actually starts audio. A ref mirrors the latest intent for use
    // inside async callbacks.
    const isPlayingRef = useRef(isPlayingStore);
    useEffect(() => {
        isPlayingRef.current = isPlayingStore;
    }, [isPlayingStore]);

    // Retry reads the track from a ref so the toast's action always targets the
    // currently-selected track, even if it changed after the toast was raised.
    const currentTrackRef = useRef(currentTrack);
    useEffect(() => {
        currentTrackRef.current = currentTrack;
    }, [currentTrack]);

    // Indirection ref breaks the reportAudioFailure <-> retryAudio cycle so the toast's
    // Retry button always invokes the latest callback without re-rendering the toast.
    const retryAudioRef = useRef<() => void>(() => {});

    const reportAudioFailure = useCallback(
        (message: string) => {
            // Reflect the stopped state so the UI doesn't show a false "playing".
            setIsPlaying(false);
            toast.error("Couldn't play audio", {
                id: AUDIO_ERROR_TOAST_ID,
                description: message,
                action: { label: 'Retry', onClick: () => retryAudioRef.current() },
            });
        },
        [setIsPlaying],
    );

    const retryAudio = useCallback(() => {
        const url = currentTrackRef.current?.audioUrl;
        if (!url) return;
        engine
            .loadMainTrack(url)
            .then(() => engine.play())
            .then(() => setIsPlaying(true))
            .catch((err) => reportAudioFailure(toAudioErrorMessage(err)));
    }, [engine, setIsPlaying, reportAudioFailure]);

    useEffect(() => {
        retryAudioRef.current = retryAudio;
    }, [retryAudio]);

    // Surface runtime media errors (e.g. the stream drops mid-playback) that arrive as
    // engine 'error' events rather than a rejected promise. Gate on play intent so a
    // failed silent preload while idle doesn't toast.
    useEffect(() => {
        const handleError = (e: CustomEvent<{ message: string }>) => {
            if (isPlayingRef.current) reportAudioFailure(e.detail.message);
        };
        engine.addEventListener('error', handleError);
        return () => engine.removeEventListener('error', handleError);
    }, [engine, reportAudioFailure]);

    useEffect(() => {
        engine.setLoop(repeatEnabled);
    }, [engine, repeatEnabled]);

    // Load the selected track whenever it changes, and resume playback if the user
    // was already playing (so Skip/Next/track selection don't silently stop audio).
    useEffect(() => {
        const url = currentTrack?.audioUrl;
        if (!url) return;

        let cancelled = false;
        engine
            .loadMainTrack(url)
            .then(() => {
                if (cancelled || !isPlayingRef.current) return;
                return engine.play();
            })
            .catch((err) => {
                // Loading/playback failed (network, CORS, codec). Only surface it when the
                // user actually wanted playback, so a failed idle preload stays quiet.
                if (!cancelled && isPlayingRef.current) reportAudioFailure(toAudioErrorMessage(err));
            });

        return () => {
            cancelled = true;
        };
    }, [currentTrack?.audioUrl, engine, reportAudioFailure]);

    useEffect(() => {
        if (isPlayingStore) {
            if (!engine.hasMainTrack()) return; // the load effect resumes once ready
            engine.play().catch((err) => reportAudioFailure(toAudioErrorMessage(err)));
        } else {
            engine.pause();
        }
    }, [isPlayingStore, engine, reportAudioFailure]);

    // When a track ends naturally (loop disabled), advance within the scene queue.
    // With Repeat enabled the engine loops the element, so no `ended` event fires.
    useEffect(() => {
        const handleEnded = () => {
            // With a single-track queue, "next" resolves to the same track, so the
            // URL-keyed load effect won't re-fire — restart it explicitly instead of
            // dead-stopping at the end (which would also leave the UI showing "Pause").
            if (useAppStore.getState().getQueue().length <= 1) {
                engine.seek(0);
                engine.play().catch((err) => reportAudioFailure(toAudioErrorMessage(err)));
                return;
            }
            nextTrack();
        };
        engine.addEventListener('ended', handleEnded);
        return () => engine.removeEventListener('ended', handleEnded);
    }, [engine, nextTrack, reportAudioFailure]);

    // Clicking anywhere outside the dock closes an open panel; the panels are
    // lightweight browsers, not modal decisions.
    const dockRef = useRef<HTMLDivElement>(null);
    const libraryButtonRef = useRef<HTMLButtonElement>(null);
    const ambienceButtonRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!libraryOpen && !ambienceOpen) return;
        const handlePointerDown = (event: PointerEvent) => {
            if (event.target instanceof Node && dockRef.current?.contains(event.target)) return;
            // Radix portals (the ambience sound picker) render outside the dock but
            // belong to it — picking a sound must not dismiss the panel.
            if (event.target instanceof Element && event.target.closest('[data-radix-popper-content-wrapper]')) {
                return;
            }
            setOverlay(null);
        };
        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
    }, [libraryOpen, ambienceOpen, setOverlay]);

    // A panel closed from the keyboard (Escape, or the shortcut that opened it) would
    // otherwise strand focus on the body. Only reclaim it when focus is still inside the
    // dock, so closing by clicking something else doesn't yank it back here.
    const previousOverlayRef = useRef(activeOverlay);
    useEffect(() => {
        const closed = previousOverlayRef.current;
        previousOverlayRef.current = activeOverlay;

        if (activeOverlay !== null || (closed !== 'library' && closed !== 'ambience')) return;
        const focused = document.activeElement;
        if (focused !== document.body && !(focused instanceof Node && dockRef.current?.contains(focused))) return;

        const trigger = closed === 'library' ? libraryButtonRef.current : ambienceButtonRef.current;
        trigger?.focus();
    }, [activeOverlay]);

    return (
        <div ref={dockRef} className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col">
            <AnimatePresence>
                {libraryOpen && <LibraryPanel key="library" />}
                {ambienceOpen && <AmbiencePanel key="ambience" />}
            </AnimatePresence>

            <motion.div
                data-player-bar
                className="pointer-events-auto flex flex-col gap-3 border-t border-white/5 bg-black/60 p-4 backdrop-blur-md"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.8 }}
            >
                <div className="flex items-center gap-3">
                    <span className="text-ink-dim w-10 shrink-0 text-right text-[11px] tabular-nums">
                        {formatClock(sliderPosition)}
                    </span>
                    <Slider
                        value={[sliderPosition]}
                        max={duration || 100}
                        step={1}
                        disabled={!canScrub}
                        onValueChange={(next) => setScrubValue(next[0] ?? 0)}
                        onValueCommit={(next) => {
                            engine.seek(next[0] ?? 0);
                            setScrubValue(null);
                        }}
                        aria-label="Seek"
                        className="flex-1 cursor-pointer disabled:opacity-40"
                    />
                    <span className="text-ink-dim w-10 shrink-0 text-[11px] tabular-nums">
                        {canScrub ? formatClock(duration) : '--:--'}
                    </span>
                </div>

                {/* Three fixed zones so the transport cluster is truly centered regardless
                    of how wide the track info or volume sides are. */}
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
                    <div className="flex min-w-0 items-center">
                        <button
                            ref={libraryButtonRef}
                            type="button"
                            onClick={() => toggleOverlay('library')}
                            aria-expanded={libraryOpen}
                            aria-controls="dock-panel-library"
                            aria-label={`${libraryOpen ? 'Close library' : 'Open library'}${
                                queueLabel ? ` — playing from ${queueLabel}` : ''
                            }`}
                            className="group focus-visible:outline-ember -m-1.5 flex min-w-0 items-center gap-3 rounded-lg p-1.5 text-left transition-colors hover:bg-white/5 focus-visible:outline-2"
                        >
                            {currentTrack ? (
                                <TrackArt track={currentTrack} className="h-12 w-12 rounded-md shadow-md" />
                            ) : (
                                <span className="from-night-2 flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-linear-to-br to-black shadow-md">
                                    <Music className="text-ink-dim size-4" aria-hidden />
                                </span>
                            )}
                            {/* On narrow screens the cover + chevron alone carry the affordance;
                                a two-letter truncated title is worse than none. */}
                            <span className="hidden min-w-0 sm:block">
                                <span className="text-ink block truncate text-sm font-medium">
                                    {currentTrack?.title ?? 'Browse the library'}
                                </span>
                                <span className="text-ink-dim block truncate text-xs">
                                    {currentTrack?.artist ?? 'Choose a soundtrack'}
                                </span>
                            </span>
                            {queueLabel && (
                                <span
                                    aria-hidden
                                    className="text-ink-mid hidden shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] md:block"
                                >
                                    {queueLabel}
                                </span>
                            )}
                            <ChevronUp
                                aria-hidden
                                className={cn(
                                    'text-ink-dim group-hover:text-ink-mid size-4 shrink-0 transition-transform duration-200',
                                    libraryOpen && 'rotate-180',
                                )}
                            />
                        </button>
                    </div>

                    {/* Symmetric five-control transport keeps Play on the true center line. */}
                    <div className="flex items-center gap-2 sm:gap-3">
                        <Button
                            variant="ghost"
                            size="icon"
                            className={`rounded-full hover:bg-white/10 ${repeatEnabled ? 'text-ember' : 'text-ink-dim hover:text-ink'}`}
                            onClick={toggleRepeat}
                            aria-label="Repeat track"
                            aria-pressed={repeatEnabled}
                        >
                            <Repeat size={16} />
                        </Button>

                        <Button
                            variant="ghost"
                            size="icon"
                            className="text-ink-mid hover:text-ink rounded-full hover:bg-white/10"
                            onClick={previousTrack}
                            aria-label="Previous track"
                        >
                            <SkipBack size={18} />
                        </Button>

                        <Button
                            size="icon"
                            onClick={togglePlay}
                            className="bg-ember text-night hover:bg-ember/90 h-11 w-11 rounded-full shadow-[0_0_28px_-8px_oklch(0.81_0.1_75/0.6)] [&_svg]:size-[18px]"
                            aria-label={isPlayingStore ? 'Pause' : 'Play'}
                        >
                            {isPlayingStore ? (
                                <Pause fill="currentColor" />
                            ) : (
                                <Play fill="currentColor" className="translate-x-[1px]" />
                            )}
                        </Button>

                        <Button
                            variant="ghost"
                            size="icon"
                            className="text-ink-mid hover:text-ink rounded-full hover:bg-white/10"
                            onClick={nextTrack}
                            aria-label="Next track"
                        >
                            <SkipForward size={18} />
                        </Button>

                        <Button
                            variant="ghost"
                            size="icon"
                            className={`rounded-full hover:bg-white/10 ${isLiked ? 'text-rose-400' : 'text-ink-dim hover:text-ink'}`}
                            onClick={() => currentTrack && toggleLike(currentTrack.id)}
                            disabled={!currentTrack}
                            aria-pressed={isLiked}
                            aria-label={isLiked ? 'Unlike track' : 'Like track'}
                        >
                            <Heart size={16} fill={isLiked ? 'currentColor' : 'none'} />
                        </Button>
                    </div>

                    <div className="flex items-center justify-end gap-2 sm:gap-3">
                        {showStreak && sessionSummary.currentStreak > 0 && (
                            <span className="text-ink-dim hidden text-xs lg:inline">
                                {sessionSummary.currentStreak}-day streak
                            </span>
                        )}
                        <Button
                            ref={ambienceButtonRef}
                            variant="ghost"
                            size="icon"
                            className={cn(
                                'relative rounded-full hover:bg-white/10',
                                ambientCount > 0 ? 'text-ember' : 'text-ink-dim hover:text-ink',
                            )}
                            onClick={() => toggleOverlay('ambience')}
                            aria-expanded={ambienceOpen}
                            aria-controls="dock-panel-ambience"
                            aria-label={
                                ambientCount > 0 ? `Ambience layers (${ambientCount} active)` : 'Ambience layers'
                            }
                        >
                            <Waves size={16} />
                            {ambientCount > 0 && (
                                <span
                                    aria-hidden
                                    className="bg-ember absolute top-1 right-1 h-1.5 w-1.5 rounded-full"
                                />
                            )}
                        </Button>
                        <button
                            onClick={() => (audio.muted ? engine.unmute() : engine.mute())}
                            className="focus-visible:outline-ember rounded p-1 transition hover:bg-white/10 focus-visible:outline-2"
                            title={audio.muted ? 'Unmute' : 'Mute'}
                            aria-label={audio.muted ? 'Unmute' : 'Mute'}
                            aria-pressed={audio.muted}
                        >
                            {audio.muted ? (
                                <VolumeX size={16} className="text-ink-dim" />
                            ) : (
                                <Volume2 size={16} className="text-ink-dim" />
                            )}
                        </button>
                        <div className="hidden w-24 sm:block">
                            <Slider
                                value={volume}
                                onValueChange={setVolume}
                                max={100}
                                step={1}
                                aria-label="Volume"
                                className="cursor-pointer"
                            />
                        </div>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};
