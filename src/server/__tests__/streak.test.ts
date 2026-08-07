import { describe, expect, it } from 'vitest';
import { FALLBACK_TIME_ZONE, calculateCurrentStreak, dayKeyInZone, isSupportedTimeZone } from '../streak';

describe('isSupportedTimeZone', () => {
    it('accepts IANA zones', () => {
        expect(isSupportedTimeZone('Europe/Berlin')).toBe(true);
        expect(isSupportedTimeZone('America/Los_Angeles')).toBe(true);
        expect(isSupportedTimeZone(FALLBACK_TIME_ZONE)).toBe(true);
    });

    it('rejects anything Intl cannot resolve', () => {
        expect(isSupportedTimeZone('Mars/Olympus_Mons')).toBe(false);
        expect(isSupportedTimeZone('')).toBe(false);
        expect(isSupportedTimeZone("'; drop table focus_sessions; --")).toBe(false);
    });
});

describe('dayKeyInZone', () => {
    it('formats the calendar day of the given zone', () => {
        const instant = new Date('2026-03-14T12:00:00.000Z');

        expect(dayKeyInZone(instant, 'UTC')).toBe('2026-03-14');
        expect(dayKeyInZone(instant, 'Europe/Berlin')).toBe('2026-03-14');
    });

    it('places a late-evening session on the local day, not the next UTC one', () => {
        // 6pm in Los Angeles is already the following day in UTC — the case that used to
        // split one evening habit across two streak days.
        const instant = new Date('2026-03-15T01:00:00.000Z');

        expect(dayKeyInZone(instant, 'UTC')).toBe('2026-03-15');
        expect(dayKeyInZone(instant, 'America/Los_Angeles')).toBe('2026-03-14');
    });

    it('places an early-morning session east of UTC on the local day', () => {
        const instant = new Date('2026-03-14T23:30:00.000Z');

        expect(dayKeyInZone(instant, 'Asia/Tokyo')).toBe('2026-03-15');
    });
});

describe('calculateCurrentStreak', () => {
    it('is zero with no sessions', () => {
        expect(calculateCurrentStreak([], '2026-03-14')).toBe(0);
    });

    it('counts consecutive days ending today', () => {
        expect(calculateCurrentStreak(['2026-03-14', '2026-03-13', '2026-03-12'], '2026-03-14')).toBe(3);
    });

    it('still counts a streak last fed yesterday, since today is not over', () => {
        expect(calculateCurrentStreak(['2026-03-13', '2026-03-12'], '2026-03-14')).toBe(2);
    });

    it('lapses once the newest day is older than yesterday', () => {
        expect(calculateCurrentStreak(['2026-03-01', '2026-02-28'], '2026-03-14')).toBe(0);
    });

    it('stops at the first gap', () => {
        expect(calculateCurrentStreak(['2026-03-14', '2026-03-13', '2026-03-11', '2026-03-10'], '2026-03-14')).toBe(2);
    });

    it('collapses several sessions on one day into a single day', () => {
        expect(calculateCurrentStreak(['2026-03-14', '2026-03-14', '2026-03-13'], '2026-03-14')).toBe(2);
    });

    it('does not depend on the order days arrive in', () => {
        expect(calculateCurrentStreak(['2026-03-12', '2026-03-14', '2026-03-13'], '2026-03-14')).toBe(3);
    });

    it('counts across a month boundary', () => {
        expect(calculateCurrentStreak(['2026-03-01', '2026-02-28', '2026-02-27'], '2026-03-01')).toBe(3);
    });

    it('counts across a leap day', () => {
        expect(calculateCurrentStreak(['2028-03-01', '2028-02-29', '2028-02-28'], '2028-03-01')).toBe(3);
    });

    it('counts across a year boundary', () => {
        expect(calculateCurrentStreak(['2026-01-01', '2025-12-31'], '2026-01-01')).toBe(2);
    });
});
