import { describe, expect, it } from 'vitest';
import {
    cancelSessionInputSchema,
    completeCycleInputSchema,
    completeSessionInputSchema,
    createTaskInputSchema,
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

    it('accepts a due date and time flag on task creation', () => {
        const dueAt = new Date(2026, 6, 10, 17, 0);
        const result = createTaskInputSchema.parse({
            text: 'submit report',
            dueAt,
            dueHasTime: true,
        });

        expect(result.dueAt).toEqual(dueAt);
        expect(result.dueHasTime).toBe(true);
        expect(result.priority).toBe('medium');
    });

    it('drops a stray time flag on creation when no due date is given', () => {
        const result = createTaskInputSchema.parse({ text: 'submit report', dueHasTime: true });
        expect(result.dueAt).toBeUndefined();
        expect(result.dueHasTime).toBe(false);
    });

    it('accepts a due date update and rejects a non-date dueAt', () => {
        const dueAt = new Date(2026, 0, 5);
        expect(updateTaskInputSchema.parse({ id: crypto.randomUUID(), dueAt })).toMatchObject({ dueAt });
        expect(updateTaskInputSchema.safeParse({ id: crypto.randomUUID(), dueAt: '2026-01-05' }).success).toBe(false);
    });

    it('clears the time flag when a task update nulls the due date', () => {
        const result = updateTaskInputSchema.parse({
            id: crypto.randomUUID(),
            dueAt: null,
            dueHasTime: true,
        });

        expect(result).toMatchObject({ dueAt: null, dueHasTime: false });
    });

    it('accepts clearing the due date as the only updated field', () => {
        expect(updateTaskInputSchema.safeParse({ id: crypto.randomUUID(), dueAt: null }).success).toBe(true);
    });

    it('rejects out-of-range preference updates', () => {
        const result = updatePreferencesInputSchema.safeParse({
            volume: 101,
        });

        expect(result.success).toBe(false);
    });

    it('accepts persisted timer and Pomodoro preferences', () => {
        const result = updatePreferencesInputSchema.safeParse({
            timerMode: 'pomodoro',
            timerPreset: '45m',
            customMinutes: '90',
            pomodoroSettings: {
                focusMinutes: 50,
                breakMinutes: 10,
                longBreakMinutes: 20,
                sessionsBeforeLongBreak: 3,
            },
        });

        expect(result.success).toBe(true);
    });

    it('leaves the auto-start flags absent when a client omits them', () => {
        // A tab still running a bundle from before these fields existed posts the old
        // four-field shape on its next save. Filling in a default here would write `true`
        // over a deliberate `false`, since the settings column is replaced whole.
        const result = updatePreferencesInputSchema.parse({
            pomodoroSettings: {
                focusMinutes: 25,
                breakMinutes: 5,
                longBreakMinutes: 15,
                sessionsBeforeLongBreak: 4,
            },
        });

        expect(result.pomodoroSettings).not.toHaveProperty('autoStartBreaks');
        expect(result.pomodoroSettings).not.toHaveProperty('autoStartFocus');
    });

    it('carries the auto-start flags through when a client sends them', () => {
        const result = updatePreferencesInputSchema.parse({
            pomodoroSettings: {
                focusMinutes: 25,
                breakMinutes: 5,
                longBreakMinutes: 15,
                sessionsBeforeLongBreak: 4,
                autoStartBreaks: false,
                autoStartFocus: true,
            },
        });

        expect(result.pomodoroSettings?.autoStartBreaks).toBe(false);
        expect(result.pomodoroSettings?.autoStartFocus).toBe(true);
    });

    it('rejects out-of-range Pomodoro settings and non-numeric custom minutes', () => {
        expect(
            updatePreferencesInputSchema.safeParse({
                pomodoroSettings: {
                    focusMinutes: 0,
                    breakMinutes: 5,
                    longBreakMinutes: 15,
                    sessionsBeforeLongBreak: 4,
                },
            }).success,
        ).toBe(false);

        expect(updatePreferencesInputSchema.safeParse({ customMinutes: 'abc' }).success).toBe(false);
        expect(updatePreferencesInputSchema.safeParse({ timerMode: 'sleep' }).success).toBe(false);
    });

    it('deduplicates liked track ids while preserving valid payloads', () => {
        const result = updatePreferencesInputSchema.parse({
            likedTrackIds: ['deep-focus-01', 'deep-focus-01', 'ambient-rain-02'],
        });

        expect(result.likedTrackIds).toEqual(['deep-focus-01', 'ambient-rain-02']);
    });

    it('rejects short focus sessions and malformed track lookups', () => {
        expect(
            startSessionInputSchema.safeParse({
                mode: 'DeepWork',
                plannedDurationSeconds: 30,
                trackId: 'deep-focus-01',
            }).success,
        ).toBe(false);

        // Track ids are shape-validated only (catalog membership lives in the DB now): a
        // well-formed id is accepted, an empty one is rejected.
        expect(trackLookupInputSchema.safeParse({ id: 'any-track-id' }).success).toBe(true);
        expect(trackLookupInputSchema.safeParse({ id: '' }).success).toBe(false);
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

    it('defaults the timer kind on session start and rejects unknown kinds', () => {
        const base = { mode: 'DeepWork', plannedDurationSeconds: 25 * 60, trackId: null };

        expect(startSessionInputSchema.parse(base).timerKind).toBe('focus');
        expect(startSessionInputSchema.parse({ ...base, timerKind: 'pomodoro' }).timerKind).toBe('pomodoro');
        expect(startSessionInputSchema.safeParse({ ...base, timerKind: 'break' }).success).toBe(false);
    });

    it('validates cycle completion payloads', () => {
        expect(completeCycleInputSchema.safeParse({ id: crypto.randomUUID() }).success).toBe(true);
        expect(completeCycleInputSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
    });
});
