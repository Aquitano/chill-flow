'use client';

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    useClearCompletedTasksMutation,
    useDeleteTaskMutation,
    useUpdateTaskMutation,
} from '@/hooks/use-app-data';
import { dueState, formatDue, quickDueOptions, type DueState } from '@/lib/task-dates';
import type { TaskPriority } from '@/lib/task-parser';
import { cn } from '@/lib/utils';
import type { Task } from '@/models/app';
import { useAppStore } from '@/store/app-store';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarDays, Check, Flag, Target, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { DUE_TEXT } from './due-meta';
import { PRIORITY_META, PRIORITY_OPTIONS } from './priority-meta';
import { TaskComposer } from './TaskComposer';
import type { ResizablePanel } from './use-resizable-panel';

/** Matches the server's task-text limit, so a rename can't fail validation on length. */
const MAX_TASK_LENGTH = 120;

function TaskRow({ task }: { task: Task }) {
    const updateTask = useUpdateTaskMutation();
    const deleteTask = useDeleteTaskMutation();
    const setFocusTask = useAppStore((state) => state.setFocusTask);
    const isFocused = useAppStore((state) => state.focusTaskId === task.id);
    const meta = PRIORITY_META[task.priority];
    // Non-null while renaming; the row shows the field instead of the label.
    const [draft, setDraft] = useState<string | null>(null);

    const commitRename = () => {
        const next = draft?.trim() ?? '';
        if (next && next !== task.text) {
            updateTask.mutate({ id: task.id, text: next });
        }
        setDraft(null);
    };

    const dueMenuItems = (
        <>
            {quickDueOptions().map((option) => (
                <DropdownMenuItem
                    key={option.id}
                    onSelect={() => updateTask.mutate({ id: task.id, dueAt: option.dueAt, dueHasTime: false })}
                >
                    <CalendarDays className="h-3.5 w-3.5 text-ink-dim" />
                    {option.label}
                </DropdownMenuItem>
            ))}
            {task.dueAt && (
                <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => updateTask.mutate({ id: task.id, dueAt: null })}>
                        <X className="h-3.5 w-3.5 text-ink-dim" />
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
                    task.isCompleted ? 'border-ember bg-ember text-night' : cn(meta.ring, 'hover:bg-white/10'),
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
                {draft === null ? (
                    <button
                        type="button"
                        onClick={() => setDraft(task.text)}
                        className={cn(
                            'focus-visible:outline-ember block w-full truncate rounded text-left text-sm focus-visible:outline-2',
                            task.isCompleted ? 'text-ink-dim line-through' : 'text-ink',
                        )}
                        aria-label={`Rename task: ${task.text}`}
                    >
                        {task.text}
                    </button>
                ) : (
                    <input
                        type="text"
                        autoFocus
                        value={draft}
                        maxLength={MAX_TASK_LENGTH}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                commitRename();
                            } else if (event.key === 'Escape') {
                                event.preventDefault();
                                setDraft(null);
                            }
                        }}
                        aria-label="Task name"
                        className="focus-visible:outline-ember text-ink block w-full rounded bg-white/5 px-1 py-0.5 text-sm outline-none focus-visible:outline-2"
                    />
                )}
                {task.dueAt && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                className={cn(
                                    'mt-0.5 flex items-center gap-1 text-[11px] transition hover:underline',
                                    task.isCompleted
                                        ? 'text-ink-dim'
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

            <div
                className={cn(
                    'flex items-center gap-1 transition',
                    // The focus marker stays visible without hover; it is state, not an action.
                    isFocused
                        ? 'opacity-100'
                        : 'opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100',
                )}
            >
                {!task.isCompleted && (
                    <button
                        type="button"
                        onClick={() => setFocusTask(isFocused ? null : task.id)}
                        aria-pressed={isFocused}
                        className={cn(
                            'rounded p-1 transition hover:bg-white/10',
                            isFocused ? 'text-ember' : 'text-ink-dim hover:text-ink-mid',
                        )}
                        aria-label={isFocused ? 'Stop focusing on this task' : 'Focus on this task'}
                    >
                        <Target className="h-3.5 w-3.5" />
                    </button>
                )}
                {!task.dueAt && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                className="rounded p-1 text-ink-dim transition hover:bg-white/10 hover:text-ink-mid"
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
                    className="rounded p-1 text-ink-dim transition hover:bg-white/10 hover:text-rose-300"
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

export function TasksPanel({ panel }: { panel: ResizablePanel }) {
    const tasks = useAppStore((state) => state.tasks);
    const setTasksOpen = useAppStore((state) => state.setTasksOpen);
    const clearCompleted = useClearCompletedTasksMutation();
    const openCount = tasks.filter((task) => !task.isCompleted).length;
    const { enabled: resizable, size, resizing, onResizeStart } = panel;
    const groups = groupTasks(tasks);

    return (
        <motion.aside
            key="tasks-panel"
            data-workspace-panel
            aria-label="Tasks"
            style={resizable ? { width: size.width, height: size.height } : undefined}
            className={cn(
                'z-20 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/80 shadow-lg backdrop-blur-md',
                // Narrow viewports: a full sheet between the header and the player bar, so
                // the list never half-covers the dial. Wider: a floating side panel, with
                // the dial giving up the width it takes (see CenterContent).
                'max-md:fixed max-md:inset-x-3 max-md:top-16 max-md:bottom-28',
                'md:absolute md:top-24 md:left-6',
                // Fallback sizing before the desktop resize state is active.
                !resizable && 'md:max-h-[calc(100vh-11rem)] md:w-80',
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
                    <span className="text-xs text-ink-dim">{openCount} open</span>
                    <button
                        type="button"
                        onClick={() => setTasksOpen(false)}
                        className="rounded p-1 text-ink-dim transition hover:bg-white/10 hover:text-ink"
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
                            <p className="text-sm font-medium text-ink-mid">No tasks yet</p>
                            <p className="mt-1 text-xs text-ink-dim">
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
                                              group.id === 'overdue' ? 'text-rose-300/90' : 'text-ink-dim',
                                          )}
                                      >
                                          {group.label}
                                          {group.id === 'done' && (
                                              <button
                                                  type="button"
                                                  onClick={() => clearCompleted.mutate()}
                                                  disabled={clearCompleted.isPending}
                                                  className="focus-visible:outline-ember text-ink-dim hover:text-ink ml-2 rounded normal-case transition focus-visible:outline-2 disabled:opacity-50"
                                              >
                                                  Clear
                                              </button>
                                          )}
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
                    className="absolute right-1.5 bottom-1.5 z-30 flex h-4 w-4 cursor-nwse-resize touch-none items-center justify-center rounded text-ink-dim transition hover:bg-white/10 hover:text-ink-mid"
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
