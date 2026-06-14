'use client';

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDeleteTaskMutation, useUpdateTaskMutation } from '@/hooks/use-app-data';
import type { TaskPriority } from '@/lib/task-parser';
import { cn } from '@/lib/utils';
import type { Task } from '@/models/app';
import { useAppStore } from '@/store/app-store';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Flag, Trash2, X } from 'lucide-react';
import { PRIORITY_META, PRIORITY_OPTIONS } from './priority-meta';
import { TaskComposer } from './TaskComposer';
import { useResizablePanel } from './use-resizable-panel';

function TaskRow({ task }: { task: Task }) {
    const updateTask = useUpdateTaskMutation();
    const deleteTask = useDeleteTaskMutation();
    const meta = PRIORITY_META[task.priority];

    return (
        <motion.li
            layout
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.18 }}
            className="group flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-white/5"
        >
            <button
                type="button"
                onClick={() => updateTask.mutate({ id: task.id, isCompleted: !task.isCompleted })}
                className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition',
                    task.isCompleted ? 'border-emerald-500 bg-emerald-500 text-black' : cn(meta.ring, 'hover:bg-white/10'),
                )}
                aria-pressed={task.isCompleted}
                aria-label={task.isCompleted ? 'Mark task incomplete' : 'Mark task complete'}
            >
                <Check className={cn('h-3 w-3 transition', task.isCompleted ? 'opacity-100' : 'opacity-0 group-hover:opacity-40')} />
            </button>

            <span className={cn('flex-1 text-sm', task.isCompleted ? 'text-neutral-500 line-through' : 'text-stone-100')}>
                {task.text}
            </span>

            <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            className={cn('rounded p-1 transition hover:bg-white/10', meta.accent)}
                            aria-label={`Task priority: ${meta.label}`}
                        >
                            <Flag className="h-3.5 w-3.5" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-black/90 backdrop-blur-md">
                        {PRIORITY_OPTIONS.map((option) => (
                            <DropdownMenuItem
                                key={option.value}
                                onClick={() => updateTask.mutate({ id: task.id, priority: option.value as TaskPriority })}
                                className={task.priority === option.value ? 'bg-white/10' : ''}
                            >
                                <Flag className={cn('h-3.5 w-3.5', option.accent)} />
                                {option.label}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
                <button
                    type="button"
                    onClick={() => deleteTask.mutate({ id: task.id })}
                    className="rounded p-1 text-neutral-500 transition hover:bg-white/10 hover:text-rose-300"
                    aria-label="Delete task"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </button>
            </div>
        </motion.li>
    );
}

export function TasksPanel() {
    const tasks = useAppStore((state) => state.tasks);
    const setTasksOpen = useAppStore((state) => state.setTasksOpen);
    const openCount = tasks.filter((task) => !task.isCompleted).length;
    const { enabled: resizable, size, resizing, onResizeStart } = useResizablePanel();

    return (
        <motion.aside
            key="tasks-panel"
            style={resizable ? { width: size.width, height: size.height } : undefined}
            className={cn(
                'absolute top-24 right-4 left-4 z-20 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/70 shadow-lg backdrop-blur-md max-sm:max-h-[32vh] sm:right-auto sm:left-6',
                // Fallback sizing before the desktop resize state is active.
                !resizable && 'sm:max-h-[calc(100vh-11rem)] sm:w-80',
                resizing && 'select-none',
            )}
            initial={{ x: -50, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -50, opacity: 0 }}
            transition={{ duration: 0.3 }}
        >
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <h3 className="text-lg font-semibold">Tasks</h3>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-neutral-400">{openCount} open</span>
                    <button
                        type="button"
                        onClick={() => setTasksOpen(false)}
                        className="rounded p-1 text-neutral-400 transition hover:bg-white/10 hover:text-white"
                        aria-label="Close tasks"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-4">
                <TaskComposer />

                <ul className="space-y-0.5">
                    {tasks.length === 0 && (
                        <li className="rounded-xl border border-dashed border-white/15 px-3 py-6 text-center">
                            <p className="text-sm font-medium text-neutral-300">No tasks yet</p>
                            <p className="mt-1 text-xs text-neutral-500">
                                Add your first focus task above to start your list.
                            </p>
                        </li>
                    )}
                    <AnimatePresence initial={false}>
                        {tasks.map((task) => (
                            <TaskRow key={task.id} task={task} />
                        ))}
                    </AnimatePresence>
                </ul>
            </div>

            {resizable && (
                <div
                    onPointerDown={onResizeStart}
                    aria-hidden
                    title="Drag to resize"
                    className="absolute right-1.5 bottom-1.5 z-30 flex h-4 w-4 cursor-nwse-resize touch-none items-center justify-center rounded text-neutral-600 transition hover:bg-white/10 hover:text-neutral-300"
                >
                    <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 fill-current" aria-hidden>
                        <circle cx="8" cy="8" r="1" />
                        <circle cx="8" cy="5" r="1" />
                        <circle cx="5" cy="8" r="1" />
                    </svg>
                </div>
            )}
        </motion.aside>
    );
}
