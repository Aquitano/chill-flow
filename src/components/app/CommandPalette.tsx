'use client';

import { AMBIENT_LAYERS } from '@/lib/audio/ambient';
import { useAmbient } from '@/lib/audio/useAmbient';
import { deriveScenes, tracksInScene } from '@/lib/tracks';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
    CloudRain,
    Flame,
    Heart,
    ListMusic,
    Moon,
    Music,
    Pause,
    Play,
    Search,
    SkipBack,
    SkipForward,
    SquareCheckBig,
    Timer,
    Waves,
    Wind,
    type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

type PaletteItem = {
    id: string;
    group: 'Tracks' | 'Scenes' | 'Actions';
    label: string;
    sub?: string;
    icon: LucideIcon;
    keywords?: string;
    run: () => void;
};

const AMBIENT_ICONS: Record<string, LucideIcon> = {
    rain: CloudRain,
    wind: Wind,
    embers: Flame,
    deep: Moon,
};

function matchesQuery(item: PaletteItem, query: string): boolean {
    if (!query) return true;
    const haystack = `${item.label} ${item.sub ?? ''} ${item.keywords ?? ''}`.toLowerCase();
    return query
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .every((token) => haystack.includes(token));
}

/**
 * Ctrl/Cmd+K spotlight over the workspace: jump to any track or scene, or fire
 * a player/timer action without leaving the keyboard.
 */
export function CommandPalette() {
    const open = useAppStore((state) => state.activeOverlay === 'palette');
    const setOverlay = useAppStore((state) => state.setOverlay);
    const tracks = useAppStore((state) => state.tracks);
    const { mixer, state: ambient } = useAmbient();

    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (open) {
            setQuery('');
            setActiveIndex(0);
        }
    }, [open]);

    const items = useMemo<PaletteItem[]>(() => {
        // Read volatile player state imperatively: rebuilding the list on every
        // second of playback would churn the memo for nothing.
        const store = useAppStore.getState;
        const close = () => useAppStore.getState().setOverlay(null);

        const trackItems: PaletteItem[] = tracks.map((track) => ({
            id: `track-${track.id}`,
            group: 'Tracks',
            label: track.title,
            sub: track.artist,
            icon: Music,
            keywords: [...track.tags, track.category ?? ''].join(' '),
            run: () => {
                const s = store();
                s.setCurrentTrack(track);
                s.setIsPlaying(true);
                close();
            },
        }));

        const sceneItems: PaletteItem[] = deriveScenes(tracks).map((scene) => ({
            id: `scene-${scene.id}`,
            group: 'Scenes',
            label: scene.label,
            sub: `Scene · ${scene.trackCount} ${scene.trackCount === 1 ? 'track' : 'tracks'}`,
            icon: ListMusic,
            run: () => {
                const s = store();
                s.setActiveScene(scene.id);
                const queue = tracksInScene(s.tracks, scene.id);
                if (queue.length > 0 && !queue.some((track) => track.id === s.currentTrack?.id)) {
                    s.setCurrentTrack(queue[0] ?? null);
                }
                s.setIsPlaying(true);
                close();
            },
        }));

        const snapshot = store();
        const actionItems: PaletteItem[] = [
            {
                id: 'action-play',
                group: 'Actions',
                label: snapshot.isPlaying ? 'Pause music' : 'Play music',
                icon: snapshot.isPlaying ? Pause : Play,
                run: () => {
                    store().togglePlay();
                    close();
                },
            },
            {
                id: 'action-next',
                group: 'Actions',
                label: 'Next track',
                icon: SkipForward,
                run: () => {
                    store().nextTrack();
                    close();
                },
            },
            {
                id: 'action-previous',
                group: 'Actions',
                label: 'Previous track',
                icon: SkipBack,
                run: () => {
                    store().previousTrack();
                    close();
                },
            },
            ...(snapshot.currentTrack
                ? [
                      {
                          id: 'action-like',
                          group: 'Actions' as const,
                          label: snapshot.likedTrackIds.includes(snapshot.currentTrack.id)
                              ? 'Unlike current track'
                              : 'Like current track',
                          icon: Heart,
                          run: () => {
                              const s = store();
                              if (s.currentTrack) s.toggleTrackLike(s.currentTrack.id);
                              close();
                          },
                      },
                  ]
                : []),
            ...(snapshot.modes[snapshot.currentMode]?.showTimer
                ? [
                      {
                          id: 'action-timer',
                          group: 'Actions' as const,
                          label: snapshot.timerActive ? 'Pause timer' : 'Start timer',
                          icon: Timer,
                          run: () => {
                              const s = store();
                              if (s.timerActive) s.pauseTimer();
                              else s.startTimer();
                              close();
                          },
                      },
                  ]
                : []),
            {
                id: 'action-tasks',
                group: 'Actions',
                label: 'Toggle tasks',
                icon: SquareCheckBig,
                run: () => {
                    store().toggleTasks();
                    close();
                },
            },
            {
                id: 'action-library',
                group: 'Actions',
                label: 'Open library',
                sub: 'L',
                icon: ListMusic,
                keywords: 'tracks playlist browse',
                run: () => store().setOverlay('library'),
            },
            {
                id: 'action-ambience',
                group: 'Actions',
                label: 'Open ambience mixer',
                sub: 'A',
                icon: Waves,
                keywords: 'noise background sound mixer',
                run: () => store().setOverlay('ambience'),
            },
            ...AMBIENT_LAYERS.map((layer) => ({
                id: `action-ambient-${layer.id}`,
                group: 'Actions' as const,
                label: `${ambient[layer.id].enabled ? 'Turn off' : 'Turn on'} ${layer.label.toLowerCase()}`,
                sub: layer.hint,
                icon: AMBIENT_ICONS[layer.id] ?? Waves,
                keywords: 'ambience ambient layer noise',
                run: () => {
                    mixer.toggleLayer(layer.id);
                    close();
                },
            })),
        ];

        return [...trackItems, ...sceneItems, ...actionItems];
        // `open` retriggers the snapshot so labels (Play/Pause, timer) are fresh per opening.
    }, [tracks, ambient, mixer, open]);

    const filtered = useMemo(() => items.filter((item) => matchesQuery(item, query)), [items, query]);
    const clampedIndex = Math.min(activeIndex, Math.max(0, filtered.length - 1));
    const activeItem = filtered[clampedIndex];

    useEffect(() => {
        if (!activeItem) return;
        const node = listRef.current?.querySelector(`[data-item-id="${CSS.escape(activeItem.id)}"]`);
        node?.scrollIntoView({ block: 'nearest' });
    }, [activeItem]);

    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex(filtered.length ? (clampedIndex + 1) % filtered.length : 0);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex(filtered.length ? (clampedIndex - 1 + filtered.length) % filtered.length : 0);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            activeItem?.run();
        }
    };

    let lastGroup: PaletteItem['group'] | null = null;

    return (
        <DialogPrimitive.Root open={open} onOpenChange={(next) => setOverlay(next ? 'palette' : null)}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
                <DialogPrimitive.Content
                    onKeyDown={handleKeyDown}
                    className="fixed top-[16%] left-1/2 z-50 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-white/10 bg-night-2/95 shadow-[0_40px_80px_-32px_rgba(0,0,0,0.9)] backdrop-blur-xl duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none"
                >
                    <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
                    <DialogPrimitive.Description className="sr-only">
                        Search tracks, scenes, and workspace actions
                    </DialogPrimitive.Description>

                    <div className="flex items-center gap-3 border-b border-white/8 px-4 py-3">
                        <Search size={15} className="shrink-0 text-ink-dim" aria-hidden />
                        <input
                            value={query}
                            onChange={(event) => {
                                setQuery(event.target.value);
                                setActiveIndex(0);
                            }}
                            role="combobox"
                            aria-expanded="true"
                            aria-controls="palette-results"
                            aria-activedescendant={activeItem ? `palette-item-${activeItem.id}` : undefined}
                            aria-label="Search tracks, scenes, and actions"
                            placeholder="Search tracks, scenes, actions…"
                            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-dim"
                            autoComplete="off"
                            spellCheck={false}
                        />
                        <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-ink-dim">
                            esc
                        </kbd>
                    </div>

                    <div
                        ref={listRef}
                        id="palette-results"
                        role="listbox"
                        aria-label="Results"
                        className="max-h-[46vh] overflow-y-auto p-2"
                    >
                        {filtered.length === 0 ? (
                            <p className="px-3 py-8 text-center text-sm text-ink-dim">
                                Nothing matches “{query}”
                            </p>
                        ) : (
                            filtered.map((item, index) => {
                                const showHeading = item.group !== lastGroup;
                                lastGroup = item.group;
                                const active = index === clampedIndex;
                                const Icon = item.icon;
                                return (
                                    <div key={item.id}>
                                        {showHeading && (
                                            <p
                                                aria-hidden
                                                className="px-3 pt-2 pb-1 text-[10px] font-medium tracking-wide text-ink-dim uppercase"
                                            >
                                                {item.group}
                                            </p>
                                        )}
                                        <button
                                            type="button"
                                            id={`palette-item-${item.id}`}
                                            data-item-id={item.id}
                                            role="option"
                                            aria-selected={active}
                                            onClick={() => item.run()}
                                            onPointerMove={() => setActiveIndex(index)}
                                            className={cn(
                                                'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors',
                                                active ? 'bg-white/8 text-ink' : 'text-ink-mid',
                                            )}
                                        >
                                            <Icon size={15} className={cn('shrink-0', active ? 'text-ember' : 'text-ink-dim')} aria-hidden />
                                            <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
                                            {item.sub && (
                                                <span className="shrink-0 truncate text-xs text-ink-dim">{item.sub}</span>
                                            )}
                                        </button>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    <p className="flex items-center gap-3 border-t border-white/8 px-4 py-2 text-[11px] text-ink-dim">
                        <span>↑↓ navigate</span>
                        <span>↵ select</span>
                    </p>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}
