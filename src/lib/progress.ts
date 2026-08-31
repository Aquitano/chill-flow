import type { DailyFocus } from '@/models/app';

/**
 * Pure day-key arithmetic for the progress trend. Keys are YYYY-MM-DD in the user's
 * zone — the same buckets the server groups sessions by — so everything here is
 * calendar-label math: the UTC accessors never see a real zone, and DST can't move an
 * answer.
 */

/** Today's key in the browser's zone; en-CA formats as YYYY-MM-DD. */
export function localDayKey(date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function shiftDayKey(dayKey: string, days: number): string {
    const date = new Date(`${dayKey}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

/** The last `days` calendar days ending at `todayKey`, oldest first, zero-filled. */
export function fillDailySeries(rows: DailyFocus[], todayKey: string, days: number): DailyFocus[] {
    const byDay = new Map(rows.map((row) => [row.day, row.totalSeconds]));
    return Array.from({ length: days }, (_, index) => {
        const day = shiftDayKey(todayKey, index - (days - 1));
        return { day, totalSeconds: byDay.get(day) ?? 0 };
    });
}

/** Monday-start weeks: focus banked so far this week against the whole previous week. */
export function weekComparison(
    rows: DailyFocus[],
    todayKey: string,
): { thisWeekSeconds: number; lastWeekSeconds: number } {
    const daysSinceMonday = (new Date(`${todayKey}T00:00:00.000Z`).getUTCDay() + 6) % 7;
    const weekStart = shiftDayKey(todayKey, -daysSinceMonday);
    const lastWeekStart = shiftDayKey(weekStart, -7);

    let thisWeekSeconds = 0;
    let lastWeekSeconds = 0;
    for (const row of rows) {
        if (row.day >= weekStart && row.day <= todayKey) {
            thisWeekSeconds += row.totalSeconds;
        } else if (row.day >= lastWeekStart && row.day < weekStart) {
            lastWeekSeconds += row.totalSeconds;
        }
    }
    return { thisWeekSeconds, lastWeekSeconds };
}
