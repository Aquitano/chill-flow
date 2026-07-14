import { dueState, formatDue, formatDueDay, quickDueOptions } from '@/lib/task-dates';
import { describe, expect, it } from 'vitest';

// Wednesday, 8 July 2026, 14:30 local time.
const NOW = new Date(2026, 6, 8, 14, 30);

describe('dueState', () => {
    it('treats a date-only due today as today, not overdue', () => {
        expect(dueState(new Date(2026, 6, 8), false, NOW)).toBe('today');
    });

    it('marks a date-only due overdue from the next day', () => {
        expect(dueState(new Date(2026, 6, 7), false, NOW)).toBe('overdue');
    });

    it('marks a timed due overdue once the minute passes', () => {
        expect(dueState(new Date(2026, 6, 8, 14, 0), true, NOW)).toBe('overdue');
        expect(dueState(new Date(2026, 6, 8, 15, 0), true, NOW)).toBe('today');
    });

    it('marks future days upcoming regardless of time', () => {
        expect(dueState(new Date(2026, 6, 9, 0, 0), true, NOW)).toBe('upcoming');
        expect(dueState(new Date(2026, 11, 24), false, NOW)).toBe('upcoming');
    });
});

describe('formatDueDay', () => {
    it('labels the near days by name', () => {
        expect(formatDueDay(new Date(2026, 6, 8), NOW)).toBe('Today');
        expect(formatDueDay(new Date(2026, 6, 9), NOW)).toBe('Tomorrow');
        expect(formatDueDay(new Date(2026, 6, 7), NOW)).toBe('Yesterday');
    });

    it('uses the weekday inside a week and a date beyond it', () => {
        const friday = new Date(2026, 6, 10);
        expect(formatDueDay(friday, NOW)).toBe(friday.toLocaleDateString(undefined, { weekday: 'short' }));

        const nextWednesday = new Date(2026, 6, 15);
        expect(formatDueDay(nextWednesday, NOW)).toBe(
            nextWednesday.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
        );
    });

    it('appends the year when it differs from the current one', () => {
        const nextYear = new Date(2027, 0, 5);
        expect(formatDueDay(nextYear, NOW)).toBe(
            nextYear.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
        );
    });
});

describe('formatDue', () => {
    it('appends the clock time only for timed dues', () => {
        const due = new Date(2026, 6, 9, 17, 0);
        expect(formatDue(due, false, NOW)).toBe('Tomorrow');
        expect(formatDue(due, true, NOW)).toBe(
            `Tomorrow ${due.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`,
        );
    });
});

describe('quickDueOptions', () => {
    it('offers today, tomorrow, and next Monday at midnight', () => {
        const [today, tomorrow, nextWeek] = quickDueOptions(NOW);
        expect(today?.dueAt).toEqual(new Date(2026, 6, 8));
        expect(tomorrow?.dueAt).toEqual(new Date(2026, 6, 9));
        expect(nextWeek?.dueAt).toEqual(new Date(2026, 6, 13));
    });

    it('skips to the following Monday when today is Monday', () => {
        const monday = new Date(2026, 6, 13, 9, 0);
        const nextWeek = quickDueOptions(monday).find((option) => option.id === 'next-week');
        expect(nextWeek?.dueAt).toEqual(new Date(2026, 6, 20));
    });
});
