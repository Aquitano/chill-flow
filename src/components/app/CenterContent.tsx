'use client';

import { useAppStore } from '@/store/app-store';
import { AnimatePresence, motion } from 'framer-motion';
import { TasksPanel } from './tasks/TasksPanel';
import { TimerPanel } from './TimerPanel';

export const CenterContent: React.FC = () => {
    const currentMode = useAppStore((state) => state.currentMode);
    const modes = useAppStore((state) => state.modes);
    const currentQuote = useAppStore((state) => state.currentQuote);
    const sessionSummary = useAppStore((state) => state.sessionSummary);
    const isTasksOpen = useAppStore((state) => state.isTasksOpen);

    const showQuote = modes[currentMode]?.showQuote || false;
    const showBackground = modes[currentMode]?.showBackground || false;

    return (
        <div className="absolute inset-0 z-10 flex min-h-screen w-full flex-col items-center justify-center px-4 py-24 sm:px-6">
            <AnimatePresence>{isTasksOpen && <TasksPanel />}</AnimatePresence>

            <AnimatePresence mode="wait">
                <TimerPanel />
            </AnimatePresence>

            <motion.div
                className={`relative z-10 flex aspect-square w-[min(600px,calc(100vw-2rem),calc(100vh-13rem))] flex-col items-center justify-center rounded-full ${
                    showBackground ? 'border-2 border-white/20 bg-black/60 shadow-lg' : 'border-none bg-black'
                }`}
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            >
                <AnimatePresence mode="wait">
                    {showQuote && currentQuote ? (
                        <motion.div
                            key="quote-display"
                            className="absolute inset-0 z-20 flex flex-col items-center justify-center px-10 text-center"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            transition={{ duration: 0.8 }}
                        >
                            <h1 className="mb-4 bg-linear-to-r from-white to-stone-300 bg-clip-text font-serif text-4xl font-bold text-transparent md:text-5xl">
                                {currentQuote.text}
                            </h1>
                            <p className="text-xl text-stone-400 italic md:text-2xl">{currentQuote.author}</p>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="summary-display"
                            className="flex max-w-md flex-col items-center text-center"
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                        >
                            <p className="text-xs tracking-[0.3em] text-neutral-500 uppercase">Current pace</p>
                            <h2 className="mt-4 text-4xl font-semibold">
                                {sessionSummary.totalMinutes} minutes focused
                            </h2>
                            <p className="mt-3 text-sm text-neutral-400">
                                {sessionSummary.totalSessions} sessions completed in this workspace. Keep the current
                                loop running and stack another block.
                            </p>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </div>
    );
};
