import type { Task } from '@/models/app';

export type TaskPriority = Task['priority'];

/** Default priority applied when no token is typed (and what p4 clears back to). */
export const DEFAULT_PRIORITY: TaskPriority = 'medium';

export const PRIORITY_LEVELS = [1, 2, 3, 4] as const;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];

/**
 * Todoist uses four priority tokens (p1 highest); we only have three levels, so p4 is
 * treated as "no priority" and resolves to null — the caller falls back to the default.
 */
const LEVEL_TO_PRIORITY: Record<PriorityLevel, TaskPriority | null> = {
    1: 'high',
    2: 'medium',
    3: 'low',
    4: null,
};

export interface PriorityToken {
    /** 1-4, matching the typed `p1`-`p4`. */
    level: PriorityLevel;
    /** Resolved priority, or null for p4 (clears to the default). */
    priority: TaskPriority | null;
    /** Index of the token's first character (`p`) in the raw input. */
    start: number;
    /** Index one past the token's last character. */
    end: number;
    /** Exact matched text, preserving case, e.g. "p1" or "P3". */
    raw: string;
}

/** A recognized token (priority or due date) with its span in the original input. */
export interface ParsedToken {
    type: 'priority' | 'date';
    /** Index of the token's first character in the original input. */
    start: number;
    /** Index one past the token's last character (exclusive). */
    end: number;
    /** Exact matched text, preserving case. */
    raw: string;
}

export interface ParsedTaskInput {
    /** Input with every recognized token removed and whitespace collapsed/trimmed. */
    text: string;
    /** Resolved priority (last p-token wins), or null when none recognized (or p4). */
    priority: TaskPriority | null;
    /** Resolved due date (last date expression wins), or null when none recognized. */
    dueAt: Date | null;
    /** True when dueAt carries an explicit time of day. */
    dueHasTime: boolean;
    /** Every recognized token with its span, for inline highlighting. */
    tokens: ParsedToken[];
    /**
     * The last priority token, kept for the existing inline highlight input. Prefer
     * `tokens` for new code; this stays for backwards compatibility.
     */
    token: PriorityToken | null;
}

// A standalone p1-p4 token: bounded by start/whitespace on the left and whitespace/end
// on the right, so "p1" matches but "step1", "p12", and "p5" do not. Case-insensitive.
const PRIORITY_TOKEN_SOURCE = String.raw`(?<=^|\s)p([1-4])(?=\s|$)`;

/** Fresh regex per call so the shared `lastIndex` of a global regex can't leak between calls. */
function priorityTokenRegex(): RegExp {
    return new RegExp(PRIORITY_TOKEN_SOURCE, 'giu');
}

const WEEKDAYS: Record<string, number> = {
    sunday: 0,
    sun: 0,
    monday: 1,
    mon: 1,
    tuesday: 2,
    tue: 2,
    wednesday: 3,
    wed: 3,
    thursday: 4,
    thu: 4,
    friday: 5,
    fri: 5,
    saturday: 6,
    sat: 6,
};

const MONTHS: Record<string, number> = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11,
};

const WEEKDAY_SOURCE = 'sunday|saturday|thursday|tuesday|wednesday|monday|friday|sun|sat|thu|tue|wed|mon|fri';
const MONTH_SOURCE =
    'january|february|september|november|december|october|august|march|april|june|july|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';

/** A resolved due date plus whether it carries a meaningful time of day. */
interface DueResolution {
    dueAt: Date;
    dueHasTime: boolean;
}

interface TimeMatch {
    end: number;
    hour: number;
    minute: number;
}

interface DateMatch {
    end: number;
    /** Builds the final due date given an optional time attached to the expression. */
    build: (time: { hour: number; minute: number } | null) => DueResolution;
}

function isWordChar(ch: string | undefined): boolean {
    return ch !== undefined && /[A-Za-z0-9]/.test(ch);
}

/**
 * Parse a quick-add string for Todoist-style priority tokens and natural-language due
 * dates. Priority and date each follow last-match-wins; every recognized token is stripped
 * from `text` and reported in `tokens` for inline highlighting. All resolution is in local
 * time and always lands today or in the future.
 *
 * Documented ambiguity choices:
 * - Bare `at N` (no am/pm): N>=13 is read as 24-hour; N in 1-11 is assumed PM (evening is
 *   the common intent for a bare task time), 12 stays noon.
 * - A time only attaches to a date it directly follows ("tomorrow 5pm"); a leading time
 *   ("5pm tomorrow") is a separate expression and loses to the later date under last-wins.
 * - `next <weekday>` = the bare-weekday resolution plus 7 days.
 */
export function parseTaskInput(input: string, options?: { now?: Date }): ParsedTaskInput {
    const now = options?.now ?? new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const tokens: ParsedToken[] = [];

    const { priority, token } = collectPriority(input, tokens);
    const due = collectDueDate(input, now, today, tokens);

    tokens.sort((left, right) => left.start - right.start);

    return {
        text: stripSpans(input, tokens),
        priority,
        dueAt: due?.dueAt ?? null,
        dueHasTime: due?.dueHasTime ?? false,
        tokens,
        token,
    };
}

/** Find every priority token, record spans, and resolve the last one (Todoist semantics). */
function collectPriority(
    input: string,
    tokens: ParsedToken[],
): { priority: TaskPriority | null; token: PriorityToken | null } {
    const regex = priorityTokenRegex();
    let match: RegExpExecArray | null;
    let token: PriorityToken | null = null;

    while ((match = regex.exec(input)) !== null) {
        const level = Number(match[1]) as PriorityLevel;
        const start = match.index;
        const end = start + match[0].length;
        const priority = LEVEL_TO_PRIORITY[level];
        tokens.push({ type: 'priority', start, end, raw: match[0] });
        token = { level, priority, start, end, raw: match[0] };
    }

    return { priority: token?.priority ?? null, token };
}

/** Scan for date/time expressions, record spans, and resolve the last expression. */
function collectDueDate(input: string, now: Date, today: Date, tokens: ParsedToken[]): DueResolution | null {
    let resolved: DueResolution | null = null;

    for (let i = 0; i < input.length; ) {
        if (isWordChar(input[i - 1])) {
            i += 1;
            continue;
        }

        const expression = matchDueExpression(input, i, now, today);
        if (!expression) {
            i += 1;
            continue;
        }

        tokens.push({ type: 'date', start: i, end: expression.end, raw: input.slice(i, expression.end) });
        resolved = expression.resolution;
        i = expression.end;
    }

    return resolved;
}

/** A date, optionally followed by a time, or a standalone time. */
function matchDueExpression(
    input: string,
    i: number,
    now: Date,
    today: Date,
): { end: number; resolution: DueResolution } | null {
    const date = matchDate(input, i, now, today);
    if (date) {
        let end = date.end;
        let time: { hour: number; minute: number } | null = null;

        if (/\s/.test(input.charAt(date.end))) {
            let k = date.end;
            while (/\s/.test(input.charAt(k))) k += 1;
            const trailing = matchTime(input, k);
            if (trailing) {
                end = trailing.end;
                time = { hour: trailing.hour, minute: trailing.minute };
            }
        }

        return { end, resolution: date.build(time) };
    }

    const time = matchTime(input, i);
    if (time) {
        // A bare time means today at that time, or tomorrow if it has already passed.
        const candidate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), time.hour, time.minute);
        const rolled = candidate.getTime() <= now.getTime() ? addDaysKeepTime(candidate, 1) : candidate;
        return { end: time.end, resolution: { dueAt: rolled, dueHasTime: true } };
    }

    return null;
}

function addDaysKeepTime(date: Date, days: number): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes());
}

/**
 * Build a due date from a base day and optional time. `rollUnitDays` rolls the result
 * forward by that many days when the timed result is not in the future; it only fires for
 * expressions whose base day is today (a future base day is already ahead of `now`).
 */
function makeDueBuilder(baseDay: Date, now: Date, rollUnitDays?: number): DateMatch['build'] {
    return (time) => {
        if (!time) {
            return { dueAt: new Date(baseDay.getFullYear(), baseDay.getMonth(), baseDay.getDate()), dueHasTime: false };
        }
        let dueAt = new Date(baseDay.getFullYear(), baseDay.getMonth(), baseDay.getDate(), time.hour, time.minute);
        if (rollUnitDays && dueAt.getTime() <= now.getTime()) {
            dueAt = addDaysKeepTime(dueAt, rollUnitDays);
        }
        return { dueAt, dueHasTime: true };
    };
}

function matchDate(input: string, i: number, now: Date, today: Date): DateMatch | null {
    return (
        matchIsoDate(input, i, now) ??
        matchEuropeanDate(input, i, now, today) ??
        matchMonthDay(input, i, now, today) ??
        matchDayMonth(input, i, now, today) ??
        matchRelativeIn(input, i, now, today) ??
        matchNextWeek(input, i, now, today) ??
        matchNextWeekday(input, i, now, today) ??
        matchWeekday(input, i, now, today) ??
        matchKeywordDay(input, i, now, today)
    );
}

function sticky(source: string, flags = ''): (input: string, at: number) => RegExpExecArray | null {
    const regex = new RegExp(source, `y${flags}`);
    return (input, at) => {
        regex.lastIndex = at;
        return regex.exec(input);
    };
}

const isoDate = sticky(String.raw`(\d{4})-(\d{2})-(\d{2})(?![A-Za-z0-9-])`);
const euroDateYear = sticky(String.raw`(\d{1,2})\.(\d{1,2})\.(\d{4})(?![A-Za-z0-9.])`);
const euroDate = sticky(String.raw`(\d{1,2})\.(\d{1,2})\.(?![A-Za-z0-9])`);
const monthDay = sticky(String.raw`(${MONTH_SOURCE})\s+(\d{1,2})(?:,?\s+(\d{4}))?(?![A-Za-z0-9])`, 'i');
const dayMonth = sticky(String.raw`(\d{1,2})\.?\s+(${MONTH_SOURCE})(?:\s+(\d{4}))?(?![A-Za-z0-9])`, 'i');
const relativeIn = sticky(String.raw`in\s+(\d+|an?)\s+(hours?|days?|weeks?)(?![A-Za-z0-9])`, 'i');
const nextWeek = sticky(String.raw`next\s+week(?![A-Za-z0-9])`, 'i');
const nextWeekday = sticky(String.raw`next\s+(${WEEKDAY_SOURCE})(?![A-Za-z0-9])`, 'i');
const weekday = sticky(String.raw`(${WEEKDAY_SOURCE})(?![A-Za-z0-9])`, 'i');
// No `tom` abbreviation: it would swallow the name Tom in "email Tom".
const keywordDay = sticky(String.raw`(today|tod|tomorrow|tmr|tonight)(?![A-Za-z0-9])`, 'i');

/** A calendar day is valid only if the Date round-trips to the same month and day. */
function validDay(year: number, month: number, day: number): boolean {
    const date = new Date(year, month, day);
    return date.getMonth() === month && date.getDate() === day;
}

function matchIsoDate(input: string, i: number, now: Date): DateMatch | null {
    const match = isoDate(input, i);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    if (month < 0 || month > 11 || !validDay(year, month, day)) return null;
    return { end: i + match[0].length, build: makeDueBuilder(new Date(year, month, day), now) };
}

function matchEuropeanDate(input: string, i: number, now: Date, today: Date): DateMatch | null {
    const withYear = euroDateYear(input, i);
    if (withYear) {
        const day = Number(withYear[1]);
        const month = Number(withYear[2]) - 1;
        const year = Number(withYear[3]);
        if (month < 0 || month > 11 || !validDay(year, month, day)) return null;
        return { end: i + withYear[0].length, build: makeDueBuilder(new Date(year, month, day), now) };
    }

    const match = euroDate(input, i);
    if (!match) return null;
    const day = Number(match[1]);
    const month = Number(match[2]) - 1;
    if (month < 0 || month > 11) return null;
    const baseDay = resolveYearlessDay(month, day, today);
    if (!baseDay) return null;
    return { end: i + match[0].length, build: makeDueBuilder(baseDay, now) };
}

function matchMonthDay(input: string, i: number, now: Date, today: Date): DateMatch | null {
    const match = monthDay(input, i);
    if (!match) return null;
    const month = MONTHS[match[1]!.toLowerCase()];
    const day = Number(match[2]);
    if (month === undefined) return null;
    const baseDay = match[3] ? explicitYearDay(Number(match[3]), month, day) : resolveYearlessDay(month, day, today);
    if (!baseDay) return null;
    return { end: i + match[0].length, build: makeDueBuilder(baseDay, now) };
}

function matchDayMonth(input: string, i: number, now: Date, today: Date): DateMatch | null {
    const match = dayMonth(input, i);
    if (!match) return null;
    const day = Number(match[1]);
    const month = MONTHS[match[2]!.toLowerCase()];
    if (month === undefined) return null;
    const baseDay = match[3] ? explicitYearDay(Number(match[3]), month, day) : resolveYearlessDay(month, day, today);
    if (!baseDay) return null;
    return { end: i + match[0].length, build: makeDueBuilder(baseDay, now) };
}

function explicitYearDay(year: number, month: number, day: number): Date | null {
    return validDay(year, month, day) ? new Date(year, month, day) : null;
}

/** Resolve a day/month with no year to this year, rolling to next year if already past. */
function resolveYearlessDay(month: number, day: number, today: Date): Date | null {
    let year = today.getFullYear();
    if (!validDay(year, month, day)) return null;
    if (new Date(year, month, day).getTime() < today.getTime()) {
        year += 1;
        if (!validDay(year, month, day)) return null;
    }
    return new Date(year, month, day);
}

function matchRelativeIn(input: string, i: number, now: Date, today: Date): DateMatch | null {
    const match = relativeIn(input, i);
    if (!match) return null;
    const count = /^an?$/i.test(match[1]!) ? 1 : Number(match[1]);
    const unit = match[2]!.toLowerCase();
    const end = i + match[0].length;

    if (unit.startsWith('hour')) {
        // "in N hours" is measured from the exact current moment, not from midnight.
        const dueAt = new Date(now.getTime());
        dueAt.setSeconds(0, 0);
        dueAt.setHours(dueAt.getHours() + count);
        return { end, build: () => ({ dueAt, dueHasTime: true }) };
    }

    const days = unit.startsWith('week') ? count * 7 : count;
    return { end, build: makeDueBuilder(new Date(today.getFullYear(), today.getMonth(), today.getDate() + days), now) };
}

function matchNextWeek(input: string, i: number, now: Date, today: Date): DateMatch | null {
    const match = nextWeek(input, i);
    if (!match) return null;
    // The Monday of next week: always strictly ahead of today.
    let delta = (1 - today.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    return {
        end: i + match[0].length,
        build: makeDueBuilder(new Date(today.getFullYear(), today.getMonth(), today.getDate() + delta), now),
    };
}

function matchNextWeekday(input: string, i: number, now: Date, today: Date): DateMatch | null {
    const match = nextWeekday(input, i);
    if (!match) return null;
    const target = WEEKDAYS[match[1]!.toLowerCase()];
    if (target === undefined) return null;
    const delta = (target - today.getDay() + 7) % 7;
    const baseDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + delta + 7);
    return { end: i + match[0].length, build: makeDueBuilder(baseDay, now) };
}

function matchWeekday(input: string, i: number, now: Date, today: Date): DateMatch | null {
    const match = weekday(input, i);
    if (!match) return null;
    const target = WEEKDAYS[match[1]!.toLowerCase()];
    if (target === undefined) return null;
    return { end: i + match[0].length, build: weekdayBuilder(target, now, today) };
}

/**
 * Resolve a weekday to its next occurrence within 7 days. The target weekday today counts
 * as today when it has no time or a still-future time; a time already past rolls to next
 * week.
 */
function weekdayBuilder(target: number, now: Date, today: Date): DateMatch['build'] {
    const delta = (target - today.getDay() + 7) % 7;
    const baseDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + delta);
    return makeDueBuilder(baseDay, now, 7);
}

function matchKeywordDay(input: string, i: number, now: Date, today: Date): DateMatch | null {
    const match = keywordDay(input, i);
    if (!match) return null;
    const keyword = match[1]!.toLowerCase();
    const end = i + match[0].length;

    if (keyword === 'tonight') {
        // Tonight defaults to 20:00 but honours an explicit time if one is attached.
        return {
            end,
            build: (time) => ({
                dueAt: new Date(
                    today.getFullYear(),
                    today.getMonth(),
                    today.getDate(),
                    time?.hour ?? 20,
                    time?.minute ?? 0,
                ),
                dueHasTime: true,
            }),
        };
    }

    const offset = keyword === 'tomorrow' || keyword === 'tmr' ? 1 : 0;
    return {
        end,
        build: makeDueBuilder(new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset), now),
    };
}

const colonTime = sticky(String.raw`(\d{1,2}):(\d{2})(?:\s?(am|pm))?(?![A-Za-z0-9])`, 'i');
const meridiemTime = sticky(String.raw`(\d{1,2})\s?(am|pm)(?![A-Za-z0-9])`, 'i');
const atPrefix = sticky(String.raw`at\s+`, 'i');
const bareHour = sticky(String.raw`(\d{1,2})(?![A-Za-z0-9:.])`);

function toTwentyFour(hour12: number, meridiem: string): number {
    const base = hour12 % 12;
    return meridiem.toLowerCase() === 'pm' ? base + 12 : base;
}

/** A clock time (`5pm`, `5:30pm`, `17:30`) or an `at N` / `at 17:30` form. Never a bare number. */
function matchTime(input: string, i: number): TimeMatch | null {
    const at = atPrefix(input, i);
    const clockAt = at ? i + at[0].length : i;

    const clock = matchClock(input, clockAt);
    if (clock) {
        return { end: clock.end, hour: clock.hour, minute: clock.minute };
    }

    if (at) {
        const bare = bareHour(input, clockAt);
        if (bare) {
            const value = Number(bare[1]);
            if (value >= 0 && value <= 23) {
                return { end: clockAt + bare[0].length, hour: bareAtHour(value), minute: 0 };
            }
        }
    }

    return null;
}

/** Bare `at N`: 13-23 is 24-hour; 1-11 is assumed PM; 12 is noon; 0 is midnight. */
function bareAtHour(value: number): number {
    if (value >= 13) return value;
    if (value === 12 || value === 0) return value;
    return value + 12;
}

function matchClock(input: string, at: number): TimeMatch | null {
    const colon = colonTime(input, at);
    if (colon) {
        const minute = Number(colon[2]);
        if (minute > 59) return null;
        if (colon[3]) {
            const hour12 = Number(colon[1]);
            if (hour12 < 1 || hour12 > 12) return null;
            return { end: at + colon[0].length, hour: toTwentyFour(hour12, colon[3]), minute };
        }
        const hour = Number(colon[1]);
        if (hour > 23) return null;
        return { end: at + colon[0].length, hour, minute };
    }

    const meridiem = meridiemTime(input, at);
    if (meridiem) {
        const hour12 = Number(meridiem[1]);
        if (hour12 < 1 || hour12 > 12) return null;
        return { end: at + meridiem[0].length, hour: toTwentyFour(hour12, meridiem[2]!), minute: 0 };
    }

    return null;
}

/** Remove the given spans from the input and collapse the whitespace they leave behind. */
export function stripSpans(input: string, spans: ParsedToken[]): string {
    if (spans.length === 0) {
        return input.trim();
    }

    let result = '';
    let cursor = 0;
    for (const span of spans) {
        result += input.slice(cursor, span.start);
        cursor = span.end;
    }
    result += input.slice(cursor);

    return result.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Remove every standalone priority token from the input. Used when a manual priority pick
 * should win over typing: `parseTaskInput` only strips the last token, so a second one
 * could otherwise survive and re-take control on the next render.
 */
export function stripPriorityTokens(raw: string): string {
    return raw
        .replace(priorityTokenRegex(), '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

/** Resolve a parsed input to the concrete priority to persist (p4 / no token -> default). */
export function resolvePriority(parsed: ParsedTaskInput, fallback: TaskPriority = DEFAULT_PRIORITY): TaskPriority {
    if (!parsed.token) {
        return fallback;
    }
    return parsed.priority ?? DEFAULT_PRIORITY;
}
