import { fillDailySeries, weekComparison } from '@/lib/progress';
import { describe, expect, it } from 'vitest';

describe('fillDailySeries', () => {
    it('zero-fills the window, oldest first, across a month boundary', () => {
        const series = fillDailySeries([{ day: '2026-03-01', totalSeconds: 600 }], '2026-03-02', 4);

        expect(series).toEqual([
            { day: '2026-02-27', totalSeconds: 0 },
            { day: '2026-02-28', totalSeconds: 0 },
            { day: '2026-03-01', totalSeconds: 600 },
            { day: '2026-03-02', totalSeconds: 0 },
        ]);
    });

    it('ignores rows outside the window', () => {
        const series = fillDailySeries([{ day: '2026-01-01', totalSeconds: 600 }], '2026-03-02', 2);
        expect(series.every((entry) => entry.totalSeconds === 0)).toBe(true);
    });
});

describe('weekComparison', () => {
    // 2026-08-26 is a Wednesday; its week starts Monday 2026-08-24.
    const today = '2026-08-26';

    it('splits days across the Monday boundary', () => {
        const { thisWeekSeconds, lastWeekSeconds } = weekComparison(
            [
                { day: '2026-08-24', totalSeconds: 100 }, // Monday, this week
                { day: '2026-08-26', totalSeconds: 20 }, // today
                { day: '2026-08-23', totalSeconds: 300 }, // Sunday, last week
                { day: '2026-08-17', totalSeconds: 40 }, // Monday, last week
            ],
            today,
        );

        expect(thisWeekSeconds).toBe(120);
        expect(lastWeekSeconds).toBe(340);
    });

    it('counts nothing from beyond either week', () => {
        const { thisWeekSeconds, lastWeekSeconds } = weekComparison(
            [{ day: '2026-08-16', totalSeconds: 500 }],
            today,
        );

        expect(thisWeekSeconds).toBe(0);
        expect(lastWeekSeconds).toBe(0);
    });

    it('starts a fresh week on a Monday', () => {
        const { thisWeekSeconds, lastWeekSeconds } = weekComparison(
            [
                { day: '2026-08-24', totalSeconds: 60 },
                { day: '2026-08-23', totalSeconds: 90 },
            ],
            '2026-08-24',
        );

        expect(thisWeekSeconds).toBe(60);
        expect(lastWeekSeconds).toBe(90);
    });
});
