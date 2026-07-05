import { describe, expect, it } from 'vitest';
import { DEFAULT_PRIORITY, parseTaskInput, resolvePriority, stripPriorityTokens } from '../task-parser';

describe('parseTaskInput', () => {
    it('returns trimmed text and no token when nothing is typed', () => {
        const parsed = parseTaskInput('  write the report  ');
        expect(parsed).toEqual({
            text: 'write the report',
            priority: null,
            dueAt: null,
            dueHasTime: false,
            tokens: [],
            token: null,
        });
    });

    it('maps p1-p3 onto high/medium/low', () => {
        expect(parseTaskInput('ship it p1').priority).toBe('high');
        expect(parseTaskInput('ship it p2').priority).toBe('medium');
        expect(parseTaskInput('ship it p3').priority).toBe('low');
    });

    it('treats p4 as "no priority" (null) and clears to the default on resolve', () => {
        const parsed = parseTaskInput('ship it p4');
        expect(parsed.priority).toBeNull();
        expect(parsed.token?.level).toBe(4);
        expect(resolvePriority(parsed, 'high')).toBe(DEFAULT_PRIORITY);
    });

    it('strips the token from the text and collapses the gap', () => {
        expect(parseTaskInput('buy p1 milk').text).toBe('buy milk');
        expect(parseTaskInput('p2 buy milk').text).toBe('buy milk');
        expect(parseTaskInput('buy milk p3').text).toBe('buy milk');
    });

    it('is case-insensitive', () => {
        const parsed = parseTaskInput('ship it P1');
        expect(parsed.priority).toBe('high');
        expect(parsed.token?.raw).toBe('P1');
    });

    it('only matches a standalone token, not text embedded in a word', () => {
        expect(parseTaskInput('step1 of the plan').token).toBeNull();
        expect(parseTaskInput('deploy p12').token).toBeNull();
        expect(parseTaskInput('priority p5 work').token).toBeNull();
    });

    it('uses the last priority when several are typed and strips them all', () => {
        const parsed = parseTaskInput('p1 draft p3 outline');
        expect(parsed.priority).toBe('low');
        expect(parsed.text).toBe('draft outline');
    });

    it('reports the token span against the raw (untrimmed) input', () => {
        const raw = 'buy milk p1';
        const { token } = parseTaskInput(raw);
        expect(token).not.toBeNull();
        expect(raw.slice(token!.start, token!.end)).toBe('p1');
    });

    it('falls back to the manual priority when no token is present', () => {
        const parsed = parseTaskInput('just a task');
        expect(resolvePriority(parsed, 'high')).toBe('high');
    });
});

describe('stripPriorityTokens', () => {
    it('removes every standalone token, not just the last', () => {
        expect(stripPriorityTokens('email p2 boss p1')).toBe('email boss');
        expect(stripPriorityTokens('p1 draft p3 outline')).toBe('draft outline');
    });

    it('leaves text without tokens untouched (trimmed)', () => {
        expect(stripPriorityTokens('  write the report  ')).toBe('write the report');
        expect(stripPriorityTokens('step1 of the plan')).toBe('step1 of the plan');
    });

    it('handles adjacent tokens and collapses the gap', () => {
        expect(stripPriorityTokens('p1 p2 ship it')).toBe('ship it');
        expect(stripPriorityTokens('ship it p4')).toBe('ship it');
    });
});

describe('parseTaskInput due dates', () => {
    // Wednesday, 3 Jan 2024, 09:30 local. All expected dates are built with the same local
    // constructor so the assertions hold in any timezone.
    const NOW = new Date(2024, 0, 3, 9, 30);
    const at = (input: string) => parseTaskInput(input, { now: NOW });

    it('resolves relative day keywords date-only at local midnight', () => {
        expect(at('ship it today').dueAt).toEqual(new Date(2024, 0, 3));
        expect(at('ship it tod').dueAt).toEqual(new Date(2024, 0, 3));
        expect(at('ship it tomorrow').dueAt).toEqual(new Date(2024, 0, 4));
        expect(at('ship it tmr').dueAt).toEqual(new Date(2024, 0, 4));
        expect(at('ship it tom').dueAt).toEqual(new Date(2024, 0, 4));
        const parsed = at('ship it today');
        expect(parsed.dueHasTime).toBe(false);
        expect(parsed.text).toBe('ship it');
    });

    it('resolves tonight to 20:00 today with a time', () => {
        const parsed = at('call mom tonight');
        expect(parsed.dueAt).toEqual(new Date(2024, 0, 3, 20, 0));
        expect(parsed.dueHasTime).toBe(true);
    });

    it('resolves a future weekday within the coming 7 days', () => {
        expect(at('demo friday').dueAt).toEqual(new Date(2024, 0, 5));
        expect(at('demo fri').dueAt).toEqual(new Date(2024, 0, 5));
        // Monday is in the past this week, so it lands on the next Monday.
        expect(at('demo monday').dueAt).toEqual(new Date(2024, 0, 8));
    });

    it('treats the current weekday with no time as today', () => {
        const parsed = at('standup wednesday');
        expect(parsed.dueAt).toEqual(new Date(2024, 0, 3));
        expect(parsed.dueHasTime).toBe(false);
    });

    it('keeps the current weekday today when the attached time is still ahead', () => {
        expect(at('standup wednesday 5pm').dueAt).toEqual(new Date(2024, 0, 3, 17, 0));
    });

    it('rolls the current weekday a week out when the attached time has passed', () => {
        expect(at('standup wednesday 8am').dueAt).toEqual(new Date(2024, 0, 10, 8, 0));
    });

    it('resolves next <weekday> as the bare weekday plus a week', () => {
        expect(at('review next monday').dueAt).toEqual(new Date(2024, 0, 15));
        expect(at('review next friday').dueAt).toEqual(new Date(2024, 0, 12));
    });

    it('resolves next week to the following Monday', () => {
        const parsed = at('plan next week');
        expect(parsed.dueAt).toEqual(new Date(2024, 0, 8));
        expect(parsed.dueHasTime).toBe(false);
    });

    it('resolves in N days / weeks date-only', () => {
        expect(at('call in 3 days').dueAt).toEqual(new Date(2024, 0, 6));
        expect(at('call in 2 weeks').dueAt).toEqual(new Date(2024, 0, 17));
        expect(at('call in a day').dueAt).toEqual(new Date(2024, 0, 4));
        expect(at('call in 1 week').dueAt).toEqual(new Date(2024, 0, 10));
    });

    it('resolves in N hours from the current moment with a time', () => {
        const hours = at('call in 5 hours');
        expect(hours.dueAt).toEqual(new Date(2024, 0, 3, 14, 30));
        expect(hours.dueHasTime).toBe(true);
        expect(at('call in an hour').dueAt).toEqual(new Date(2024, 0, 3, 10, 30));
    });

    it('resolves explicit day-month, rolling the year when already past', () => {
        expect(at('gift jan 15').dueAt).toEqual(new Date(2024, 0, 15));
        expect(at('gift 15 jan').dueAt).toEqual(new Date(2024, 0, 15));
        expect(at('gift december 25').dueAt).toEqual(new Date(2024, 11, 25));
        // 1 Jan is behind the 3 Jan "now", so it rolls to next year.
        expect(at('party jan 1').dueAt).toEqual(new Date(2025, 0, 1));
    });

    it('honours an explicit year on a month-day expression', () => {
        expect(at('launch january 20 2027').dueAt).toEqual(new Date(2027, 0, 20));
    });

    it('parses ISO and European date forms', () => {
        expect(at('release 2026-07-10').dueAt).toEqual(new Date(2026, 6, 10));
        expect(at('release 15.7.').dueAt).toEqual(new Date(2024, 6, 15));
        expect(at('release 15.7.2026').dueAt).toEqual(new Date(2026, 6, 15));
    });

    it('parses standalone times as today, or tomorrow once past', () => {
        expect(at('meeting 5pm').dueAt).toEqual(new Date(2024, 0, 3, 17, 0));
        expect(at('meeting 5:30pm').dueAt).toEqual(new Date(2024, 0, 3, 17, 30));
        expect(at('meeting 17:30').dueAt).toEqual(new Date(2024, 0, 3, 17, 30));
        // 08:00 is behind the 09:30 "now", so it lands tomorrow.
        expect(at('standup 8am').dueAt).toEqual(new Date(2024, 0, 4, 8, 0));
    });

    it('applies the bare "at N" heuristic (1-11 assumed PM, 12 noon, 13+ 24h)', () => {
        expect(at('meeting at 5').dueAt).toEqual(new Date(2024, 0, 3, 17, 0));
        expect(at('meeting at 8').dueAt).toEqual(new Date(2024, 0, 3, 20, 0));
        expect(at('meeting at 12').dueAt).toEqual(new Date(2024, 0, 3, 12, 0));
        expect(at('meeting at 14:00').dueAt).toEqual(new Date(2024, 0, 3, 14, 0));
    });

    it('combines a date with a trailing time', () => {
        expect(at('call tomorrow 5pm').dueAt).toEqual(new Date(2024, 0, 4, 17, 0));
        expect(at('call fri at 14:00').dueAt).toEqual(new Date(2024, 0, 5, 14, 0));
        expect(at('call tomorrow 5pm').dueHasTime).toBe(true);
    });

    it('only matches whole words, never inside a word', () => {
        expect(at('play monopoly').dueAt).toBeNull();
        expect(at('write atomic notes').dueAt).toBeNull();
        expect(at('summon the team').dueAt).toBeNull();
        expect(at('buy 5 apples').dueAt).toBeNull();
        expect(at('buy 5 apples').text).toBe('buy 5 apples');
    });

    it('lets the last date expression win when several appear', () => {
        const parsed = at('call mom monday or friday');
        expect(parsed.dueAt).toEqual(new Date(2024, 0, 5));
        expect(parsed.text).toBe('call mom or');
        expect(parsed.tokens.filter((token) => token.type === 'date')).toHaveLength(2);
    });

    it('strips a date token when it sits at the end of the input', () => {
        const parsed = at('pay rent friday');
        expect(parsed.text).toBe('pay rent');
        expect(parsed.dueAt).toEqual(new Date(2024, 0, 5));
    });

    it('reduces text to empty when the whole input is a token', () => {
        expect(at('tomorrow').text).toBe('');
        expect(at('tomorrow').dueAt).toEqual(new Date(2024, 0, 4));
        expect(at('p1').text).toBe('');
    });

    it('parses a combined priority and due date', () => {
        const parsed = at('pay rent friday p1');
        expect(parsed.text).toBe('pay rent');
        expect(parsed.priority).toBe('high');
        expect(parsed.dueAt).toEqual(new Date(2024, 0, 5));
        expect(parsed.tokens.map((token) => token.type).sort()).toEqual(['date', 'priority']);
    });

    it('reports date token spans against the original input', () => {
        const raw = 'ship it tomorrow';
        const parsed = at(raw);
        const dateToken = parsed.tokens.find((token) => token.type === 'date');
        expect(dateToken).toBeDefined();
        expect(raw.slice(dateToken!.start, dateToken!.end)).toBe('tomorrow');
    });

    it('defaults now to the current time when no option is given', () => {
        const parsed = parseTaskInput('ship it tomorrow');
        expect(parsed.dueAt).not.toBeNull();
        expect(parsed.dueHasTime).toBe(false);
    });
});
