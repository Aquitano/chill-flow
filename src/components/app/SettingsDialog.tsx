'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
    BarChart3,
    Check,
    Image as ImageIcon,
    Keyboard,
    Music,
    Search,
    Sparkles,
    X,
    type LucideIcon,
} from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

// Below this the track list is short enough to scan without a filter.
const SOUND_SEARCH_THRESHOLD = 6;

// `M` opens the dialog; once focus is trapped inside, Radix owns Escape to close
// it, and the workspace hotkey hook deliberately ignores keys within [role=dialog].
const SHORTCUTS = [
    { keys: 'Space', action: 'Play / pause music' },
    { keys: 'S', action: 'Start / pause timer' },
    { keys: 'T', action: 'Toggle tasks' },
    { keys: 'M', action: 'Open settings' },
    { keys: 'Esc', action: 'Close panels' },
];

type SectionId = 'mode' | 'sound' | 'scene' | 'progress' | 'shortcuts';

const SECTIONS: { id: SectionId; label: string; description: string; icon: LucideIcon }[] = [
    { id: 'mode', label: 'Mode', description: 'Shapes what the workspace shows while you work.', icon: Sparkles },
    { id: 'sound', label: 'Sound', description: 'The track playing under your session.', icon: Music },
    { id: 'scene', label: 'Scene', description: 'The backdrop behind your session.', icon: ImageIcon },
    { id: 'progress', label: 'Progress', description: 'Your focus, in plain numbers.', icon: BarChart3 },
    {
        id: 'shortcuts',
        label: 'Shortcuts',
        description: 'The whole workspace works from the keyboard.',
        icon: Keyboard,
    },
];

export function SettingsDialog() {
    const isMenuOpen = useAppStore((state) => state.isMenuOpen);
    const setMenuOpen = useAppStore((state) => state.setMenuOpen);
    const modes = useAppStore((state) => state.modes);
    const currentMode = useAppStore((state) => state.currentMode);
    const tracks = useAppStore((state) => state.tracks);
    const backgrounds = useAppStore((state) => state.backgrounds);
    const selectedBackgroundId = useAppStore((state) => state.selectedBackgroundId);
    const sessionSummary = useAppStore((state) => state.sessionSummary);
    const currentTrack = useAppStore((state) => state.currentTrack);
    const isPlaying = useAppStore((state) => state.isPlaying);
    const setMode = useAppStore((state) => state.setMode);
    const setCurrentTrack = useAppStore((state) => state.setCurrentTrack);
    const setSelectedBackgroundId = useAppStore((state) => state.setSelectedBackgroundId);

    const backgroundApplies = modes[currentMode]?.showBackground ?? false;
    const backgroundModeLabels = Object.values(modes)
        .filter((mode) => mode.showBackground)
        .map((mode) => mode.label);

    const [activeSection, setActiveSection] = useState<SectionId>('mode');
    const [soundQuery, setSoundQuery] = useState('');
    const [railOrientation, setRailOrientation] = useState<'horizontal' | 'vertical'>('horizontal');
    const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

    useEffect(() => {
        const mediaQuery = window.matchMedia('(min-width: 640px)');
        const updateOrientation = () => setRailOrientation(mediaQuery.matches ? 'vertical' : 'horizontal');
        updateOrientation();
        mediaQuery.addEventListener('change', updateOrientation);
        return () => mediaQuery.removeEventListener('change', updateOrientation);
    }, []);

    const showSoundSearch = tracks.length > SOUND_SEARCH_THRESHOLD;
    const soundTokens = soundQuery.toLowerCase().split(/\s+/).filter(Boolean);
    const filteredTracks = showSoundSearch
        ? tracks.filter((track) => {
              const haystack =
                  `${track.title} ${track.artist} ${track.tags.join(' ')} ${track.category ?? ''}`.toLowerCase();
              return soundTokens.every((token) => haystack.includes(token));
          })
        : tracks;

    const activeMeta = SECTIONS.find((section) => section.id === activeSection) ?? SECTIONS[0]!;

    const handleRailKeyDown = (event: React.KeyboardEvent) => {
        const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
        const backward = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
        if (!forward && !backward) return;

        event.preventDefault();
        const currentIndex = SECTIONS.findIndex((section) => section.id === activeSection);
        const delta = forward ? 1 : -1;
        const nextIndex = (currentIndex + delta + SECTIONS.length) % SECTIONS.length;
        const nextSection = SECTIONS[nextIndex];
        if (!nextSection) return;
        setActiveSection(nextSection.id);
        tabRefs.current[nextIndex]?.focus();
    };

    return (
        <DialogPrimitive.Root open={isMenuOpen} onOpenChange={setMenuOpen}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] motion-reduce:animate-none" />
                <DialogPrimitive.Content className="bg-night-2/95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 fixed top-1/2 left-1/2 z-50 flex h-[min(80vh,640px)] w-[min(46rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-white/10 shadow-[0_40px_80px_-32px_rgba(0,0,0,0.9)] backdrop-blur-xl duration-200 motion-reduce:animate-none">
                    <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
                        <DialogPrimitive.Title className="text-ink text-base font-semibold">
                            Settings
                        </DialogPrimitive.Title>
                        <DialogPrimitive.Description className="sr-only">
                            Adjust mode, sound, scene, and review your progress and shortcuts
                        </DialogPrimitive.Description>
                        <DialogPrimitive.Close asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="rounded-full hover:bg-white/10"
                                aria-label="Close settings"
                            >
                                <X size={16} />
                            </Button>
                        </DialogPrimitive.Close>
                    </div>

                    <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
                        <nav
                            aria-label="Settings sections"
                            aria-orientation={railOrientation}
                            role="tablist"
                            onKeyDown={handleRailKeyDown}
                            className="scrollbar-custom flex shrink-0 gap-1 overflow-x-auto border-b border-white/8 p-2 sm:w-48 sm:flex-col sm:overflow-x-visible sm:border-r sm:border-b-0 sm:p-3"
                        >
                            {SECTIONS.map((section, index) => {
                                const active = section.id === activeSection;
                                const Icon = section.icon;
                                return (
                                    <button
                                        key={section.id}
                                        ref={(node) => {
                                            tabRefs.current[index] = node;
                                        }}
                                        type="button"
                                        role="tab"
                                        id={`settings-tab-${section.id}`}
                                        aria-selected={active}
                                        aria-controls={`settings-panel-${section.id}`}
                                        tabIndex={active ? 0 : -1}
                                        onClick={() => setActiveSection(section.id)}
                                        className={cn(
                                            'focus-visible:outline-ember flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition focus-visible:outline-2 focus-visible:-outline-offset-2 sm:w-full',
                                            active ? 'text-ink bg-white/8' : 'text-ink-mid hover:bg-white/5',
                                        )}
                                    >
                                        <Icon
                                            size={15}
                                            className={cn('shrink-0', active ? 'text-ember' : 'text-ink-dim')}
                                            aria-hidden
                                        />
                                        {section.label}
                                    </button>
                                );
                            })}
                        </nav>

                        <div
                            role="tabpanel"
                            id={`settings-panel-${activeSection}`}
                            aria-labelledby={`settings-tab-${activeSection}`}
                            className="scrollbar-custom min-h-0 flex-1 overflow-y-auto p-5"
                        >
                            <header className="mb-4">
                                <h3 className="text-ink text-sm font-medium">{activeMeta.label}</h3>
                                <p className="text-ink-dim mt-0.5 text-xs">{activeMeta.description}</p>
                            </header>

                            {activeSection === 'mode' && (
                                <div className="space-y-1">
                                    {Object.keys(modes).map((modeKey) => {
                                        const active = modeKey === currentMode;
                                        return (
                                            <button
                                                key={modeKey}
                                                type="button"
                                                onClick={() => setMode(modeKey)}
                                                aria-pressed={active}
                                                className={cn(
                                                    'focus-visible:outline-ember flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition focus-visible:outline-2 focus-visible:-outline-offset-2',
                                                    active ? 'bg-white/8' : 'hover:bg-white/5',
                                                )}
                                            >
                                                <Check
                                                    size={14}
                                                    className={cn(
                                                        'mt-1 shrink-0',
                                                        active ? 'text-ember' : 'text-transparent',
                                                    )}
                                                />
                                                <span>
                                                    <span className="text-ink block text-sm font-medium">
                                                        {modes[modeKey]?.label}
                                                    </span>
                                                    <span className="text-ink-dim mt-0.5 block text-xs">
                                                        {modes[modeKey]?.description}
                                                    </span>
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            {activeSection === 'sound' && (
                                <>
                                    {showSoundSearch && (
                                        <div className="mb-2 flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5">
                                            <Search size={13} className="text-ink-dim shrink-0" aria-hidden />
                                            <input
                                                type="text"
                                                value={soundQuery}
                                                onChange={(event) => setSoundQuery(event.target.value)}
                                                placeholder="Search sounds…"
                                                aria-label="Search sounds"
                                                autoComplete="off"
                                                spellCheck={false}
                                                className="text-ink placeholder:text-ink-dim min-w-0 flex-1 bg-transparent text-sm outline-none"
                                            />
                                        </div>
                                    )}
                                    {filteredTracks.length === 0 ? (
                                        <p className="text-ink-dim px-1 py-2 text-sm">No sounds match “{soundQuery}”</p>
                                    ) : (
                                        <div className="space-y-1">
                                            {filteredTracks.map((track) => {
                                                const active = currentTrack?.id === track.id;
                                                return (
                                                    <button
                                                        key={track.id}
                                                        type="button"
                                                        onClick={() => setCurrentTrack(track)}
                                                        aria-pressed={active}
                                                        className={cn(
                                                            'focus-visible:outline-ember flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition focus-visible:outline-2 focus-visible:-outline-offset-2',
                                                            active ? 'bg-white/8' : 'hover:bg-white/5',
                                                        )}
                                                    >
                                                        {track.thumbnailUrl ? (
                                                            <Image
                                                                src={track.thumbnailUrl}
                                                                alt=""
                                                                width={32}
                                                                height={32}
                                                                className="h-8 w-8 rounded object-cover"
                                                            />
                                                        ) : (
                                                            <span className="flex h-8 w-8 items-center justify-center rounded bg-white/10">
                                                                <Music className="text-ink-dim h-3.5 w-3.5" />
                                                            </span>
                                                        )}
                                                        <span className="min-w-0 flex-1">
                                                            <span className="text-ink block truncate text-sm">
                                                                {track.title}
                                                            </span>
                                                            <span className="text-ink-dim block truncate text-xs">
                                                                {track.artist}
                                                            </span>
                                                        </span>
                                                        {active && (
                                                            <span
                                                                className={cn(
                                                                    'flex h-5 items-end gap-[2px]',
                                                                    isPlaying && 'eq-playing',
                                                                )}
                                                                aria-hidden
                                                            >
                                                                {[0, 0.2, 0.1].map((delay, index) => (
                                                                    <span
                                                                        key={index}
                                                                        className="eq-bar bg-ember w-[2px] rounded-full"
                                                                        style={{
                                                                            height: '100%',
                                                                            animationDelay: `${delay}s`,
                                                                        }}
                                                                    />
                                                                ))}
                                                            </span>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </>
                            )}

                            {activeSection === 'scene' && (
                                <>
                                    <div className="grid grid-cols-2 gap-2">
                                        {backgrounds.map((background) => {
                                            const active = selectedBackgroundId === background.id;
                                            return (
                                                <button
                                                    key={background.id}
                                                    type="button"
                                                    onClick={() => setSelectedBackgroundId(background.id)}
                                                    aria-pressed={active}
                                                    className={cn(
                                                        'focus-visible:outline-ember group relative overflow-hidden rounded-lg border transition focus-visible:outline-2',
                                                        active
                                                            ? 'border-ember/60 ring-ember/40 ring-1'
                                                            : 'border-white/10 hover:border-white/30',
                                                    )}
                                                >
                                                    {background.thumbnailUrl && (
                                                        <Image
                                                            src={background.thumbnailUrl}
                                                            alt={background.name}
                                                            width={200}
                                                            height={120}
                                                            className="aspect-[5/3] w-full object-cover"
                                                        />
                                                    )}
                                                    <span className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                                                    <span className="text-ink absolute bottom-1.5 left-2 text-xs font-medium">
                                                        {background.name}
                                                    </span>
                                                    {active && (
                                                        <span className="bg-ember text-night absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full">
                                                            <Check className="h-2.5 w-2.5" />
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {!backgroundApplies && backgroundModeLabels.length > 0 && (
                                        <p className="text-ink-dim mt-2 text-xs">
                                            The scene appears in modes that show a background (
                                            {backgroundModeLabels.join(', ')}).
                                        </p>
                                    )}
                                </>
                            )}

                            {activeSection === 'progress' && (
                                <dl className="grid grid-cols-3 gap-2">
                                    {[
                                        { value: sessionSummary.totalMinutes, label: 'minutes focused' },
                                        { value: sessionSummary.totalSessions, label: 'sessions' },
                                        { value: sessionSummary.currentStreak, label: 'day streak' },
                                    ].map((stat) => (
                                        <div
                                            key={stat.label}
                                            className="rounded-xl border border-white/10 bg-white/5 px-3 py-3.5 text-center"
                                        >
                                            <dd className="text-ink text-xl font-semibold tabular-nums">
                                                {stat.value}
                                            </dd>
                                            <dt className="text-ink-dim mt-0.5 text-xs">{stat.label}</dt>
                                        </div>
                                    ))}
                                </dl>
                            )}

                            {activeSection === 'shortcuts' && (
                                <ul className="space-y-1.5">
                                    {SHORTCUTS.map((shortcut) => (
                                        <li key={shortcut.keys} className="flex items-center justify-between text-sm">
                                            <span className="text-ink-mid">{shortcut.action}</span>
                                            <kbd className="text-ink-dim rounded border border-white/15 bg-black/40 px-1.5 py-0.5 font-sans text-[11px]">
                                                {shortcut.keys}
                                            </kbd>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}
