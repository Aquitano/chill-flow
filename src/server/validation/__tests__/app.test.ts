import { describe, expect, it } from 'vitest';
import {
    startSessionInputSchema,
    trackLookupInputSchema,
    updatePreferencesInputSchema,
    updateTaskInputSchema,
} from '../app';

describe('backend validation', () => {
    it('rejects malformed task updates', () => {
        const result = updateTaskInputSchema.safeParse({
            id: 'not-a-uuid',
        });

        expect(result.success).toBe(false);
    });

    it('rejects out-of-range preference updates', () => {
        const result = updatePreferencesInputSchema.safeParse({
            volume: 101,
        });

        expect(result.success).toBe(false);
    });

    it('deduplicates liked track ids while preserving valid payloads', () => {
        const result = updatePreferencesInputSchema.parse({
            likedTrackIds: ['deep-focus-01', 'deep-focus-01', 'ambient-rain-02'],
        });

        expect(result.likedTrackIds).toEqual(['deep-focus-01', 'ambient-rain-02']);
    });

    it('rejects short focus sessions and unknown track lookups', () => {
        expect(
            startSessionInputSchema.safeParse({
                mode: 'DeepWork',
                durationSeconds: 30,
                trackId: 'deep-focus-01',
            }).success,
        ).toBe(false);

        expect(trackLookupInputSchema.safeParse({ id: 'unknown-track' }).success).toBe(false);
    });
});
