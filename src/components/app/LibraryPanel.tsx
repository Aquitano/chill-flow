'use client';

import { TrackArt } from '@/components/app/TrackArt';
import { deriveScenes, formatDuration, tracksInScene } from '@/lib/tracks';
import { cn } from '@/lib/utils';
import type { Track } from '@/models/app';
import { useAppStore } from '@/store/app-store';
import { motion } from 'framer-motion';
import { Music, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

function SceneChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={onClick}
            className={cn(
                'focus-visible:outline-ember shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2',
                active ? 'bg-ember text-night' : 'text-ink-mid hover:text-ink bg-white/5 hover:bg-white/10',
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

    const [query, setQuery] = useState('');

    const scenes = useMemo(() => deriveScenes(tracks), [tracks]);
    const visibleTracks = tracksInScene(tracks, activeScene);
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const filteredTracks =
        tokens.length === 0
            ? visibleTracks
            : visibleTracks.filter((track) => {
                  const haystack =
                      `${track.title} ${track.artist} ${track.tags.join(' ')} ${track.category ?? ''}`.toLowerCase();
                  return tokens.every((token) => haystack.includes(token));
              });

    // Unfiltered "All" gets scene groups so a large catalog stays scannable;
    // any chip or search collapses back to the flat list.
    const uncategorized = tracks.filter((track) => !track.category?.trim());
    const groupedTracks =
        activeScene === null && tokens.length === 0 && scenes.length > 1
            ? [
                  ...scenes.map((scene, index) => ({
                      key: `scene:${scene.id}`,
                      headingId: `library-group-scene-${index}`,
                      label: scene.label,
                      tracks: tracksInScene(tracks, scene.id),
                  })),
                  ...(uncategorized.length > 0
                      ? [
                            {
                                key: 'uncategorized',
                                headingId: 'library-group-uncategorized',
                                label: 'Other',
                                tracks: uncategorized,
                            },
                        ]
                      : []),
              ]
            : null;

    const renderTrack = (track: Track) => {
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
                    'focus-visible:outline-ember flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2',
                    active ? 'bg-white/8' : 'hover:bg-white/5',
                )}
            >
                <TrackArt track={track} className="h-10 w-10" />
                <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-sm font-medium', active ? 'text-ember' : 'text-ink')}>
                        {track.title}
                    </span>
                    <span className="text-ink-dim block truncate text-xs">{track.artist}</span>
                </span>
                {active && isPlaying && (
                    <span className="eq-playing flex shrink-0 items-end gap-[2px]" aria-hidden>
                        {[0, 0.2, 0.1].map((delay, index) => (
                            <span
                                key={index}
                                className="eq-bar bg-ember h-3 w-[2px] rounded-full"
                                style={{ animationDelay: `${delay}s` }}
                            />
                        ))}
                    </span>
                )}
                <span className="text-ink-dim shrink-0 text-xs tabular-nums">{formatDuration(track.duration)}</span>
            </button>
        );
    };

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
                    className="scrollbar-custom flex items-center gap-1.5 overflow-x-auto [mask-image:linear-gradient(to_right,black,black_calc(100%-1.5rem),transparent)] px-3 pt-3 pb-1.5"
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

            {tracks.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                    <Music className="text-ink-dim size-5" aria-hidden />
                    <p className="text-ink-mid text-sm">No tracks yet</p>
                    <p className="text-ink-dim text-xs">New soundtracks appear here as they land in the catalog.</p>
                </div>
            ) : (
                <>
                    <div className={cn('px-3 pb-2', scenes.length > 0 ? 'pt-0.5' : 'pt-3')}>
                        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5">
                            <Search size={14} className="text-ink-dim shrink-0" aria-hidden />
                            <input
                                type="text"
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder="Search tracks…"
                                aria-label="Search tracks"
                                autoComplete="off"
                                spellCheck={false}
                                className="text-ink placeholder:text-ink-dim min-w-0 flex-1 bg-transparent text-sm outline-none"
                            />
                        </div>
                    </div>

                    {filteredTracks.length === 0 ? (
                        <p className="text-ink-dim px-4 pb-6 text-center text-sm">No tracks match “{query}”</p>
                    ) : (
                        <div
                            role="listbox"
                            aria-label="Tracks"
                            className="scrollbar-custom max-h-[38vh] space-y-0.5 overflow-y-auto px-2 pb-2"
                        >
                            {groupedTracks
                                ? groupedTracks.map((group) => (
                                      <div
                                          key={group.key}
                                          role="group"
                                          aria-labelledby={group.headingId}
                                          className="space-y-0.5"
                                      >
                                          <p
                                              id={group.headingId}
                                              className="text-ink-dim sticky top-0 z-10 bg-black/70 px-2.5 pt-2 pb-1 text-[10px] font-medium tracking-wide uppercase backdrop-blur-md"
                                          >
                                              {group.label}
                                              <span className="ml-1.5 normal-case opacity-60">
                                                  {group.tracks.length}
                                              </span>
                                          </p>
                                          {group.tracks.map(renderTrack)}
                                      </div>
                                  ))
                                : filteredTracks.map(renderTrack)}
                        </div>
                    )}
                </>
            )}
        </motion.section>
    );
}
