'use client';

import { ambientCategoryIcon } from '@/components/app/ambient-icons';
import { useAmbient } from '@/lib/audio/useAmbient';
import { LIKE_LIMIT_TOAST } from '@/lib/likes';
import { LIKED_SCENE, deriveScenes, tracksInScene } from '@/lib/tracks';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
    Heart,
    Keyboard,
    ListMusic,
    Music,
    Pause,
    Play,
    Repeat,
    Search,
    SkipBack,
    SkipForward,
    Sparkles,
    SquareCheckBig,
    Target,
    Timer,
    Waves,
    type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

type PaletteItem = {
    id: string;
    group: 'Tracks' | 'Scenes' | 'Tasks' | 'Actions';
    label: string;
    sub?: string;
    icon: LucideIcon;
    keywords?: string;
    run: () => void;
};

/**
 * A typed query is nearly always aimed at a track, so matches lead. An empty one means the
 * palette was opened to *do* something — with a large catalog, actions would otherwise sit
 * a hundred rows below the fold.
 */
const SEARCH_GROUP_ORDER: PaletteItem['group'][] = ['Tracks', 'Scenes', 'Tasks', 'Actions'];
const IDLE_GROUP_ORDER: PaletteItem['group'][] = ['Actions', 'Tasks', 'Scenes', 'Tracks'];

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
    const tasks = useAppStore((state) => state.tasks);
    const { mixer, board, sounds: ambientSounds, powered } = useAmbient();

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

        const snapshot = store();

        const trackItems: PaletteItem[] = tracks.map((track) => ({
            id: `track-${track.id}`,
            group: 'Tracks',
            label: track.title,
            sub: snapshot.currentTrack?.id === track.id ? `${track.artist} · Playing` : track.artist,
            icon: Music,
            keywords: [...track.tags, track.category ?? ''].join(' '),
            run: () => {
                const s = store();
                s.setCurrentTrack(track);
                s.setIsPlaying(true);
                close();
            },
        }));

        const playScene = (sceneId: string) => {
            const s = store();
            s.setActiveScene(sceneId);
            const queue = tracksInScene(s.tracks, sceneId, s.likedTrackIds);
            if (queue.length > 0 && !queue.some((track) => track.id === s.currentTrack?.id)) {
                s.setCurrentTrack(queue[0] ?? null);
            }
            s.setIsPlaying(true);
            close();
        };

        const trackCountLabel = (count: number) => `Scene · ${count} ${count === 1 ? 'track' : 'tracks'}`;

        const sceneItems: PaletteItem[] = [
            ...(snapshot.likedTrackIds.length > 0
                ? [
                      {
                          id: 'scene-liked',
                          group: 'Scenes' as const,
                          label: 'Liked tracks',
                          sub: trackCountLabel(tracksInScene(tracks, LIKED_SCENE, snapshot.likedTrackIds).length),
                          icon: Heart,
                          keywords: 'liked favourites favorites hearts',
                          run: () => playScene(LIKED_SCENE),
                      },
                  ]
                : []),
            ...deriveScenes(tracks).map((scene) => ({
                id: `scene-${scene.id}`,
                group: 'Scenes' as const,
                label: scene.label,
                sub: trackCountLabel(scene.trackCount),
                icon: ListMusic,
                run: () => playScene(scene.id),
            })),
        ];

        const taskItems: PaletteItem[] = tasks
            .filter((task) => !task.isCompleted)
            .map((task) => ({
                id: `task-${task.id}`,
                group: 'Tasks',
                label: task.text,
                sub: snapshot.focusTaskId === task.id ? 'Focusing' : 'Focus on this',
                icon: Target,
                keywords: 'task focus work on',
                run: () => {
                    const s = store();
                    s.setFocusTask(s.focusTaskId === task.id ? null : task.id);
                    close();
                },
            }));

        const actionItems: PaletteItem[] = [
            {
                id: 'action-play',
                group: 'Actions',
                label: snapshot.isPlaying ? 'Pause music' : 'Play music',
                sub: 'Space',
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
                sub: 'N',
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
                sub: 'P',
                icon: SkipBack,
                run: () => {
                    store().previousTrack();
                    close();
                },
            },
            {
                id: 'action-repeat',
                group: 'Actions',
                label: snapshot.repeatEnabled ? 'Turn repeat off' : 'Turn repeat on',
                sub: 'R',
                icon: Repeat,
                keywords: 'loop repeat',
                run: () => {
                    store().toggleRepeat();
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
                          sub: 'H',
                          icon: Heart,
                          run: () => {
                              const s = store();
                              if (s.currentTrack && s.toggleTrackLike(s.currentTrack.id) === 'limit-reached') {
                                  toast.error(LIKE_LIMIT_TOAST.title, LIKE_LIMIT_TOAST.options);
                              }
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
                          sub: 'S',
                          icon: Timer,
                          run: () => {
                              const s = store();
                              if (s.timerActive) s.pauseTimer();
                              else s.startTimer();
                              close();
                          },
                      },
                      {
                          id: 'action-timer-reset',
                          group: 'Actions' as const,
                          label: 'Reset timer',
                          sub: '⇧S',
                          icon: Timer,
                          keywords: 'timer restart',
                          run: () => {
                              store().resetTimer();
                              close();
                          },
                      },
                  ]
                : []),
            {
                id: 'action-tasks',
                group: 'Actions',
                label: 'Toggle tasks',
                sub: 'T',
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
            {
                id: 'action-ambience-power',
                group: 'Actions' as const,
                label: powered ? 'Turn ambience off' : 'Turn ambience on',
                sub: '⇧A',
                icon: Waves,
                keywords: 'ambience ambient noise power mute',
                run: () => {
                    mixer.setPowered(!powered);
                    close();
                },
            },
            ...Object.entries(snapshot.modes).map(([name, mode], index) => ({
                id: `action-mode-${name}`,
                group: 'Actions' as const,
                label: `Switch to ${mode.label}`,
                sub: index < 4 ? `${index + 1}` : undefined,
                icon: Sparkles,
                keywords: `mode workspace ${mode.description}`,
                run: () => {
                    store().setMode(name);
                    close();
                },
            })),
            {
                id: 'action-shortcuts',
                group: 'Actions' as const,
                label: 'Keyboard shortcuts',
                sub: '?',
                icon: Keyboard,
                keywords: 'help hotkeys keys reference',
                run: () => store().openMenuSection('shortcuts'),
            },
            ...board.flatMap((slot, index) => {
                const sound = slot ? ambientSounds.find((entry) => entry.id === slot.soundId) : undefined;
                if (!slot || !sound) return [];
                return [
                    {
                        id: `action-ambient-${sound.id}`,
                        group: 'Actions' as const,
                        label: `${slot.muted ? 'Turn on' : 'Turn off'} ${sound.label.toLowerCase()}`,
                        sub: sound.category,
                        icon: ambientCategoryIcon(sound.category),
                        keywords: 'ambience ambient layer noise',
                        run: () => {
                            if (!powered && slot.muted) mixer.setPowered(true);
                            mixer.toggleSlotMute(index);
                            close();
                        },
                    },
                ];
            }),
        ];

        return [...trackItems, ...sceneItems, ...taskItems, ...actionItems];
        // `open` retriggers the snapshot so labels (Play/Pause, timer) are fresh per opening.
    }, [tracks, tasks, board, ambientSounds, powered, mixer, open]);

    const filtered = useMemo(() => {
        const order = query ? SEARCH_GROUP_ORDER : IDLE_GROUP_ORDER;
        // Sort is stable, so each group keeps the order it was built in.
        return items
            .filter((item) => matchesQuery(item, query))
            .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
    }, [items, query]);
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
                <DialogPrimitive.Overlay className="data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] motion-reduce:animate-none" />
                <DialogPrimitive.Content
                    onKeyDown={handleKeyDown}
                    className="bg-night-2/95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 fixed top-[16%] left-1/2 z-50 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-white/10 shadow-[0_40px_80px_-32px_rgba(0,0,0,0.9)] backdrop-blur-xl duration-200 motion-reduce:animate-none"
                >
                    <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
                    <DialogPrimitive.Description className="sr-only">
                        Search tracks, scenes, and workspace actions
                    </DialogPrimitive.Description>

                    <div className="flex items-center gap-3 border-b border-white/8 px-4 py-3">
                        <Search size={15} className="text-ink-dim shrink-0" aria-hidden />
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
                            className="text-ink placeholder:text-ink-dim min-w-0 flex-1 bg-transparent text-sm outline-none"
                            autoComplete="off"
                            spellCheck={false}
                        />
                        <kbd className="text-ink-dim rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px]">
                            esc
                        </kbd>
                    </div>

                    <div
                        ref={listRef}
                        id="palette-results"
                        role="listbox"
                        aria-label="Results"
                        className="scrollbar-custom max-h-[46vh] overflow-y-auto p-2"
                    >
                        {filtered.length === 0 ? (
                            <p className="text-ink-dim px-3 py-8 text-center text-sm">Nothing matches “{query}”</p>
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
                                                className="text-ink-dim px-3 pt-2 pb-1 text-[10px] font-medium tracking-wide uppercase"
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
                                                active ? 'text-ink bg-white/8' : 'text-ink-mid',
                                            )}
                                        >
                                            <Icon
                                                size={15}
                                                className={cn('shrink-0', active ? 'text-ember' : 'text-ink-dim')}
                                                aria-hidden
                                            />
                                            <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
                                            {item.sub && (
                                                <span className="text-ink-dim shrink-0 truncate text-xs">
                                                    {item.sub}
                                                </span>
                                            )}
                                        </button>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    <p className="text-ink-dim flex items-center gap-3 border-t border-white/8 px-4 py-2 text-[11px]">
                        <span>↑↓ navigate</span>
                        <span>↵ select</span>
                    </p>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}
