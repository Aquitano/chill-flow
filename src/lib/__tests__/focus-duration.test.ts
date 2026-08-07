import { describe, expect, it } from 'vitest';
import { formatFocusDuration } from '../focus-duration';

describe('formatFocusDuration', () => {
    it('reads in minutes below an hour', () => {
        expect(formatFocusDuration(25 * 60)).toBe('25m');
        expect(formatFocusDuration(59 * 60)).toBe('59m');
    });

    it('rolls over to hours and minutes', () => {
        expect(formatFocusDuration(60 * 60)).toBe('1h');
        expect(formatFocusDuration(80 * 60)).toBe('1h 20m');
        expect(formatFocusDuration(200 * 60)).toBe('3h 20m');
    });

    it('drops the minutes on a whole number of hours', () => {
        expect(formatFocusDuration(2 * 60 * 60)).toBe('2h');
    });

    it('floors at a minute, so recorded focus never reads as none', () => {
        expect(formatFocusDuration(0)).toBe('1m');
        expect(formatFocusDuration(20)).toBe('1m');
    });
});
