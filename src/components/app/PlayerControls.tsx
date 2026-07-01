'use client';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useUpdatePreferencesMutation } from '@/hooks/use-app-data';
import { useAudioEngineState } from '@/lib/audio/useAudioEngine';
import { useAppStore } from '@/store/app-store';
import { motion } from 'framer-motion';
import { Heart, Pause, Play, Repeat, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

// Single toast id so the concurrent signals for one failure (the rejected load/play
// promise and the element's 'error' event) collapse into one notification, and a later
// failure replaces the old toast instead of stacking.
const AUDIO_ERROR_TOAST_ID = 'audio-error';

/** Format a number of seconds as m:ss (or h:mm:ss past an hour). */
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

export const PlayerControls: React.FC = () => {
    const { engine, state: audio } = useAudioEngineState();
    const updatePreferences = useUpdatePreferencesMutation();

    const isPlayingStore = useAppStore((state) => state.isPlaying);
    const volume = useAppStore((state) => state.volume);
    const togglePlay = useAppStore((state) => state.togglePlay);
    const setIsPlaying = useAppStore((state) => state.setIsPlaying);
    const setVolume = useAppStore((state) => state.setVolume);
    const currentTrack = useAppStore((state) => state.currentTrack);
    const likedTrackIds = useAppStore((state) => state.likedTrackIds);
    const toggleTrackLike = useAppStore((state) => state.toggleTrackLike);
    const previousTrack = useAppStore((state) => state.previousTrack);
    const nextTrack = useAppStore((state) => state.nextTrack);
    const repeatEnabled = useAppStore((state) => state.repeatEnabled);
    const toggleRepeat = useAppStore((state) => state.toggleRepeat);
    const currentMode = useAppStore((state) => state.currentMode);
    const modes = useAppStore((state) => state.modes);
    const sessionSummary = useAppStore((state) => state.sessionSummary);

    const showStreak = modes[currentMode]?.showStreak ?? false;
    const isLiked = currentTrack ? likedTrackIds.includes(currentTrack.id) : false;

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

    // The Zustand store's `isPlaying` is the single source of truth for playback
    // intent. The engine is driven FROM the store (below), so any path that flips
    // `isPlaying` — the player button, the focus timer's startTimer, etc. — actually
    // starts audio. A ref mirrors the latest intent for use inside async callbacks.
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

    // Keep the engine's loop flag in sync with the Repeat toggle.
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

    // Drive the engine from playback intent. play() must run inside the user gesture
    // that flipped `isPlaying` (button click / timer start), which this effect does.
    useEffect(() => {
        if (isPlayingStore) {
            if (!engine.hasMainTrack()) return; // the load effect resumes once ready
            engine.play().catch((err) => reportAudioFailure(toAudioErrorMessage(err)));
        } else {
            engine.pause();
        }
    }, [isPlayingStore, engine, reportAudioFailure]);

    // When a track ends naturally (loop disabled), advance to the next one. With
    // Repeat enabled the engine loops the element, so no `ended` event fires.
    useEffect(() => {
        const handleEnded = () => {
            // With a single-track catalog, "next" resolves to the same track, so the
            // URL-keyed load effect won't re-fire — restart it explicitly instead of
            // dead-stopping at the end (which would also leave the UI showing "Pause").
            if (useAppStore.getState().tracks.length <= 1) {
                engine.seek(0);
                engine.play().catch((err) => reportAudioFailure(toAudioErrorMessage(err)));
                return;
            }
            nextTrack();
        };
        engine.addEventListener('ended', handleEnded);
        return () => engine.removeEventListener('ended', handleEnded);
    }, [engine, nextTrack, reportAudioFailure]);

    const handleTogglePlay = () => {
        togglePlay();
    };

    const handleLikeToggle = () => {
        if (!currentTrack) return;
        const nextLikes = isLiked
            ? likedTrackIds.filter((trackId) => trackId !== currentTrack.id)
            : [...likedTrackIds, currentTrack.id];

        toggleTrackLike(currentTrack.id);
        updatePreferences.mutate({ likedTrackIds: nextLikes });
    };

    return (
        <motion.div
            data-player-bar
            className="absolute right-0 bottom-0 left-0 z-30 flex flex-col gap-3 bg-black/60 p-4 backdrop-blur-md"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.8 }}
        >
            <div className="flex items-center gap-3">
                <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-stone-400">
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
                <span className="w-10 shrink-0 text-[11px] tabular-nums text-stone-400">
                    {canScrub ? formatClock(duration) : '--:--'}
                </span>
            </div>

            <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center space-x-4">
                {currentTrack?.thumbnailUrl ? (
                    <img
                        src={currentTrack.thumbnailUrl}
                        alt=""
                        className="h-12 w-12 rounded-md object-cover shadow-md"
                    />
                ) : (
                    <div className="h-12 w-12 rounded-md bg-linear-to-br from-stone-400 to-stone-600 shadow-md" />
                )}
                <div className="min-w-0 text-left">
                    <h2 className="truncate text-base font-semibold">{currentTrack?.title ?? 'Select a track'}</h2>
                    <p className="truncate text-sm text-stone-400">{currentTrack?.artist ?? 'Track catalog ready'}</p>
                </div>
                <div className="hidden items-center space-x-2 md:flex">
                    <Button
                        variant="ghost"
                        size="icon"
                        className={`rounded-full hover:bg-white/10 ${isLiked ? 'text-rose-400' : ''}`}
                        onClick={handleLikeToggle}
                        disabled={!currentTrack}
                        aria-pressed={isLiked}
                        aria-label={isLiked ? 'Unlike track' : 'Like track'}
                    >
                        <Heart size={16} />
                    </Button>
                </div>
            </div>

            <div className="flex items-center space-x-3">
                <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full hover:bg-white/10"
                    onClick={previousTrack}
                    aria-label="Previous track"
                >
                    <SkipBack size={18} />
                </Button>

                <Button
                    onClick={handleTogglePlay}
                    className="h-10 w-10 rounded-full bg-white/20 hover:bg-white/30"
                    aria-label={isPlayingStore ? 'Pause' : 'Play'}
                >
                    {isPlayingStore ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
                </Button>

                <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full hover:bg-white/10"
                    onClick={nextTrack}
                    aria-label="Next track"
                >
                    <SkipForward size={18} />
                </Button>

                <Button
                    variant="ghost"
                    size="icon"
                    className={`rounded-full hover:bg-white/10 ${repeatEnabled ? 'text-emerald-400' : ''}`}
                    onClick={toggleRepeat}
                    aria-label="Repeat track"
                    aria-pressed={repeatEnabled}
                >
                    <Repeat size={16} />
                </Button>
            </div>

            <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-2">
                    <button
                        onClick={() => (audio.muted ? engine.unmute() : engine.mute())}
                        title={audio.muted ? 'Unmute' : 'Mute'}
                        aria-label={audio.muted ? 'Unmute' : 'Mute'}
                        aria-pressed={audio.muted}
                    >
                        {audio.muted ? (
                            <VolumeX size={16} className="text-stone-400" />
                        ) : (
                            <Volume2 size={16} className="text-stone-400" />
                        )}
                    </button>
                    <div className="w-24">
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

                {showStreak && (
                    <div className="ml-1 flex items-center space-x-1 rounded-full bg-stone-800/70 px-2 py-1">
                        <span className="text-xs font-medium text-stone-300">
                            {sessionSummary.currentStreak}-day streak
                        </span>
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-linear-to-br from-yellow-400 to-orange-500 text-xs font-bold">
                            ✓
                        </span>
                    </div>
                )}
                </div>
            </div>
        </motion.div>
    );
};
