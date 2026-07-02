'use client';

import { TrackArt } from '@/components/app/TrackArt';
import { deriveScenes, formatDuration, tracksInScene } from '@/lib/tracks';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { motion } from 'framer-motion';
import { Music } from 'lucide-react';
import { useMemo } from 'react';

function SceneChip({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={onClick}
            className={cn(
                'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ember',
                active ? 'bg-ember text-night' : 'bg-white/5 text-ink-mid hover:bg-white/10 hover:text-ink',
            )}
        >
            {children}
        </button>
    );
}

/**
 * Expandable library above the player bar: scene chips (derived from real track
 * categories) filter both the visible list and the next/previous play queue.
 */
export function LibraryPanel() {
    const tracks = useAppStore((state) => state.tracks);
    const currentTrack = useAppStore((state) => state.currentTrack);
    const isPlaying = useAppStore((state) => state.isPlaying);
    const setCurrentTrack = useAppStore((state) => state.setCurrentTrack);
    const setIsPlaying = useAppStore((state) => state.setIsPlaying);
    const activeScene = useAppStore((state) => state.activeScene);
    const setActiveScene = useAppStore((state) => state.setActiveScene);

    const scenes = useMemo(() => deriveScenes(tracks), [tracks]);
    const visibleTracks = tracksInScene(tracks, activeScene);

    return (
        <motion.section
            id="dock-panel-library"
            data-workspace-panel
            aria-label="Library"
            initial={{ opacity: 0, y: 12, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.99 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-auto mb-3 ml-4 w-[min(38rem,calc(100vw-2rem))] self-start overflow-hidden rounded-2xl border border-white/10 bg-black/75 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.85)] backdrop-blur-xl"
        >
            {scenes.length > 0 && (
                <div
                    className="scrollbar-custom flex items-center gap-1.5 overflow-x-auto px-3 pt-3 pb-1.5"
                    role="group"
                    aria-label="Scenes"
                >
                    <SceneChip active={activeScene === null} onClick={() => setActiveScene(null)}>
                        All
                    </SceneChip>
                    {scenes.map((scene) => (
                        <SceneChip
                            key={scene.id}
                            active={activeScene === scene.id}
                            onClick={() => setActiveScene(activeScene === scene.id ? null : scene.id)}
                        >
                            {scene.label}
                            <span className="ml-1.5 opacity-60">{scene.trackCount}</span>
                        </SceneChip>
                    ))}
                </div>
            )}

            {visibleTracks.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                    <Music className="size-5 text-ink-dim" aria-hidden />
                    <p className="text-sm text-ink-mid">No tracks yet</p>
                    <p className="text-xs text-ink-dim">New soundtracks appear here as they land in the catalog.</p>
                </div>
            ) : (
                <div role="listbox" aria-label="Tracks" className="scrollbar-custom max-h-[38vh] space-y-0.5 overflow-y-auto p-2">
                    {visibleTracks.map((track) => {
                        const active = currentTrack?.id === track.id;
                        return (
                            <button
                                key={track.id}
                                type="button"
                                role="option"
                                aria-selected={active}
                                onClick={() => {
                                    setCurrentTrack(track);
                                    setIsPlaying(true);
                                }}
                                className={cn(
                                    'flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ember',
                                    active ? 'bg-white/8' : 'hover:bg-white/5',
                                )}
                            >
                                <TrackArt track={track} className="h-10 w-10" />
                                <span className="min-w-0 flex-1">
                                    <span
                                        className={cn(
                                            'block truncate text-sm font-medium',
                                            active ? 'text-ember' : 'text-ink',
                                        )}
                                    >
                                        {track.title}
                                    </span>
                                    <span className="block truncate text-xs text-ink-dim">{track.artist}</span>
                                </span>
                                {active && isPlaying && (
                                    <span className="eq-playing flex shrink-0 items-end gap-[2px]" aria-hidden>
                                        {[0, 0.2, 0.1].map((delay, index) => (
                                            <span
                                                key={index}
                                                className="eq-bar h-3 w-[2px] rounded-full bg-ember"
                                                style={{ animationDelay: `${delay}s` }}
                                            />
                                        ))}
                                    </span>
                                )}
                                <span className="shrink-0 text-xs tabular-nums text-ink-dim">
                                    {formatDuration(track.duration)}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}
        </motion.section>
    );
}
