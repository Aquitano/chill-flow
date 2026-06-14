import { backgroundCatalog } from '@/lib/backgrounds';
import { z } from 'zod';
import { trackCatalog } from '../repositories/app-repository';

const backgroundIds = new Set(backgroundCatalog.map((background) => background.id));
const trackIds = new Set(trackCatalog.map((track) => track.id));

const modeSchema = z.string().trim().min(1).max(40).regex(/^[\p{L}\p{N}\s_-]+$/u);
const trackIdSchema = z.string().min(1).max(64).refine((trackId) => trackIds.has(trackId), {
    message: 'Unknown track id.',
});
const nullableTrackIdSchema = trackIdSchema.nullable();
const nullableBackgroundIdSchema = z
    .string()
    .min(1)
    .max(64)
    .refine((backgroundId) => backgroundIds.has(backgroundId), {
        message: 'Unknown background id.',
    })
    .nullable();

export const taskIdSchema = z.uuid();

export const createTaskInputSchema = z.object({
    text: z.string().trim().min(1).max(120),
    priority: z.enum(['low', 'medium', 'high']).default('medium'),
});

export const updateTaskInputSchema = z
    .object({
        id: taskIdSchema,
        text: z.string().trim().min(1).max(120).optional(),
        priority: z.enum(['low', 'medium', 'high']).optional(),
        isCompleted: z.boolean().optional(),
    })
    .refine((input) => input.text !== undefined || input.priority !== undefined || input.isCompleted !== undefined, {
        message: 'Provide at least one task field to update.',
    });

export const deleteTaskInputSchema = z.object({
    id: taskIdSchema,
});

const pomodoroSettingsSchema = z.object({
    focusMinutes: z.number().int().min(1).max(240),
    breakMinutes: z.number().int().min(1).max(120),
    longBreakMinutes: z.number().int().min(1).max(240),
    sessionsBeforeLongBreak: z.number().int().min(1).max(12),
});

export const updatePreferencesInputSchema = z.object({
    defaultMode: modeSchema.optional(),
    autoPlay: z.boolean().optional(),
    transitionSpeed: z.number().int().min(100).max(2000).optional(),
    volume: z.number().int().min(0).max(100).optional(),
    showNotifications: z.boolean().optional(),
    theme: z.enum(['light', 'dark', 'system']).optional(),
    timerMode: z.enum(['focus', 'pomodoro']).optional(),
    timerPreset: z.string().trim().min(1).max(16).optional(),
    customMinutes: z
        .string()
        .trim()
        .regex(/^\d{1,4}$/, { message: 'customMinutes must be a whole number of minutes.' })
        .optional(),
    pomodoroSettings: pomodoroSettingsSchema.optional(),
    selectedTrackId: nullableTrackIdSchema.optional(),
    selectedBackgroundId: nullableBackgroundIdSchema.optional(),
    likedTrackIds: z
        .array(trackIdSchema)
        .max(25)
        .transform((trackIds) => Array.from(new Set(trackIds)))
        .optional(),
});

export const startSessionInputSchema = z.object({
    mode: modeSchema,
    plannedDurationSeconds: z.number().int().min(60).max(12 * 60 * 60),
    trackId: nullableTrackIdSchema,
});

export const completeSessionInputSchema = z.object({
    id: taskIdSchema,
    elapsedSeconds: z.number().int().min(0).max(12 * 60 * 60),
});

export const cancelSessionInputSchema = z.object({
    id: taskIdSchema,
});

export const trackLookupInputSchema = z.object({
    id: trackIdSchema,
});
