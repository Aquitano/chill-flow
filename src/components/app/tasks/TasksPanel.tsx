'use client';

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDeleteTaskMutation, useUpdateTaskMutation } from '@/hooks/use-app-data';
import { dueState, formatDue, quickDueOptions, type DueState } from '@/lib/task-dates';
import type { TaskPriority } from '@/lib/task-parser';
import { cn } from '@/lib/utils';
import type { Task } from '@/models/app';
import { useAppStore } from '@/store/app-store';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarDays, Check, Flag, Trash2, X } from 'lucide-react';
import { DUE_TEXT } from './due-meta';
import { PRIORITY_META, PRIORITY_OPTIONS } from './priority-meta';
import { TaskComposer } from './TaskComposer';
import { useResizablePanel } from './use-resizable-panel';

function TaskRow({ task }: { task: Task }) {
    const updateTask = useUpdateTaskMutation();
    const deleteTask = useDeleteTaskMutation();
    const meta = PRIORITY_META[task.priority];

    const dueMenuItems = (
        <>
            {quickDueOptions().map((option) => (
                <DropdownMenuItem
                    key={option.id}
                    onSelect={() => updateTask.mutate({ id: task.id, dueAt: option.dueAt, dueHasTime: false })}
                >
                    <CalendarDays className="h-3.5 w-3.5 text-neutral-400" />
                    {option.label}
                </DropdownMenuItem>
            ))}
            {task.dueAt && (
                <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => updateTask.mutate({ id: task.id, dueAt: null })}>
                        <X className="h-3.5 w-3.5 text-neutral-400" />
                        No date
                    </DropdownMenuItem>
                </>
            )}
        </>
    );

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
                    task.isCompleted
                        ? 'border-emerald-500 bg-emerald-500 text-black'
                        : cn(meta.ring, 'hover:bg-white/10'),
                )}
                aria-pressed={task.isCompleted}
                aria-label={task.isCompleted ? 'Mark task incomplete' : 'Mark task complete'}
            >
                <Check
                    className={cn(
                        'h-3 w-3 transition',
                        task.isCompleted ? 'opacity-100' : 'opacity-0 group-hover:opacity-40',
                    )}
                />
            </button>

            <span className="min-w-0 flex-1">
                <span
                    className={cn(
                        'block text-sm',
                        task.isCompleted ? 'text-neutral-500 line-through' : 'text-stone-100',
                    )}
                >
                    {task.text}
                </span>
                {task.dueAt && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                className={cn(
                                    'mt-0.5 flex items-center gap-1 text-[11px] transition hover:underline',
                                    task.isCompleted
                                        ? 'text-neutral-600'
                                        : DUE_TEXT[dueState(task.dueAt, task.dueHasTime)],
                                )}
                                aria-label={`Due ${formatDue(task.dueAt, task.dueHasTime)} — change due date`}
                            >
                                <CalendarDays className="h-3 w-3" aria-hidden />
                                {formatDue(task.dueAt, task.dueHasTime)}
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="bg-black/90 backdrop-blur-md">
                            {dueMenuItems}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </span>

            <div className="flex items-center gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                {!task.dueAt && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                className="rounded p-1 text-neutral-500 transition hover:bg-white/10 hover:text-neutral-200"
                                aria-label="Set due date"
                            >
                                <CalendarDays className="h-3.5 w-3.5" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-black/90 backdrop-blur-md">
                            {dueMenuItems}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
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
                                onSelect={() =>
                                    updateTask.mutate({ id: task.id, priority: option.value as TaskPriority })
                                }
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

const PRIORITY_RANK: Record<Task['priority'], number> = { high: 0, medium: 1, low: 2 };

const DUE_GROUPS: { id: DueState; label: string }[] = [
    { id: 'overdue', label: 'Overdue' },
    { id: 'today', label: 'Today' },
    { id: 'upcoming', label: 'Upcoming' },
];

interface TaskGroup {
    id: string;
    label: string | null;
    tasks: Task[];
}

/**
 * Todoist-style date grouping, but only once it earns its keep: with no due dates in
 * play the list stays flat. Completed tasks always sink to a Done group so the open
 * list reads as the actual plan.
 */
function groupTasks(tasks: Task[]): TaskGroup[] {
    const open = tasks.filter((task) => !task.isCompleted);
    const done = tasks.filter((task) => task.isCompleted);
    const groups: TaskGroup[] = [];

    if (open.some((task) => task.dueAt)) {
        const byState: Record<DueState, Task[]> = { overdue: [], today: [], upcoming: [] };
        const undated: Task[] = [];
        for (const task of open) {
            if (task.dueAt) byState[dueState(task.dueAt, task.dueHasTime)].push(task);
            else undated.push(task);
        }
        const byDueThenPriority = (a: Task, b: Task) =>
            (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0) ||
            PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        for (const { id, label } of DUE_GROUPS) {
            if (byState[id].length > 0) groups.push({ id, label, tasks: byState[id].sort(byDueThenPriority) });
        }
        if (undated.length > 0) groups.push({ id: 'undated', label: 'No date', tasks: undated });
    } else if (open.length > 0) {
        groups.push({ id: 'open', label: null, tasks: open });
    }

    if (done.length > 0) groups.push({ id: 'done', label: 'Done', tasks: done });
    return groups;
}

export function TasksPanel() {
    const tasks = useAppStore((state) => state.tasks);
    const setTasksOpen = useAppStore((state) => state.setTasksOpen);
    const openCount = tasks.filter((task) => !task.isCompleted).length;
    const { enabled: resizable, size, resizing, onResizeStart } = useResizablePanel();
    const groups = groupTasks(tasks);

    return (
        <motion.aside
            key="tasks-panel"
            style={resizable ? { width: size.width, height: size.height } : undefined}
            className={cn(
                'z-20 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/80 shadow-lg backdrop-blur-md',
                // Phones: a full sheet between the header and the player bar, so the
                // list never half-covers the dial. Desktop: a floating side panel.
                'max-sm:fixed max-sm:inset-x-3 max-sm:top-16 max-sm:bottom-28',
                'sm:absolute sm:top-24 sm:left-6',
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

            <div className="scrollbar-custom flex-1 overflow-y-auto px-4 pb-4">
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
                        {groups.flatMap((group) => [
                            ...(group.label
                                ? [
                                      <motion.li
                                          key={`heading-${group.id}`}
                                          layout
                                          role="presentation"
                                          initial={{ opacity: 0 }}
                                          animate={{ opacity: 1 }}
                                          exit={{ opacity: 0 }}
                                          transition={{ duration: 0.15 }}
                                          className={cn(
                                              'px-2 pt-3 pb-1 text-[10px] font-medium tracking-wide uppercase first:pt-0',
                                              group.id === 'overdue' ? 'text-rose-300/90' : 'text-neutral-500',
                                          )}
                                      >
                                          {group.label}
                                      </motion.li>,
                                  ]
                                : []),
                            ...group.tasks.map((task) => <TaskRow key={task.id} task={task} />),
                        ])}
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
