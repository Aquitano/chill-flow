'use client';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useUpdatePreferencesMutation } from '@/hooks/use-app-data';
import { useAudioEngineState } from '@/lib/audio/useAudioEngine';
import { useAppStore } from '@/store/app-store';
import { motion } from 'framer-motion';
import { Heart, Music, Pause, Play, Repeat, SkipBack, SkipForward, ThumbsDown, Volume2 } from 'lucide-react';
import { useEffect } from 'react';

export const PlayerControls: React.FC = () => {
    const { engine, state: audio } = useAudioEngineState();
    const updatePreferences = useUpdatePreferencesMutation();

    const isPlayingStore = useAppStore((state) => state.isPlaying);
    const volume = useAppStore((state) => state.volume);
    const togglePlay = useAppStore((state) => state.togglePlay);
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

    useEffect(() => {
        const persisted = Math.round((engine.getMasterVolume?.() ?? 0.5) * 100);
        if ((volume?.[0] ?? 50) !== persisted) {
            setVolume([persisted]);
        }
    }, [engine, setVolume, volume]);

    useEffect(() => {
        try {
            engine.setMasterVolume((volume?.[0] ?? 50) / 100);
        } catch {
            // Ignore engine sync failures here and allow playback UI to remain responsive.
        }
    }, [engine, volume]);

    useEffect(() => {
        if (isPlayingStore !== audio.isPlaying) {
            togglePlay();
        }
    }, [audio.isPlaying, isPlayingStore, togglePlay]);

    useEffect(() => {
        const url = currentTrack?.audioUrl;
        if (!url) return;

        engine.loadMainTrack(url).catch(() => {
            // Playback error is surfaced by the engine debug logger.
        });
    }, [currentTrack?.audioUrl, engine]);

    const handleTogglePlay = async () => {
        try {
            if (audio.isPlaying) {
                engine.pause();
                return;
            }

            if (!engine.hasMainTrack() && currentTrack?.audioUrl) {
                await engine.loadMainTrack(currentTrack.audioUrl);
            }

            await engine.play();
        } catch {
            // The UI stays interactive while the debug tooling captures the failure.
        }
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
            className="absolute right-0 bottom-0 left-0 z-30 flex items-center justify-between gap-4 bg-black/60 p-4 backdrop-blur-md"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.8 }}
        >
            <div className="flex min-w-0 items-center space-x-4">
                <div className="h-12 w-12 rounded-md bg-linear-to-br from-stone-400 to-stone-600 shadow-md" />
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
                    >
                        <Heart size={16} />
                    </Button>
                    <Button variant="ghost" size="icon" className="rounded-full hover:bg-white/10" onClick={nextTrack}>
                        <ThumbsDown size={16} />
                    </Button>
                </div>
            </div>

            <div className="flex items-center space-x-3">
                <Button variant="ghost" size="icon" className="rounded-full hover:bg-white/10" onClick={previousTrack}>
                    <SkipBack size={18} />
                </Button>

                <Button onClick={handleTogglePlay} className="h-10 w-10 rounded-full bg-white/20 hover:bg-white/30">
                    {audio.isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
                </Button>

                <Button variant="ghost" size="icon" className="rounded-full hover:bg-white/10" onClick={nextTrack}>
                    <SkipForward size={18} />
                </Button>

                <Button
                    variant="ghost"
                    size="icon"
                    className={`rounded-full hover:bg-white/10 ${repeatEnabled ? 'text-emerald-400' : ''}`}
                    onClick={toggleRepeat}
                >
                    <Repeat size={16} />
                </Button>
            </div>

            <div className="flex items-center space-x-3">
                <div className="hidden items-center space-x-2 md:flex">
                    <Button variant="ghost" size="icon" className="rounded-full hover:bg-white/10">
                        <Music size={16} />
                    </Button>
                </div>

                <div className="flex items-center space-x-2">
                    <button
                        onClick={() => (audio.muted ? engine.unmute() : engine.mute())}
                        title={audio.muted ? 'Unmute' : 'Mute'}
                    >
                        <Volume2 size={16} className="text-stone-400" />
                    </button>
                    <div className="w-24">
                        <Slider
                            value={volume}
                            onValueChange={setVolume}
                            max={100}
                            step={1}
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
        </motion.div>
    );
};
