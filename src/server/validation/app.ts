import { backgroundCatalog } from '@/lib/backgrounds';
import { z } from 'zod';

const backgroundIds = new Set(backgroundCatalog.map((background) => background.id));

const modeSchema = z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[\p{L}\p{N}\s_-]+$/u);
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

// superjson revives Date instances on the wire (jstack parses each body value with
// superjson before validation), so a plain z.date() is the right type for due dates.
const dueAtSchema = z.date().nullable();

export const createTaskInputSchema = z
    .object({
        text: z.string().trim().min(1).max(120),
        priority: z.enum(['low', 'medium', 'high']).default('medium'),
        dueAt: dueAtSchema.optional(),
        dueHasTime: z.boolean().optional(),
    })
    // A missing or cleared due date can never carry a time, so drop a stray dueHasTime.
    .transform((input) => (input.dueAt == null ? { ...input, dueHasTime: false } : input));

export const updateTaskInputSchema = z
    .object({
        id: taskIdSchema,
        text: z.string().trim().min(1).max(120).optional(),
        priority: z.enum(['low', 'medium', 'high']).optional(),
        isCompleted: z.boolean().optional(),
        dueAt: dueAtSchema.optional(),
        dueHasTime: z.boolean().optional(),
    })
    .refine(
        (input) =>
            input.text !== undefined ||
            input.priority !== undefined ||
            input.isCompleted !== undefined ||
            input.dueAt !== undefined ||
            input.dueHasTime !== undefined,
        { message: 'Provide at least one task field to update.' },
    )
    // Clearing the due date (dueAt: null) also resets dueHasTime so a task can't keep a
    // time with no date behind it.
    .transform((input) => (input.dueAt === null ? { ...input, dueHasTime: false } : input));

export const deleteTaskInputSchema = z.object({
    id: taskIdSchema,
});

const pomodoroSettingsSchema = z.object({
    focusMinutes: z.number().int().min(1).max(240),
    breakMinutes: z.number().int().min(1).max(120),
    longBreakMinutes: z.number().int().min(1).max(240),
    sessionsBeforeLongBreak: z.number().int().min(1).max(12),
    // Optional rather than defaulted: a client on the previous shape keeps working, and an
    // omitted field leaves the stored value alone instead of asserting the default over a
    // deliberate false. updatePreferences merges these over the stored settings.
    autoStartBreaks: z.boolean().optional(),
    autoStartFocus: z.boolean().optional(),
});

export const updatePreferencesInputSchema = z.object({
    defaultMode: modeSchema.optional(),
    autoPlay: z.boolean().optional(),
    transitionSpeed: z.number().int().min(100).max(2000).optional(),
    volume: z.number().int().min(0).max(100).optional(),
    showNotifications: z.boolean().optional(),
    timerSound: z.boolean().optional(),
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

const sessionIdSchema = z.uuid();
const elapsedSecondsSchema = z
    .number()
    .int()
    .min(0)
    .max(12 * 60 * 60);

export const startSessionInputSchema = z.object({
    mode: modeSchema,
    timerKind: z.enum(['focus', 'pomodoro']).default('focus'),
    plannedDurationSeconds: z
        .number()
        .int()
        .min(60)
        .max(12 * 60 * 60),
    trackId: nullableTrackIdSchema,
    taskId: taskIdSchema.nullish(),
});

export const completeSessionInputSchema = z.object({
    id: sessionIdSchema,
    elapsedSeconds: elapsedSecondsSchema,
});

export const cancelSessionInputSchema = z.object({
    id: sessionIdSchema,
});

export const completeCycleInputSchema = z.object({
    id: sessionIdSchema,
});

/**
 * Body of the unload beacon. It carries the lifecycle reducer's verdict rather than raw
 * timings, so what counts as recordable focus time stays decided in one place.
 */
export const flushSessionInputSchema = z.discriminatedUnion('outcome', [
    z.object({
        outcome: z.literal('completed'),
        id: sessionIdSchema,
        elapsedSeconds: elapsedSecondsSchema,
    }),
    z.object({ outcome: z.literal('canceled'), id: sessionIdSchema }),
]);

/** Focus time this device can prove from its local timer snapshot after a hard reload. */
export const recoverSessionInputSchema = z.object({
    elapsedSeconds: elapsedSecondsSchema,
});

export const trackLookupInputSchema = z.object({
    id: trackIdSchema,
});

const ambientSoundIdSchema = z.string().min(1).max(64);
const ambientLevelsSchema = z
    .record(ambientSoundIdSchema, z.number().int().min(0).max(100))
    .refine((levels) => Object.keys(levels).length <= 24, { message: 'A mix may hold at most 24 layers.' });

export const saveAmbientMixInputSchema = z.object({
    name: z.string().trim().min(1).max(40),
    levels: ambientLevelsSchema,
});

export const updateAmbientMixInputSchema = saveAmbientMixInputSchema.extend({
    id: z.uuid(),
});

export const deleteAmbientMixInputSchema = z.object({
    id: z.uuid(),
});

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
        thumbnailKey: trackStorageKeySchema.optional(),
        durationSec: trackDurationSchema.optional(),
    })
    .refine(
        (input) =>
            input.title !== undefined ||
            input.artist !== undefined ||
            input.category !== undefined ||
            input.tags !== undefined ||
            input.storageKey !== undefined ||
            input.thumbnailKey !== undefined ||
            input.durationSec !== undefined,
        { message: 'Provide at least one track field to update.' },
    );

export const deleteTrackAdminInputSchema = z.object({
    id: trackAdminIdSchema,
});

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

const trackAssetExtSchema = z
    .string()
    .trim()
    .regex(/^\.[a-z0-9]+$/, 'Extension must look like ".mp3".');

const uploadByteSizeSchema = z.number().int().positive();

export const presignTrackInputSchema = z
    .object({
        id: trackAdminIdSchema,
        audioExt: trackAssetExtSchema.optional(),
        coverExt: trackAssetExtSchema.optional(),
        audioBytes: uploadByteSizeSchema.optional(),
        coverBytes: uploadByteSizeSchema.optional(),
    })
    .refine((input) => input.audioExt !== undefined || input.coverExt !== undefined, {
        message: 'Provide audioExt and/or coverExt.',
    })
    // Require the declared size alongside each ext so the server size cap can't be skipped
    // by simply omitting the byte count.
    .refine((input) => input.audioExt === undefined || input.audioBytes !== undefined, {
        message: 'audioBytes is required when audioExt is provided.',
    })
    .refine((input) => input.coverExt === undefined || input.coverBytes !== undefined, {
        message: 'coverBytes is required when coverExt is provided.',
    });
