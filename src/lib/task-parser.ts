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

export interface ParsedTaskInput {
    /** Raw input with the recognized token removed and whitespace collapsed. */
    text: string;
    /** Resolved priority from the token, or null when none recognized (or p4). */
    priority: TaskPriority | null;
    /** The matched token (drives the live highlight), or null. */
    token: PriorityToken | null;
}

// A standalone p1-p4 token: bounded by start/whitespace on the left and whitespace/end
// on the right, so "p1" matches but "step1", "p12", and "p5" do not. Case-insensitive.
const PRIORITY_TOKEN_SOURCE = String.raw`(?<=^|\s)p([1-4])(?=\s|$)`;

/** Fresh regex per call so the shared `lastIndex` of a global regex can't leak between calls. */
function priorityTokenRegex(): RegExp {
    return new RegExp(PRIORITY_TOKEN_SOURCE, 'giu');
}

/**
 * Parse a quick-add string for a trailing Todoist-style priority token. When several
 * tokens are present the last one wins, matching Todoist's behaviour.
 */
export function parseTaskInput(raw: string): ParsedTaskInput {
    const regex = priorityTokenRegex();
    let match: RegExpExecArray | null;
    let last: RegExpExecArray | null = null;
    while ((match = regex.exec(raw)) !== null) {
        last = match;
    }

    if (!last) {
        return { text: raw.trim(), priority: null, token: null };
    }

    const level = Number(last[1]) as PriorityLevel;
    const start = last.index;
    const end = start + last[0].length;
    const priority = LEVEL_TO_PRIORITY[level];

    // Drop the token and collapse the gap it leaves so "buy p1 milk" -> "buy milk".
    const text = (raw.slice(0, start) + raw.slice(end)).replace(/\s{2,}/g, ' ').trim();

    return {
        text,
        priority,
        token: { level, priority, start, end, raw: last[0] },
    };
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
