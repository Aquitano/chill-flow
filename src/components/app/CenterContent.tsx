'use client';

import { useAppStore } from '@/store/app-store';
import { AnimatePresence, motion } from 'framer-motion';
import { Target, X } from 'lucide-react';
import { TasksPanel } from './tasks/TasksPanel';
import { PANEL_LEFT_RESERVE, useResizablePanel } from './tasks/use-resizable-panel';
import { TimerDial } from './TimerDial';

export const CenterContent: React.FC = () => {
    const currentMode = useAppStore((state) => state.currentMode);
    const modes = useAppStore((state) => state.modes);
    const currentQuote = useAppStore((state) => state.currentQuote);
    const sessionSummary = useAppStore((state) => state.sessionSummary);
    const isTasksOpen = useAppStore((state) => state.isTasksOpen);
    const tasks = useAppStore((state) => state.tasks);
    const focusTaskId = useAppStore((state) => state.focusTaskId);
    const setFocusTask = useAppStore((state) => state.setFocusTask);

    const showQuote = modes[currentMode]?.showQuote || false;
    const showBackground = modes[currentMode]?.showBackground || false;
    const showTimer = modes[currentMode]?.showTimer || false;

    const focusTask = tasks.find((task) => task.id === focusTaskId) ?? null;
    const captionKey = focusTask?.id ?? (showQuote && currentQuote ? currentQuote.id : 'totals');

    // The tasks panel floats over the workspace at a fixed left offset while the dial is
    // centred in the viewport, so on anything narrower than roughly 1280px the two used to
    // overlap — the panel covering the dial it sits in front of. Reserving the panel's
    // width here re-centres the dial in what's actually left, and tracks the drag-resize.
    const panel = useResizablePanel();
    const tasksGutter = isTasksOpen && panel.enabled ? panel.size.width + PANEL_LEFT_RESERVE : 0;
    // Subtract the container's own horizontal padding too, so the dial fits the box that
    // is actually left rather than spilling back over the panel.
    const dialWidth = tasksGutter
        ? `min(560px, calc(100vw - 3rem - ${tasksGutter}px), calc(100vh - 16rem))`
        : 'min(560px, calc(100vw - 2rem), calc(100vh - 16rem))';

    return (
        // Extra bottom padding keeps the dial + caption clear of the track dock.
        <div
            className="absolute inset-0 z-10 flex min-h-screen w-full flex-col items-center justify-center px-4 pt-24 pb-44 transition-[padding] duration-300 motion-reduce:transition-none sm:px-6"
            style={tasksGutter ? { paddingLeft: `calc(1.5rem + ${tasksGutter}px)` } : undefined}
        >
            <AnimatePresence>{isTasksOpen && <TasksPanel panel={panel} />}</AnimatePresence>

            <motion.div
                className={`relative z-10 flex aspect-square flex-col items-center justify-center rounded-full transition-[width] duration-300 motion-reduce:transition-none ${
                    showBackground ? 'bg-black/60 shadow-lg backdrop-blur-[2px]' : 'bg-transparent'
                }`}
                style={{ width: dialWidth }}
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
                            <p className="text-xs tracking-[0.3em] text-ink-dim uppercase">All time</p>
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

            {/* Quiet line beneath the dial. What you chose to focus on outranks the quote,
                which outranks the totals. */}
            <motion.div
                key={captionKey}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5, duration: 0.8 }}
                className="text-ink-mid mt-8 max-w-md px-6 text-center text-sm [text-shadow:0_1px_8px_rgba(0,0,0,0.8)]"
            >
                {showTimer &&
                    (focusTask ? (
                        <span className="inline-flex max-w-full items-center gap-2">
                            <Target className="text-ember size-3.5 shrink-0" aria-hidden />
                            <span className="text-ink truncate">{focusTask.text}</span>
                            <button
                                type="button"
                                onClick={() => setFocusTask(null)}
                                className="text-ink-dim hover:text-ink focus-visible:outline-ember shrink-0 rounded transition-colors focus-visible:outline-2"
                                aria-label="Stop focusing on this task"
                            >
                                <X className="size-3.5" />
                            </button>
                        </span>
                    ) : showQuote && currentQuote ? (
                        <span className="font-serif text-base italic">
                            “{currentQuote.text}” — {currentQuote.author}
                        </span>
                    ) : (
                        <span>
                            {sessionSummary.totalSessions} sessions · {sessionSummary.totalMinutes} min focused
                        </span>
                    ))}
            </motion.div>
        </div>
    );
};
