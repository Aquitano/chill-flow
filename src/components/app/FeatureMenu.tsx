'use client';

import { Button } from '@/components/ui/button';
import { useAppStore } from '@/store/app-store';
import { AnimatePresence, motion } from 'framer-motion';
import { Clock, LayoutGrid, Music, Pencil, Sparkles } from 'lucide-react';

export const FeatureMenu: React.FC = () => {
    const isMenuOpen = useAppStore((state) => state.isMenuOpen);
    const setMenuOpen = useAppStore((state) => state.setMenuOpen);
    const modes = useAppStore((state) => state.modes);
    const currentMode = useAppStore((state) => state.currentMode);
    const tasks = useAppStore((state) => state.tasks);
    const tracks = useAppStore((state) => state.tracks);
    const backgrounds = useAppStore((state) => state.backgrounds);
    const sessionSummary = useAppStore((state) => state.sessionSummary);
    const currentTrack = useAppStore((state) => state.currentTrack);
    const setMode = useAppStore((state) => state.setMode);
    const setCurrentTrack = useAppStore((state) => state.setCurrentTrack);
    const setSelectedBackgroundId = useAppStore((state) => state.setSelectedBackgroundId);

    return (
        <>
            <motion.div
                className="fixed top-0 right-0 z-40 h-full w-80 overflow-y-auto border-l border-white/10 bg-black/85 p-6 backdrop-blur-md"
                initial={{ x: '100%' }}
                animate={{ x: isMenuOpen ? 0 : '100%' }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
            >
                <div className="mb-8 flex items-center justify-between">
                    <h3 className="text-xl font-semibold">Workspace Controls</h3>
                    <Button variant="ghost" size="sm" onClick={() => setMenuOpen(false)}>
                        Close
                    </Button>
                </div>

                <div className="space-y-6">
                    <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <h4 className="mb-3 text-sm font-medium text-white">Flow stats</h4>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div className="rounded-xl bg-black/40 p-3">
                                <div className="text-neutral-400">Sessions</div>
                                <div className="mt-1 text-xl font-semibold">{sessionSummary.totalSessions}</div>
                            </div>
                            <div className="rounded-xl bg-black/40 p-3">
                                <div className="text-neutral-400">Minutes</div>
                                <div className="mt-1 text-xl font-semibold">{sessionSummary.totalMinutes}</div>
                            </div>
                        </div>
                    </section>

                    <section>
                        <h4 className="mb-3 flex items-center gap-2 text-xs tracking-wider text-stone-400 uppercase">
                            <Sparkles className="h-4 w-4" /> Modes
                        </h4>
                        <div className="space-y-2">
                            {Object.keys(modes).map((modeKey) => (
                                <Button
                                    key={modeKey}
                                    variant={modeKey === currentMode ? 'secondary' : 'ghost'}
                                    size="sm"
                                    className="w-full justify-start"
                                    onClick={() => setMode(modeKey)}
                                >
                                    {modes[modeKey]?.label}
                                </Button>
                            ))}
                        </div>
                    </section>

                    <section>
                        <h4 className="mb-3 flex items-center gap-2 text-xs tracking-wider text-stone-400 uppercase">
                            <Music className="h-4 w-4" /> Tracks
                        </h4>
                        <div className="space-y-2">
                            {tracks.map((track) => (
                                <Button
                                    key={track.id}
                                    variant={currentTrack?.id === track.id ? 'secondary' : 'ghost'}
                                    size="sm"
                                    className="w-full justify-start"
                                    onClick={() => setCurrentTrack(track)}
                                >
                                    {track.title}
                                </Button>
                            ))}
                        </div>
                    </section>

                    <section>
                        <h4 className="mb-3 flex items-center gap-2 text-xs tracking-wider text-stone-400 uppercase">
                            <LayoutGrid className="h-4 w-4" /> Backgrounds
                        </h4>
                        <div className="space-y-2">
                            {backgrounds.map((background) => (
                                <Button
                                    key={background.id}
                                    variant="ghost"
                                    size="sm"
                                    className="w-full justify-start"
                                    onClick={() => setSelectedBackgroundId(background.id)}
                                >
                                    {background.name}
                                </Button>
                            ))}
                        </div>
                    </section>

                    <section className="grid grid-cols-2 gap-3">
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                            <div className="mb-2 flex items-center gap-2 text-sm text-neutral-300">
                                <Pencil className="h-4 w-4" />
                                Tasks
                            </div>
                            <div className="text-2xl font-semibold">{tasks.length}</div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                            <div className="mb-2 flex items-center gap-2 text-sm text-neutral-300">
                                <Clock className="h-4 w-4" />
                                Tracks
                            </div>
                            <div className="text-2xl font-semibold">{tracks.length}</div>
                        </div>
                    </section>

                    <div className="rounded-lg border border-neutral-800 bg-black/40 p-4">
                        <h4 className="mb-1 text-sm font-medium">Current Mode</h4>
                        <p className="text-xs text-neutral-400">{modes[currentMode]?.description ?? ''}</p>
                    </div>
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
