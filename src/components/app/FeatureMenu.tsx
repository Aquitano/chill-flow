'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Image as ImageIcon, Music, Sparkles, X } from 'lucide-react';
import Image from 'next/image';

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
                    <h3 className="text-lg font-semibold text-ink">Workspace</h3>
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
                        <h4 className="mb-3 flex items-center gap-2 text-xs tracking-wider text-ink-dim uppercase">
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
                                            'flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition',
                                            active ? 'bg-white/8' : 'hover:bg-white/5',
                                        )}
                                    >
                                        <Check
                                            size={14}
                                            className={cn('mt-1 shrink-0', active ? 'text-ember' : 'text-transparent')}
                                        />
                                        <span>
                                            <span className="block text-sm font-medium text-ink">
                                                {modes[modeKey]?.label}
                                            </span>
                                            <span className="mt-0.5 block text-xs text-ink-dim">
                                                {modes[modeKey]?.description}
                                            </span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </section>

                    <section>
                        <h4 className="mb-3 flex items-center gap-2 text-xs tracking-wider text-ink-dim uppercase">
                            <Music className="h-3.5 w-3.5" /> Sound
                        </h4>
                        <div className="space-y-1">
                            {tracks.map((track) => {
                                const active = currentTrack?.id === track.id;
                                return (
                                    <button
                                        key={track.id}
                                        type="button"
                                        onClick={() => setCurrentTrack(track)}
                                        aria-pressed={active}
                                        className={cn(
                                            'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition',
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
                                                <Music className="h-3.5 w-3.5 text-ink-dim" />
                                            </span>
                                        )}
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm text-ink">{track.title}</span>
                                            <span className="block truncate text-xs text-ink-dim">{track.artist}</span>
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
                                                        className="eq-bar w-[2px] rounded-full bg-ember"
                                                        style={{ height: '100%', animationDelay: `${delay}s` }}
                                                    />
                                                ))}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </section>

                    <section>
                        <h4 className="mb-3 flex items-center gap-2 text-xs tracking-wider text-ink-dim uppercase">
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
                                            'group relative overflow-hidden rounded-lg border transition',
                                            active
                                                ? 'border-ember/60 ring-1 ring-ember/40'
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
                                        <span className="absolute bottom-1.5 left-2 text-xs font-medium text-ink">
                                            {background.name}
                                        </span>
                                        {active && (
                                            <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-ember text-night">
                                                <Check className="h-2.5 w-2.5" />
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                        {!backgroundApplies && (
                            <p className="mt-2 text-xs text-ink-dim">
                                The scene appears in modes that show a background (LearnFlow, CreativeSpark).
                            </p>
                        )}
                    </section>

                    <section className="rounded-xl border border-white/10 bg-white/5 p-4">
                        <h4 className="text-xs tracking-wider text-ink-dim uppercase">Progress</h4>
                        <p className="mt-2 text-sm text-ink">
                            {sessionSummary.totalMinutes} minutes focused · {sessionSummary.totalSessions} sessions
                        </p>
                        {sessionSummary.currentStreak > 0 && (
                            <p className="mt-1 text-xs text-ink-dim">{sessionSummary.currentStreak}-day streak</p>
                        )}
                    </section>

                    <section>
                        <h4 className="mb-3 text-xs tracking-wider text-ink-dim uppercase">Shortcuts</h4>
                        <ul className="space-y-1.5">
                            {SHORTCUTS.map((shortcut) => (
                                <li key={shortcut.keys} className="flex items-center justify-between text-sm">
                                    <span className="text-ink-mid">{shortcut.action}</span>
                                    <kbd className="rounded border border-white/15 bg-black/40 px-1.5 py-0.5 font-sans text-[11px] text-ink-dim">
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
