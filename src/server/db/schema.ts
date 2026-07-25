import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const posts = pgTable(
    'posts',
    {
        id: serial('id').primaryKey(),
        name: text('name').notNull(),
        createdAt: timestamp('createdAt').defaultNow().notNull(),
        updatedAt: timestamp('updatedAt').defaultNow().notNull(),
    },
    (table) => [index('Post_name_idx').on(table.name)],
);

export const tracks = pgTable(
    'tracks',
    {
        id: text('id').primaryKey(),
        title: text('title').notNull(),
        artist: text('artist').notNull(),
        category: text('category').notNull(),
        durationSec: integer('durationSec').notNull(),
        tags: jsonb('tags').$type<string[]>().notNull().default([]),
        // Relative storage key (e.g. 'deep-focus-01.mp3'). Resolved to a full URL at read
        // time against AUDIO_BASE_URL, so the same row serves dev (public/) and prod (R2).
        storageKey: text('storageKey').notNull(),
        // Optional cover-art key, resolved against the same base as the audio key.
        thumbnailKey: text('thumbnailKey'),
        createdAt: timestamp('createdAt').defaultNow().notNull(),
        updatedAt: timestamp('updatedAt').defaultNow().notNull(),
    },
    (table) => [index('Tracks_category_idx').on(table.category)],
);

export const tasks = pgTable(
    'tasks',
    {
        id: text('id').primaryKey(),
        userId: text('userId').notNull(),
        text: text('text').notNull(),
        priority: text('priority').notNull(),
        isCompleted: boolean('isCompleted').notNull().default(false),
        dueAt: timestamp('dueAt'),
        // Distinguishes a date-only due ("tomorrow") from one with a time ("tomorrow 5pm")
        // so the UI knows whether to render a clock alongside the date.
        dueHasTime: boolean('dueHasTime').notNull().default(false),
        createdAt: timestamp('createdAt').defaultNow().notNull(),
        updatedAt: timestamp('updatedAt').defaultNow().notNull(),
    },
    (table) => [index('Tasks_userId_createdAt_idx').on(table.userId, table.createdAt)],
);

export type PomodoroSettingsValue = {
    focusMinutes: number;
    breakMinutes: number;
    longBreakMinutes: number;
    sessionsBeforeLongBreak: number;
    /** Roll straight into the break when a focus block ends, instead of waiting for play. */
    autoStartBreaks: boolean;
    /** Roll straight into the next focus block when a break ends. */
    autoStartFocus: boolean;
};

export const DEFAULT_POMODORO_SETTINGS: PomodoroSettingsValue = {
    focusMinutes: 25,
    breakMinutes: 5,
    longBreakMinutes: 15,
    sessionsBeforeLongBreak: 4,
    autoStartBreaks: true,
    autoStartFocus: true,
};

export const userPreferences = pgTable(
    'user_preferences',
    {
        userId: text('userId').primaryKey(),
        defaultMode: text('defaultMode').notNull(),
        volume: integer('volume').notNull().default(50),
        showNotifications: boolean('showNotifications').notNull().default(true),
        // A chime at every timer boundary. Independent of showNotifications: browser
        // notifications need a permission the user may never grant, and show nothing in a
        // background tab, so the sound is the cue that always arrives.
        timerSound: boolean('timerSound').notNull().default(true),
        timerMode: text('timerMode').notNull().default('focus'),
        timerPreset: text('timerPreset').notNull().default('25m'),
        customMinutes: text('customMinutes').notNull().default('25'),
        pomodoroSettings: jsonb('pomodoroSettings')
            .$type<PomodoroSettingsValue>()
            .notNull()
            .default(DEFAULT_POMODORO_SETTINGS),
        selectedTrackId: text('selectedTrackId'),
        selectedBackgroundId: text('selectedBackgroundId'),
        likedTrackIds: jsonb('likedTrackIds').$type<string[]>().notNull().default([]),
        createdAt: timestamp('createdAt').defaultNow().notNull(),
        updatedAt: timestamp('updatedAt').defaultNow().notNull(),
    },
    (table) => [index('UserPreferences_defaultMode_idx').on(table.defaultMode)],
);

export const focusSessions = pgTable(
    'focus_sessions',
    {
        id: text('id').primaryKey(),
        userId: text('userId').notNull(),
        mode: text('mode').notNull(),
        // Which timer produced this focus block: a plain focus countdown or a Pomodoro
        // focus phase. Breaks are never recorded, so focused minutes stay honest either way.
        timerKind: text('timerKind').notNull().default('focus'),
        status: text('status').notNull().default('active'),
        plannedDurationSeconds: integer('plannedDurationSeconds').notNull(),
        elapsedSeconds: integer('elapsedSeconds').notNull().default(0),
        trackId: text('trackId'),
        // What the block was for, when the user picked a task to focus on. Not a foreign
        // key: deleting a task must not erase the focus time that was spent on it.
        taskId: text('taskId'),
        startedAt: timestamp('startedAt').defaultNow().notNull(),
        completedAt: timestamp('completedAt'),
        canceledAt: timestamp('canceledAt'),
        // Set on a completed Pomodoro focus block once its following break also finishes;
        // a full focus-plus-break cycle is what counts as one "completed Pomodoro".
        cycleCompletedAt: timestamp('cycleCompletedAt'),
    },
    (table) => [index('FocusSessions_userId_status_completedAt_idx').on(table.userId, table.status, table.completedAt)],
);

export const ambientSounds = pgTable(
    'ambient_sounds',
    {
        id: text('id').primaryKey(),
        label: text('label').notNull(),
        category: text('category').notNull(),
        // Relative storage key resolved against AUDIO_BASE_URL at read time, same as tracks.
        storageKey: text('storageKey').notNull(),
        // Loudness trim in percent (100 = unity) applied under the user's slider so
        // recordings from different sources sit at a comparable level in the mix.
        gainPercent: integer('gainPercent').notNull().default(100),
        sortIndex: integer('sortIndex').notNull().default(0),
        isActive: boolean('isActive').notNull().default(true),
        createdAt: timestamp('createdAt').defaultNow().notNull(),
        updatedAt: timestamp('updatedAt').defaultNow().notNull(),
    },
    (table) => [index('AmbientSounds_isActive_sortIndex_idx').on(table.isActive, table.sortIndex)],
);

export const ambientMixes = pgTable(
    'ambient_mixes',
    {
        id: text('id').primaryKey(),
        userId: text('userId').notNull(),
        name: text('name').notNull(),
        // Sound id -> level 0..100; ids absent from the map are off. Ids that no longer
        // exist in ambient_sounds are ignored when the mix is applied on the client.
        levels: jsonb('levels').$type<Record<string, number>>().notNull().default({}),
        createdAt: timestamp('createdAt').defaultNow().notNull(),
    },
    (table) => [index('AmbientMixes_userId_idx').on(table.userId)],
);

export const savedPresets = pgTable(
    'saved_presets',
    {
        id: text('id').primaryKey(),
        userId: text('userId').notNull(),
        name: text('name').notNull(),
        trackId: text('trackId'),
        backgroundId: text('backgroundId'),
        mode: text('mode').notNull(),
        createdAt: timestamp('createdAt').defaultNow().notNull(),
    },
    (table) => [index('SavedPresets_userId_idx').on(table.userId)],
);
