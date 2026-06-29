import { backgroundCatalog } from '@/lib/backgrounds';
import { z } from 'zod';

const backgroundIds = new Set(backgroundCatalog.map((background) => background.id));

const modeSchema = z.string().trim().min(1).max(40).regex(/^[\p{L}\p{N}\s_-]+$/u);
// Shape-only: the track catalog now lives in the DB, so membership is not validated here.
// An unknown id simply yields no playable track (handled gracefully in the player).
const trackIdSchema = z.string().min(1).max(64);
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

// --- Admin track management ---

const trackAdminIdSchema = z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/, 'Track id may only contain letters, numbers, dot, underscore, or hyphen.');
const trackStorageKeySchema = z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._-]+$/, 'Storage key must be a safe file name (no slashes).');
const trackTitleSchema = z.string().trim().min(1).max(120);
const trackArtistSchema = z.string().trim().min(1).max(120);
const trackCategorySchema = z.string().trim().min(1).max(40);
const trackTagsSchema = z.array(z.string().trim().min(1).max(40)).max(20);
const trackDurationSchema = z
    .number()
    .int()
    .min(0)
    .max(24 * 60 * 60);

/** Metadata fields for an upload (the file + storage key are handled by the route). */
export const uploadTrackMetadataSchema = z.object({
    id: trackAdminIdSchema,
    title: trackTitleSchema,
    artist: trackArtistSchema,
    category: trackCategorySchema,
    tags: trackTagsSchema.default([]),
});

export const updateTrackInputSchema = z
    .object({
        id: trackAdminIdSchema,
        title: trackTitleSchema.optional(),
        artist: trackArtistSchema.optional(),
        category: trackCategorySchema.optional(),
        tags: trackTagsSchema.optional(),
        storageKey: trackStorageKeySchema.optional(),
        durationSec: trackDurationSchema.optional(),
    })
    .refine(
        (input) =>
            input.title !== undefined ||
            input.artist !== undefined ||
            input.category !== undefined ||
            input.tags !== undefined ||
            input.storageKey !== undefined ||
            input.durationSec !== undefined,
        { message: 'Provide at least one track field to update.' },
    );

export const deleteTrackAdminInputSchema = z.object({
    id: trackAdminIdSchema,
});

/** Create a track row whose file(s) were already uploaded directly to R2 (presigned flow). */
export const createTrackInputSchema = z.object({
    id: trackAdminIdSchema,
    storageKey: trackStorageKeySchema,
    title: trackTitleSchema,
    artist: trackArtistSchema,
    category: trackCategorySchema,
    tags: trackTagsSchema.default([]),
    durationSec: trackDurationSchema,
    thumbnailKey: trackStorageKeySchema.nullish(),
});

const trackAssetExtSchema = z.string().trim().regex(/^\.[a-z0-9]+$/, 'Extension must look like ".mp3".');

export const presignTrackInputSchema = z
    .object({
        id: trackAdminIdSchema,
        audioExt: trackAssetExtSchema.optional(),
        coverExt: trackAssetExtSchema.optional(),
    })
    .refine((input) => input.audioExt !== undefined || input.coverExt !== undefined, {
        message: 'Provide audioExt and/or coverExt.',
    });
