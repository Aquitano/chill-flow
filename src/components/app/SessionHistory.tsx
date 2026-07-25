'use client';

import { useSessionHistoryQuery } from '@/hooks/use-app-data';
import type { FocusSession } from '@/models/app';
import { useAppStore } from '@/store/app-store';

/** Past an hour of focus, "1h 20m" reads faster than "80m". */
function formatDuration(seconds: number): string {
    const minutes = Math.max(1, Math.round(seconds / 60));
    if (minutes < 60) return `${minutes}m`;

    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

function startOfLocalDay(date: Date): number {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayLabel(dayStart: number, todayStart: number, yesterdayStart: number): string {
    if (dayStart === todayStart) return 'Today';
    if (dayStart === yesterdayStart) return 'Yesterday';
    return new Date(dayStart).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

interface HistoryDay {
    dayStart: number;
    label: string;
    totalSeconds: number;
    sessions: FocusSession[];
}

/**
 * Grouped by the user's own day, not the UTC one the streak counts in — "Today" has to mean
 * today where they are. The server already orders newest first, so each day keeps that order.
 */
function groupByDay(sessions: FocusSession[]): HistoryDay[] {
    const todayStart = startOfLocalDay(new Date());
    const yesterdayStart = startOfLocalDay(new Date(todayStart - 12 * 60 * 60 * 1000));
    const days = new Map<number, HistoryDay>();

    for (const session of sessions) {
        const dayStart = startOfLocalDay(new Date(session.completedAt));
        const day = days.get(dayStart) ?? {
            dayStart,
            label: dayLabel(dayStart, todayStart, yesterdayStart),
            totalSeconds: 0,
            sessions: [],
        };

        day.totalSeconds += session.elapsedSeconds;
        day.sessions.push(session);
        days.set(dayStart, day);
    }

    return [...days.values()].sort((left, right) => right.dayStart - left.dayStart);
}

export function SessionHistory({ enabled }: { enabled: boolean }) {
    const historyQuery = useSessionHistoryQuery(enabled);
    const tasks = useAppStore((state) => state.tasks);

    if (historyQuery.isPending) {
        return <p className="text-ink-dim text-sm">Loading your recent blocks…</p>;
    }

    if (historyQuery.isError) {
        return <p className="text-ink-dim text-sm">Your recent blocks didn&apos;t load. Try reopening this panel.</p>;
    }

    const days = groupByDay(historyQuery.data ?? []);

    if (days.length === 0) {
        return <p className="text-ink-dim text-sm">Finish a focus block and it will show up here.</p>;
    }

    return (
        <div className="space-y-4">
            {days.map((day) => (
                <section key={day.dayStart}>
                    <header className="flex items-baseline justify-between border-b border-white/8 pb-1.5">
                        <h4 className="text-ink-dim text-[10px] font-medium tracking-wide uppercase">{day.label}</h4>
                        <span className="text-ink-mid text-xs tabular-nums">{formatDuration(day.totalSeconds)}</span>
                    </header>

                    <ul>
                        {day.sessions.map((session) => {
                            // A task deleted since the block ran leaves nothing to name it by,
                            // so fall back to which timer produced it.
                            const task = tasks.find((entry) => entry.id === session.taskId);
                            const label = task?.text ?? (session.timerKind === 'pomodoro' ? 'Pomodoro' : 'Focus');

                            return (
                                <li key={session.id} className="flex items-center gap-3 py-1.5">
                                    <span className="text-ink-dim shrink-0 text-xs tabular-nums">
                                        {new Date(session.completedAt).toLocaleTimeString(undefined, {
                                            hour: 'numeric',
                                            minute: '2-digit',
                                        })}
                                    </span>
                                    <span className="text-ink-mid min-w-0 flex-1 truncate text-sm">{label}</span>
                                    {session.cycleCompletedAt && (
                                        <>
                                            <span className="bg-ember/80 h-1.5 w-1.5 shrink-0 rounded-full" aria-hidden />
                                            <span className="sr-only">Completed a full Pomodoro cycle.</span>
                                        </>
                                    )}
                                    <span className="text-ink shrink-0 text-xs tabular-nums">
                                        {formatDuration(session.elapsedSeconds)}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            ))}
        </div>
    );
}
