'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Image as ImageIcon, Music, Search, Sparkles, X } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';

// Below this the drawer's track list is short enough to scan without a filter.
const SOUND_SEARCH_THRESHOLD = 6;

const SHORTCUTS = [
    { keys: 'Space', action: 'Play / pause music' },
    { keys: 'S', action: 'Start / pause timer' },
    { keys: 'T', action: 'Toggle tasks' },
    { keys: 'M', action: 'Toggle this menu' },
    { keys: 'Esc', action: 'Close panels' },
];

export const FeatureMenu: React.FC = () => {
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

    const [soundQuery, setSoundQuery] = useState('');
    const showSoundSearch = tracks.length > SOUND_SEARCH_THRESHOLD;
    const soundTokens = soundQuery.toLowerCase().split(/\s+/).filter(Boolean);
    const filteredTracks = showSoundSearch
        ? tracks.filter((track) => {
              const haystack = `${track.title} ${track.artist}`.toLowerCase();
              return soundTokens.every((token) => haystack.includes(token));
          })
        : tracks;

    return (
        <>
            <motion.div
                role="dialog"
                aria-label="Workspace settings"
                aria-hidden={!isMenuOpen}
                className="scrollbar-custom fixed top-0 right-0 z-40 h-full w-[min(20rem,90vw)] overflow-y-auto border-l border-white/10 bg-black/85 backdrop-blur-md"
                initial={{ x: '100%' }}
                animate={{ x: isMenuOpen ? 0 : '100%' }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                inert={!isMenuOpen}
            >
                <div className="flex items-center justify-between px-5 pt-5 pb-4">
                    <h3 className="text-ink text-lg font-semibold">Workspace</h3>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="rounded-full hover:bg-white/10"
                        onClick={() => setMenuOpen(false)}
                        aria-label="Close workspace settings"
                    >
                        <X size={16} />
                    </Button>
                </div>

                <div className="space-y-7 px-5 pb-8">
                    <section>
                        <h4 className="text-ink-dim mb-3 flex items-center gap-2 text-xs tracking-wider uppercase">
                            <Sparkles className="h-3.5 w-3.5" /> Mode
                        </h4>
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
                                            className={cn('mt-1 shrink-0', active ? 'text-ember' : 'text-transparent')}
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
                    </section>

                    <section>
                        <h4 className="text-ink-dim mb-3 flex items-center gap-2 text-xs tracking-wider uppercase">
                            <Music className="h-3.5 w-3.5" /> Sound
                        </h4>
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
                                                <span className="text-ink block truncate text-sm">{track.title}</span>
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
                                                            style={{ height: '100%', animationDelay: `${delay}s` }}
                                                        />
                                                    ))}
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </section>

                    <section>
                        <h4 className="text-ink-dim mb-3 flex items-center gap-2 text-xs tracking-wider uppercase">
                            <ImageIcon className="h-3.5 w-3.5" /> Scene
                        </h4>
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
                        {!backgroundApplies && (
                            <p className="text-ink-dim mt-2 text-xs">
                                The scene appears in modes that show a background (LearnFlow, CreativeSpark).
                            </p>
                        )}
                    </section>

                    <section className="rounded-xl border border-white/10 bg-white/5 p-4">
                        <h4 className="text-ink-dim text-xs tracking-wider uppercase">Progress</h4>
                        <p className="text-ink mt-2 text-sm">
                            {sessionSummary.totalMinutes} minutes focused · {sessionSummary.totalSessions} sessions
                        </p>
                        {sessionSummary.currentStreak > 0 && (
                            <p className="text-ink-dim mt-1 text-xs">{sessionSummary.currentStreak}-day streak</p>
                        )}
                    </section>

                    <section>
                        <h4 className="text-ink-dim mb-3 text-xs tracking-wider uppercase">Shortcuts</h4>
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
                    </section>
                </div>
            </motion.div>

            <AnimatePresence>
                {isMenuOpen && (
                    <motion.div
                        className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setMenuOpen(false)}
                    />
                )}
            </AnimatePresence>
        </>
    );
};
