'use client';

import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useCreateTaskMutation, useDeleteTaskMutation, useUpdateTaskMutation } from '@/hooks/use-app-data';
import { Task } from '@/models/app';
import { useAppStore } from '@/store/app-store';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Flag, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { TimerPanel } from './TimerPanel';

const priorityOptions: Array<{ value: Task['priority']; label: string; className: string }> = [
    { value: 'low', label: 'Low', className: 'border-sky-400/30 bg-sky-400/10 text-sky-200' },
    { value: 'medium', label: 'Medium', className: 'border-amber-300/30 bg-amber-300/10 text-amber-100' },
    { value: 'high', label: 'High', className: 'border-rose-400/30 bg-rose-400/10 text-rose-100' },
];

function getPriorityOption(priority: Task['priority']) {
    return priorityOptions.find((option) => option.value === priority) ?? priorityOptions[1];
}

export const CenterContent: React.FC = () => {
    const currentMode = useAppStore((state) => state.currentMode);
    const modes = useAppStore((state) => state.modes);
    const currentQuote = useAppStore((state) => state.currentQuote);
    const tasks = useAppStore((state) => state.tasks);
    const sessionSummary = useAppStore((state) => state.sessionSummary);

    const createTask = useCreateTaskMutation();
    const updateTask = useUpdateTaskMutation();
    const deleteTask = useDeleteTaskMutation();

    const [draftTask, setDraftTask] = useState('');
    const [draftPriority, setDraftPriority] = useState<Task['priority']>('medium');

    const showQuote = modes[currentMode]?.showQuote || false;
    const showBackground = modes[currentMode]?.showBackground || false;
    const showTasks = modes[currentMode]?.showTasks || false;

    return (
        <div className="absolute inset-0 z-10 flex min-h-screen w-full flex-col items-center justify-center px-4 py-24 sm:px-6">
            <AnimatePresence mode="wait">
                {showTasks && (
                    <motion.aside
                        key="tasks-panel"
                        className="absolute top-24 right-4 left-4 z-20 max-h-[calc(100vh-11rem)] overflow-y-auto rounded-2xl border border-white/10 bg-black/70 p-4 shadow-lg backdrop-blur-md sm:right-auto sm:left-6 sm:w-80"
                        initial={{ x: -50, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: -50, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                    >
                        <div className="mb-3 flex items-center justify-between">
                            <h3 className="text-lg font-semibold">Tasks</h3>
                            <span className="text-xs text-neutral-400">
                                {tasks.filter((task) => !task.isCompleted).length} open
                            </span>
                        </div>

                        <form
                            className="mb-4 grid grid-cols-[1fr_auto_auto] gap-2"
                            onSubmit={(event) => {
                                event.preventDefault();
                                if (!draftTask.trim()) return;
                                createTask.mutate({ text: draftTask.trim(), priority: draftPriority });
                                setDraftTask('');
                            }}
                        >
                            <Input
                                value={draftTask}
                                onChange={(event) => setDraftTask(event.target.value)}
                                className="bg-black/30"
                                placeholder="Add the next thing to finish"
                            />
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className={`h-10 gap-1 border px-3 ${getPriorityOption(draftPriority)?.className}`}
                                        aria-label={`New task priority: ${getPriorityOption(draftPriority)?.label}`}
                                    >
                                        <Flag className="h-3.5 w-3.5" />
                                        <span className="text-xs">{getPriorityOption(draftPriority)?.label}</span>
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="bg-black/90 backdrop-blur-md">
                                    {priorityOptions.map((option) => (
                                        <DropdownMenuItem
                                            key={option.value}
                                            onClick={() => setDraftPriority(option.value)}
                                            className={draftPriority === option.value ? 'bg-white/10' : ''}
                                        >
                                            {option.label}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                            <Button type="submit" size="icon">
                                <Plus className="h-4 w-4" />
                            </Button>
                        </form>

                        <ul className="space-y-2 text-sm text-stone-200">
                            {tasks.map((task) => (
                                <li
                                    key={task.id}
                                    className={`flex items-center gap-2 rounded-xl border border-white/5 px-3 py-2 ${
                                        task.isCompleted ? 'bg-emerald-500/10 text-neutral-400' : 'bg-white/5'
                                    }`}
                                >
                                    <button
                                        className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                                            task.isCompleted
                                                ? 'border-emerald-500 bg-emerald-500 text-black'
                                                : 'border-white/20'
                                        }`}
                                        onClick={() =>
                                            updateTask.mutate({ id: task.id, isCompleted: !task.isCompleted })
                                        }
                                    >
                                        <Check className="h-3 w-3" />
                                    </button>
                                    <span className="flex-1">{task.text}</span>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <button
                                                className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[11px] leading-none ${getPriorityOption(task.priority)?.className}`}
                                                aria-label={`Task priority: ${getPriorityOption(task.priority)?.label}`}
                                            >
                                                <Flag className="h-3 w-3" />
                                                {getPriorityOption(task.priority)?.label}
                                            </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="bg-black/90 backdrop-blur-md">
                                            {priorityOptions.map((option) => (
                                                <DropdownMenuItem
                                                    key={option.value}
                                                    onClick={() =>
                                                        updateTask.mutate({ id: task.id, priority: option.value })
                                                    }
                                                    className={task.priority === option.value ? 'bg-white/10' : ''}
                                                >
                                                    {option.label}
                                                </DropdownMenuItem>
                                            ))}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                    <button onClick={() => deleteTask.mutate({ id: task.id })}>
                                        <Trash2 className="h-4 w-4 text-neutral-500 transition hover:text-white" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </motion.aside>
                )}
            </AnimatePresence>

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
