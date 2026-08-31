'use client';

import { useDailyFocusQuery } from '@/hooks/use-app-data';
import { formatFocusDuration } from '@/lib/focus-duration';
import { fillDailySeries, localDayKey, weekComparison } from '@/lib/progress';

const TREND_DAYS = 14;

/** formatFocusDuration floors at "1m"; an empty day or week must read as none at all. */
function formatTotal(seconds: number): string {
    return seconds === 0 ? '0m' : formatFocusDuration(seconds);
}

function dayTitle(day: string, seconds: number): string {
    const label = new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
    });
    return `${label} — ${formatTotal(seconds)}`;
}

/**
 * Daily focus minutes over the last two weeks, with this week held against last week.
 * The honest "how am I doing" — real recorded blocks per calendar day, no derived scores.
 */
export function FocusTrend({ enabled }: { enabled: boolean }) {
    const dailyQuery = useDailyFocusQuery(enabled);

    // While loading (or failed), the totals and history around this still stand on their
    // own; a strip that pops in beats a spinner for a secondary read.
    if (!dailyQuery.data) return null;

    const today = localDayKey();
    const series = fillDailySeries(dailyQuery.data, today, TREND_DAYS);
    const { thisWeekSeconds, lastWeekSeconds } = weekComparison(dailyQuery.data, today);
    const peakSeconds = Math.max(...series.map((day) => day.totalSeconds));

    return (
        <section aria-label={`Focus per day, last ${TREND_DAYS} days`}>
            <header className="flex items-baseline justify-between border-b border-white/8 pb-1.5">
                <h4 className="text-ink-dim text-[10px] font-medium tracking-wide uppercase">
                    Last {TREND_DAYS} days
                </h4>
                <p className="text-ink-mid text-xs tabular-nums">
                    {formatTotal(thisWeekSeconds)} this week · {formatTotal(lastWeekSeconds)} last week
                </p>
            </header>

            <ul className="mt-3 flex h-12 items-end gap-1">
                {series.map((day) => (
                    <li key={day.day} className="flex h-full flex-1 items-end" title={dayTitle(day.day, day.totalSeconds)}>
                        <span className="sr-only">{dayTitle(day.day, day.totalSeconds)}</span>
                        <span
                            aria-hidden
                            className={
                                day.totalSeconds === 0
                                    ? 'h-0.5 w-full rounded-full bg-white/10'
                                    : day.day === today
                                      ? 'bg-ember w-full rounded-t-sm'
                                      : 'bg-ember/55 w-full rounded-t-sm'
                            }
                            style={
                                day.totalSeconds === 0
                                    ? undefined
                                    : { height: `${Math.max((day.totalSeconds / peakSeconds) * 100, 6)}%` }
                            }
                        />
                    </li>
                ))}
            </ul>
        </section>
    );
}
