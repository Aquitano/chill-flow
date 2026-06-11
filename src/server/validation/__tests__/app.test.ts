import { describe, expect, it } from 'vitest';
import {
    cancelSessionInputSchema,
    completeSessionInputSchema,
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
                plannedDurationSeconds: 30,
                trackId: 'deep-focus-01',
            }).success,
        ).toBe(false);

        expect(trackLookupInputSchema.safeParse({ id: 'unknown-track' }).success).toBe(false);
    });

    it('requires explicit elapsed seconds when completing sessions', () => {
        expect(
            completeSessionInputSchema.safeParse({
                id: crypto.randomUUID(),
                elapsedSeconds: 25 * 60,
            }).success,
        ).toBe(true);

        expect(
            completeSessionInputSchema.safeParse({
                id: crypto.randomUUID(),
            }).success,
        ).toBe(false);
    });

    it('validates session cancellation payloads', () => {
        expect(cancelSessionInputSchema.safeParse({ id: crypto.randomUUID() }).success).toBe(true);
        expect(cancelSessionInputSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
    });
});
