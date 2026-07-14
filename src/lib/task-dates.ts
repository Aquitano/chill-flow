/*
 * Display-side counterpart to the due-date parser: turns a stored `dueAt` +
 * `dueHasTime` pair into the short labels and urgency states the task UI shows.
 * All resolution is in local time, `now` injectable for tests.
 */

export type DueState = 'overdue' | 'today' | 'upcoming';

const DAY_MS = 86_400_000;

function startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** A date-only due is overdue from the next day; a timed due from the minute it passes. */
export function dueState(dueAt: Date, dueHasTime: boolean, now: Date = new Date()): DueState {
    const dayDiff = startOfDay(dueAt).getTime() - startOfDay(now).getTime();
    if (dayDiff < 0) return 'overdue';
    if (dayDiff === 0) {
        return dueHasTime && dueAt.getTime() < now.getTime() ? 'overdue' : 'today';
    }
    return 'upcoming';
}

/** Short label: Today / Tomorrow / Yesterday, a weekday within a week, else a date. */
export function formatDueDay(dueAt: Date, now: Date = new Date()): string {
    const diffDays = Math.round((startOfDay(dueAt).getTime() - startOfDay(now).getTime()) / DAY_MS);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays === -1) return 'Yesterday';
    if (diffDays > 1 && diffDays < 7) return dueAt.toLocaleDateString(undefined, { weekday: 'short' });
    const sameYear = dueAt.getFullYear() === now.getFullYear();
    return dueAt.toLocaleDateString(
        undefined,
        sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' },
    );
}

/** Full chip label, appending the clock time when the due date carries one. */
export function formatDue(dueAt: Date, dueHasTime: boolean, now: Date = new Date()): string {
    const day = formatDueDay(dueAt, now);
    if (!dueHasTime) return day;
    return `${day} ${dueAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

export interface QuickDueOption {
    id: 'today' | 'tomorrow' | 'next-week';
    label: string;
    dueAt: Date;
}

/** The quick-pick dates offered in due-date menus. "Next week" mirrors the parser: next Monday. */
export function quickDueOptions(now: Date = new Date()): QuickDueOption[] {
    const today = startOfDay(now);
    const toMonday = (1 - today.getDay() + 7) % 7 || 7;
    return [
        { id: 'today', label: 'Today', dueAt: today },
        {
            id: 'tomorrow',
            label: 'Tomorrow',
            dueAt: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1),
        },
        {
            id: 'next-week',
            label: 'Next week',
            dueAt: new Date(today.getFullYear(), today.getMonth(), today.getDate() + toMonday),
        },
    ];
}
