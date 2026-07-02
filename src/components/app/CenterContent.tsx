'use client';

import { useAppStore } from '@/store/app-store';
import { AnimatePresence, motion } from 'framer-motion';
import { TasksPanel } from './tasks/TasksPanel';
import { TimerDial } from './TimerDial';

export const CenterContent: React.FC = () => {
    const currentMode = useAppStore((state) => state.currentMode);
    const modes = useAppStore((state) => state.modes);
    const currentQuote = useAppStore((state) => state.currentQuote);
    const sessionSummary = useAppStore((state) => state.sessionSummary);
    const isTasksOpen = useAppStore((state) => state.isTasksOpen);

    const showQuote = modes[currentMode]?.showQuote || false;
    const showBackground = modes[currentMode]?.showBackground || false;
    const showTimer = modes[currentMode]?.showTimer || false;

    return (
        <div className="absolute inset-0 z-10 flex min-h-screen w-full flex-col items-center justify-center px-4 py-24 sm:px-6">
            <AnimatePresence>{isTasksOpen && <TasksPanel />}</AnimatePresence>

            <motion.div
                className={`relative z-10 flex aspect-square w-[min(560px,calc(100vw-2rem),calc(100vh-16rem))] flex-col items-center justify-center rounded-full ${
                    showBackground ? 'bg-black/60 shadow-lg backdrop-blur-[2px]' : 'bg-transparent'
                }`}
                initial={{ scale: 0.94, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            >
                <AnimatePresence mode="wait">
                    {showTimer ? (
                        <motion.div
                            key="timer-dial"
                            className="h-full w-full"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.4 }}
                        >
                            <TimerDial />
                        </motion.div>
                    ) : showQuote && currentQuote ? (
                        <motion.blockquote
                            key="quote-display"
                            className="flex flex-col items-center px-10 text-center"
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -16 }}
                            transition={{ duration: 0.6 }}
                        >
                            <p className="font-serif text-3xl font-light text-ink italic md:text-4xl">
                                {currentQuote.text}
                            </p>
                            <footer className="mt-4 text-base text-ink-dim">{currentQuote.author}</footer>
                        </motion.blockquote>
                    ) : (
                        <motion.div
                            key="summary-display"
                            className="flex max-w-md flex-col items-center px-8 text-center"
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -12 }}
                        >
                            <p className="text-xs tracking-[0.3em] text-ink-dim uppercase">Current pace</p>
                            <h2 className="mt-4 text-4xl font-medium text-ink">
                                {sessionSummary.totalMinutes} minutes focused
                            </h2>
                            <p className="mt-3 text-sm text-ink-mid">
                                {sessionSummary.totalSessions} sessions completed in this workspace.
                            </p>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>

            {/* Quiet line beneath the dial: quote in modes that show both, else honest totals. */}
            <motion.p
                key={showTimer && showQuote && currentQuote ? currentQuote.id : 'totals'}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5, duration: 0.8 }}
                className="mt-8 max-w-md px-6 text-center text-sm text-ink-mid [text-shadow:0_1px_8px_rgba(0,0,0,0.8)]"
            >
                {showTimer &&
                    (showQuote && currentQuote ? (
                        <span className="font-serif text-base italic">
                            “{currentQuote.text}” — {currentQuote.author}
                        </span>
                    ) : (
                        <span>
                            {sessionSummary.totalSessions} sessions · {sessionSummary.totalMinutes} min focused
                        </span>
                    ))}
            </motion.p>
        </div>
    );
};
