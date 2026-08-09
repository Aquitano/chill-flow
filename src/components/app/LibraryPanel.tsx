'use client';

import { TrackArt } from '@/components/app/TrackArt';
import { useTrackLike } from '@/hooks/use-track-like';
import { buildLibraryView } from '@/lib/library-view';
import { LIKED_SCENE, deriveScenes, formatDuration } from '@/lib/tracks';
import { cn } from '@/lib/utils';
import type { Track } from '@/models/app';
import { useAppStore } from '@/store/app-store';
import { motion } from 'framer-motion';
import { Heart, Music, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

function SceneChip({
    active,
    label,
    onClick,
    children,
}: {
    active: boolean;
    label?: string;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            aria-pressed={active}
            aria-label={label}
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
 * categories, plus the user's likes) filter both the visible list and the next/previous
 * play queue. The search field owns the keyboard — arrows move the highlight, Enter plays
 * it — so picking a track never needs the mouse.
 */
export function LibraryPanel() {
    const tracks = useAppStore((state) => state.tracks);
    const currentTrack = useAppStore((state) => state.currentTrack);
    const isPlaying = useAppStore((state) => state.isPlaying);
    const likedTrackIds = useAppStore((state) => state.likedTrackIds);
    const setCurrentTrack = useAppStore((state) => state.setCurrentTrack);
    const setIsPlaying = useAppStore((state) => state.setIsPlaying);
    const setOverlay = useAppStore((state) => state.setOverlay);
    const activeScene = useAppStore((state) => state.activeScene);
    const setActiveScene = useAppStore((state) => state.setActiveScene);
    const toggleLike = useTrackLike();

    const [query, setQuery] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const scenes = useMemo(() => deriveScenes(tracks), [tracks]);
    const showChips = scenes.length > 0 || likedTrackIds.length > 0;
    const { sections, rows, widened } = useMemo(
        () => buildLibraryView({ tracks, activeScene, likedTrackIds, query }),
        [tracks, activeScene, likedTrackIds, query],
    );

    // The highlight opens on the track already playing, so the arrows step out from where
    // the user actually is rather than from the top of the catalog.
    const [highlight, setHighlight] = useState(() => {
        const playingIndex = rows.findIndex((track) => track.id === currentTrack?.id);
        return playingIndex >= 0 ? playingIndex : 0;
    });
    const highlightedIndex = Math.min(highlight, Math.max(0, rows.length - 1));
    const highlighted = rows[highlightedIndex];
    const rowIndexById = useMemo(() => new Map(rows.map((track, index) => [track.id, index])), [rows]);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    // Retuning the filter or the search invalidates where the highlight sat, so it goes
    // back to the top match. The mount pass is skipped so it can't undo the opening choice.
    const filterKey = `${activeScene}:${query}`;
    const lastFilterRef = useRef(filterKey);
    useEffect(() => {
        if (lastFilterRef.current === filterKey) return;
        lastFilterRef.current = filterKey;
        setHighlight(0);
    }, [filterKey]);

    useEffect(() => {
        if (!highlighted) return;
        listRef.current
            ?.querySelector(`[data-track-id="${CSS.escape(highlighted.id)}"]`)
            ?.scrollIntoView({ block: 'nearest' });
    }, [highlighted]);

    const play = (track: Track) => {
        setCurrentTrack(track);
        setIsPlaying(true);
    };

    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            // Clear a search before closing, so one key never throws away both.
            if (query) setQuery('');
            else setOverlay(null);
            return;
        }

        // The row buttons handle their own activation; only the search field drives the list.
        if (event.target instanceof Element && event.target.closest('button')) return;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setHighlight(rows.length ? (highlightedIndex + 1) % rows.length : 0);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlight(rows.length ? (highlightedIndex - 1 + rows.length) % rows.length : 0);
        } else if (event.key === 'Home') {
            event.preventDefault();
            setHighlight(0);
        } else if (event.key === 'End') {
            event.preventDefault();
            setHighlight(Math.max(0, rows.length - 1));
        } else if (event.key === 'Enter' && highlighted) {
            event.preventDefault();
            play(highlighted);
        }
    };

    const renderTrack = (track: Track) => {
        const active = currentTrack?.id === track.id;
        const isHighlighted = highlighted?.id === track.id;
        const liked = likedTrackIds.includes(track.id);
        return (
            <div key={track.id} role="presentation" className="group relative">
                <button
                    type="button"
                    role="option"
                    id={`library-track-${track.id}`}
                    data-track-id={track.id}
                    aria-selected={active}
                    onClick={() => play(track)}
                    onPointerMove={() => setHighlight(rowIndexById.get(track.id) ?? 0)}
                    className={cn(
                        'focus-visible:outline-ember flex w-full items-center gap-3 rounded-xl py-2 pr-11 pl-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2',
                        active ? 'bg-white/8' : isHighlighted ? 'bg-white/5' : 'hover:bg-white/5',
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
                <button
                    type="button"
                    onClick={() => toggleLike(track.id)}
                    aria-pressed={liked}
                    aria-label={liked ? `Unlike ${track.title}` : `Like ${track.title}`}
                    className={cn(
                        'focus-visible:outline-ember absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1.5 transition hover:bg-white/10 focus-visible:opacity-100 focus-visible:outline-2',
                        liked
                            ? 'text-rose-400 opacity-100'
                            : 'text-ink-dim hover:text-ink opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100',
                    )}
                >
                    <Heart size={14} fill={liked ? 'currentColor' : 'none'} aria-hidden />
                </button>
            </div>
        );
    };

    return (
        <motion.section
            id="dock-panel-library"
            data-workspace-panel
            aria-label="Library"
            onKeyDown={handleKeyDown}
            initial={{ opacity: 0, y: 12, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.99 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-auto mb-3 ml-4 w-[min(38rem,calc(100vw-2rem))] self-start overflow-hidden rounded-2xl border border-white/10 bg-black/75 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.85)] backdrop-blur-xl"
        >
            {showChips && (
                <div
                    className="scrollbar-custom flex items-center gap-1.5 overflow-x-auto [mask-image:linear-gradient(to_right,black,black_calc(100%-1.5rem),transparent)] px-3 pt-3 pb-1.5"
                    role="group"
                    aria-label="Scenes"
                >
                    <SceneChip active={activeScene === null} onClick={() => setActiveScene(null)}>
                        All
                    </SceneChip>
                    {likedTrackIds.length > 0 && (
                        <SceneChip
                            active={activeScene === LIKED_SCENE}
                            label={`Liked tracks (${likedTrackIds.length})`}
                            onClick={() => setActiveScene(activeScene === LIKED_SCENE ? null : LIKED_SCENE)}
                        >
                            <span className="flex items-center gap-1.5">
                                <Heart size={11} fill="currentColor" aria-hidden />
                                <span aria-hidden>{likedTrackIds.length}</span>
                            </span>
                        </SceneChip>
                    )}
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
                    <div className={cn('px-3 pb-2', showChips ? 'pt-0.5' : 'pt-3')}>
                        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5">
                            <Search size={14} className="text-ink-dim shrink-0" aria-hidden />
                            <input
                                ref={inputRef}
                                type="text"
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder="Search tracks…"
                                role="combobox"
                                aria-expanded
                                aria-controls="library-tracks"
                                aria-activedescendant={highlighted ? `library-track-${highlighted.id}` : undefined}
                                aria-label="Search tracks"
                                autoComplete="off"
                                spellCheck={false}
                                className="text-ink placeholder:text-ink-dim min-w-0 flex-1 bg-transparent text-sm outline-none"
                            />
                        </div>
                    </div>

                    {rows.length === 0 ? (
                        <p className="text-ink-dim px-4 pb-6 text-center text-sm">No tracks match “{query}”</p>
                    ) : (
                        <>
                            {widened && (
                                <p className="text-ink-dim px-4 pb-1.5 text-xs">
                                    Nothing here matches “{query}” — showing the whole library.
                                </p>
                            )}
                            <div
                                ref={listRef}
                                id="library-tracks"
                                role="listbox"
                                aria-label="Tracks"
                                className="scrollbar-custom max-h-[38vh] space-y-0.5 overflow-y-auto px-2 pb-2"
                            >
                                {sections.map((section) => (
                                    <div
                                        key={section.key}
                                        role="group"
                                        aria-labelledby={section.label ? section.headingId : undefined}
                                        className="space-y-0.5"
                                    >
                                        {section.label && (
                                            <p
                                                id={section.headingId}
                                                className="text-ink-dim sticky top-0 z-10 bg-black/70 px-2.5 pt-2 pb-1 text-[10px] font-medium tracking-wide uppercase backdrop-blur-md"
                                            >
                                                {section.label}
                                                <span className="ml-1.5 normal-case opacity-60">
                                                    {section.tracks.length}
                                                </span>
                                            </p>
                                        )}
                                        {section.tracks.map(renderTrack)}
                                    </div>
                                ))}
                            </div>
                        </>
                    )}

                    <p className="text-ink-dim flex items-center gap-3 border-t border-white/8 px-4 py-2 text-[11px]">
                        <span>↑↓ browse</span>
                        <span>↵ play</span>
                        <span>esc close</span>
                    </p>
                </>
            )}
        </motion.section>
    );
}
