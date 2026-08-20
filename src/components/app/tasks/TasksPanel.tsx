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
    useTaskFocusTotalsQuery,
    useUpdateTaskMutation,
} from '@/hooks/use-app-data';
import { formatFocusDuration } from '@/lib/focus-duration';
import { dueState, formatDue, quickDueOptions, type DueState } from '@/lib/task-dates';
import { MAX_TASK_LENGTH, type TaskPriority } from '@/lib/task-parser';
import { cn } from '@/lib/utils';
import type { Task, TaskFocusTotal } from '@/models/app';
import { useAppStore } from '@/store/app-store';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarDays, Check, Flag, Target, Timer, Trash2, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DUE_TEXT } from './due-meta';
import { PRIORITY_META, PRIORITY_OPTIONS } from './priority-meta';
import { TaskComposer } from './TaskComposer';
import type { ResizablePanel } from './use-resizable-panel';

/**
 * Clearing hard-deletes every completed task at once, and nothing is kept server-side to
 * restore from — so the button asks first rather than offering an undo it can't honour.
 */
function ClearCompletedButton({ count }: { count: number }) {
    const clearCompleted = useClearCompletedTasksMutation();
    const [armed, setArmed] = useState(false);

    const handleClick = () => {
        if (!armed) {
            setArmed(true);
            return;
        }

        setArmed(false);
        clearCompleted.mutate(undefined, {
            onSuccess: ({ count: cleared }) => toast(`Cleared ${cleared} completed ${plural(cleared, 'task')}`),
        });
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            onBlur={() => setArmed(false)}
            disabled={clearCompleted.isPending}
            className={cn(
                'focus-visible:outline-ember ml-2 rounded normal-case transition',
                'focus-visible:outline-2 disabled:opacity-50',
                armed ? 'text-ember' : 'text-ink-dim hover:text-ink',
            )}
        >
            {armed ? `Delete ${count} ${plural(count, 'task')}?` : 'Clear'}
        </button>
    );
}

function plural(count: number, noun: string) {
    return count === 1 ? noun : `${noun}s`;
}

/** The row has space for the duration alone; the block count rides along in the full label. */
function focusLabelOf(total: TaskFocusTotal) {
    return `${formatFocusDuration(total.totalSeconds)} focused across ${total.sessionCount} ${plural(total.sessionCount, 'block')}`;
}

interface RowNavigation {
    /** True when this row carries the list's roving tab stop. */
    isActive: boolean;
    onFocus: () => void;
    /** Handles the roving keys; true means the key was consumed. */
    onNavKey: (key: string) => boolean;
    /** Moves the tab stop off this row, called just before it is removed. */
    onLeaving: () => void;
}

/**
 * Roving tabindex over the task rows: arrows move a single tab stop, Home/End jump to the
 * ends. The active row is tracked by id rather than index, so the regrouping that follows a
 * mutation keeps the same row active; if that row is gone the stop falls back to the first.
 */
function useRowNavigation(orderedIds: string[]) {
    const [activeId, setActiveId] = useState<string | null>(null);
    const listRef = useRef<HTMLUListElement>(null);
    const active = activeId !== null && orderedIds.includes(activeId) ? activeId : (orderedIds[0] ?? null);

    const focusRow = (id: string | undefined) => {
        if (id === undefined) return;
        setActiveId(id);
        listRef.current?.querySelector<HTMLElement>(`[data-task-row="${CSS.escape(id)}"]`)?.focus();
    };

    const targetOf = (key: string, index: number): string | undefined => {
        switch (key) {
            case 'ArrowDown':
                return orderedIds[Math.min(index + 1, orderedIds.length - 1)];
            case 'ArrowUp':
                return orderedIds[Math.max(index - 1, 0)];
            case 'Home':
                return orderedIds[0];
            case 'End':
                return orderedIds.at(-1);
            default:
                return undefined;
        }
    };

    const rowProps = (id: string): RowNavigation => ({
        isActive: active === id,
        onFocus: () => setActiveId(id),
        onNavKey: (key) => {
            const target = targetOf(key, orderedIds.indexOf(id));
            if (target === undefined) return false;
            focusRow(target);
            return true;
        },
        onLeaving: () => {
            const index = orderedIds.indexOf(id);
            focusRow(orderedIds[index + 1] ?? orderedIds[index - 1]);
        },
    });

    return { listRef, rowProps };
}

function TaskRow({ task, focusTotal, nav }: { task: Task; focusTotal?: TaskFocusTotal; nav: RowNavigation }) {
    const updateTask = useUpdateTaskMutation();
    const deleteTask = useDeleteTaskMutation();
    const setFocusTask = useAppStore((state) => state.setFocusTask);
    const isFocused = useAppStore((state) => state.focusTaskId === task.id);
    const meta = PRIORITY_META[task.priority];
    // Non-null while renaming; the row shows the field instead of the label.
    const [draft, setDraft] = useState<string | null>(null);
    // A deleted task can't be restored — recreating it would mint a new id and orphan the
    // focus totals keyed to the old one — so the trash arms first and deletes on the
    // second press, exactly like Clear completed. Focus leaving the row disarms it.
    const [armed, setArmed] = useState(false);
    const rowRef = useRef<HTMLLIElement>(null);

    // Set once Enter/Escape has ended the rename: refocusing the row blurs the input while
    // it is still mounted (setDraft(null) has not applied yet), and that blur must not
    // commit again — Enter would mutate twice and Escape would commit a cancelled rename.
    const renameEnded = useRef(false);

    const startRename = () => {
        renameEnded.current = false;
        setDraft(task.text);
    };

    const commitRename = () => {
        const next = draft?.trim() ?? '';
        if (next && next !== task.text) {
            updateTask.mutate({ id: task.id, text: next });
        }
        setDraft(null);
    };

    /** Ends a rename from the keyboard, where focus has to go back to the row it came from. */
    const endRename = (commit: boolean) => {
        renameEnded.current = true;
        if (commit) commitRename();
        else setDraft(null);
        rowRef.current?.focus();
    };

    const requestDelete = () => {
        if (!armed) {
            setArmed(true);
            return;
        }
        setArmed(false);
        nav.onLeaving();
        deleteTask.mutate({ id: task.id });
    };

    // Keys pressed on the row itself; the buttons and the rename field own their own.
    const handleKeyDown = (event: React.KeyboardEvent<HTMLLIElement>) => {
        if (event.target !== event.currentTarget) return;
        if (nav.onNavKey(event.key)) {
            event.preventDefault();
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            startRename();
        } else if (event.key === ' ') {
            event.preventDefault();
            updateTask.mutate({ id: task.id, isCompleted: !task.isCompleted });
        } else if (event.key === 'Delete') {
            event.preventDefault();
            requestDelete();
        }
    };

    // Row actions keep out of the way until hover or keyboard focus on desktop; below md
    // there is no hover, so they always show. What is state rather than an action stays
    // visible: the focus marker, an armed delete, and the high-priority flag.
    const reveal = (pinned: boolean) =>
        pinned ? undefined : 'md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100';

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
            ref={rowRef}
            layout
            data-task-row={task.id}
            tabIndex={nav.isActive ? 0 : -1}
            onFocus={nav.onFocus}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setArmed(false);
            }}
            onKeyDown={handleKeyDown}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.18 }}
            className="group flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-white/5 focus-visible:outline-ember focus-visible:outline-2"
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
                        onClick={startRename}
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
                        onBlur={() => {
                            if (!renameEnded.current) commitRename();
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                endRename(true);
                            } else if (event.key === 'Escape') {
                                event.preventDefault();
                                endRename(false);
                            }
                        }}
                        aria-label="Task name"
                        className="focus-visible:outline-ember text-ink block w-full rounded bg-white/5 px-1 py-0.5 text-sm outline-none focus-visible:outline-2"
                    />
                )}
                {(task.dueAt || focusTotal) && (
                    <span className="mt-0.5 flex items-center gap-2">
                        {task.dueAt && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        type="button"
                                        className={cn(
                                            'flex items-center gap-1 text-[11px] transition hover:underline',
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
                        {focusTotal && (
                            <span
                                className="text-ink-dim flex items-center gap-1 text-[11px]"
                                title={focusLabelOf(focusTotal)}
                            >
                                <Timer className="h-3 w-3" aria-hidden />
                                <span aria-hidden>{formatFocusDuration(focusTotal.totalSeconds)}</span>
                                <span className="sr-only">{focusLabelOf(focusTotal)}</span>
                            </span>
                        )}
                    </span>
                )}
            </span>

            <div className="flex items-center gap-1">
                {!task.isCompleted && (
                    <button
                        type="button"
                        onClick={() => setFocusTask(isFocused ? null : task.id)}
                        aria-pressed={isFocused}
                        className={cn(
                            'rounded p-1 transition hover:bg-white/10',
                            isFocused ? 'text-ember' : 'text-ink-dim hover:text-ink-mid',
                            reveal(isFocused),
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
                                className={cn(
                                    'rounded p-1 text-ink-dim transition hover:bg-white/10 hover:text-ink-mid',
                                    reveal(false),
                                )}
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
                            className={cn(
                                'rounded p-1 transition hover:bg-white/10',
                                meta.accent,
                                reveal(task.priority === 'high'),
                            )}
                            aria-label={`Task priority: ${meta.label}`}
                        >
                            <Flag className="h-3.5 w-3.5" fill={meta.flagFill} />
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
                                <Flag className={cn('h-3.5 w-3.5', option.accent)} fill={option.flagFill} />
                                {option.label}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
                <button
                    type="button"
                    onClick={requestDelete}
                    disabled={deleteTask.isPending}
                    className={cn(
                        'rounded p-1 transition hover:bg-white/10',
                        armed ? 'bg-rose-400/15 text-rose-300' : 'text-ink-dim hover:text-rose-300',
                        reveal(armed),
                    )}
                    aria-label={armed ? `Delete “${task.text}”? Press again to confirm` : `Delete “${task.text}”`}
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </button>
                {/* Always-mounted live region: arming has no text of its own, and from the
                    keyboard the label that changes is not the one focus sits on. */}
                <span role="status" aria-live="polite" className="sr-only">
                    {armed ? `Press Delete again to remove “${task.text}”` : ''}
                </span>
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
    const openCount = tasks.filter((task) => !task.isCompleted).length;
    const { enabled: resizable, size, resizing, onResizeStart } = panel;
    const groups = groupTasks(tasks);
    const rowNav = useRowNavigation(groups.flatMap((group) => group.tasks.map((task) => task.id)));

    const focusTotalsQuery = useTaskFocusTotalsQuery();
    const focusTotals = useMemo(
        () => new Map((focusTotalsQuery.data ?? []).map((total) => [total.taskId, total])),
        [focusTotalsQuery.data],
    );

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

                <ul ref={rowNav.listRef} className="space-y-0.5">
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
                                          {group.id === 'done' && <ClearCompletedButton count={group.tasks.length} />}
                                      </motion.li>,
                                  ]
                                : []),
                            ...group.tasks.map((task) => (
                                <TaskRow
                                    key={task.id}
                                    task={task}
                                    focusTotal={focusTotals.get(task.id)}
                                    nav={rowNav.rowProps(task.id)}
                                />
                            )),
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
