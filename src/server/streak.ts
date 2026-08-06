/**
 * Day-streak arithmetic, kept apart from the repository so it can be tested without a
 * database.
 *
 * A "day" here is the user's calendar day, never the UTC one. A session finished at 6pm in
 * UTC-8 lands on the *next* UTC date, so counting in UTC splits an evening habit across two
 * days and opens gaps the user never actually left.
 */

/** en-CA formats as YYYY-MM-DD, which is also the order these keys sort in. */
const DAY_KEY_LOCALE = 'en-CA';

export const FALLBACK_TIME_ZONE = 'UTC';

export function isSupportedTimeZone(value: string): boolean {
    try {
        new Intl.DateTimeFormat(DAY_KEY_LOCALE, { timeZone: value });
        return true;
    } catch {
        return false;
    }
}

export function dayKeyInZone(instant: Date, timeZone: string): string {
    return new Intl.DateTimeFormat(DAY_KEY_LOCALE, {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(instant);
}

/**
 * Plain calendar arithmetic on the label — the UTC accessors never touch a real zone here,
 * so DST shifts can't move the answer.
 */
function previousDayKey(dayKey: string): string {
    const previous = new Date(`${dayKey}T00:00:00.000Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    return previous.toISOString().slice(0, 10);
}

/**
 * Consecutive days of focus ending today. Days may arrive in any order and repeat.
 *
 * A streak that hasn't been fed since before yesterday has lapsed and reads 0; yesterday
 * still counts, because today isn't over yet and the user hasn't broken anything.
 */
export function calculateCurrentStreak(sessionDays: string[], todayKey: string): number {
    const sortedDays = Array.from(new Set(sessionDays)).sort((left, right) => right.localeCompare(left));
    const newestDay = sortedDays[0];

    if (!newestDay) {
        return 0;
    }

    if (newestDay !== todayKey && newestDay !== previousDayKey(todayKey)) {
        return 0;
    }

    let streak = 1;
    let expectedDay = previousDayKey(newestDay);

    for (const day of sortedDays.slice(1)) {
        if (day !== expectedDay) {
            break;
        }

        streak += 1;
        expectedDay = previousDayKey(day);
    }

    return streak;
}
