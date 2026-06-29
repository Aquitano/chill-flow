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
};

export const DEFAULT_POMODORO_SETTINGS: PomodoroSettingsValue = {
    focusMinutes: 25,
    breakMinutes: 5,
    longBreakMinutes: 15,
    sessionsBeforeLongBreak: 4,
};

export const userPreferences = pgTable(
    'user_preferences',
    {
        userId: text('userId').primaryKey(),
        defaultMode: text('defaultMode').notNull(),
        autoPlay: boolean('autoPlay').notNull().default(false),
        transitionSpeed: integer('transitionSpeed').notNull().default(300),
        volume: integer('volume').notNull().default(50),
        showNotifications: boolean('showNotifications').notNull().default(true),
        theme: text('theme').notNull().default('dark'),
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
        status: text('status').notNull().default('active'),
        plannedDurationSeconds: integer('plannedDurationSeconds').notNull(),
        elapsedSeconds: integer('elapsedSeconds').notNull().default(0),
        trackId: text('trackId'),
        startedAt: timestamp('startedAt').defaultNow().notNull(),
        completedAt: timestamp('completedAt'),
        canceledAt: timestamp('canceledAt'),
    },
    (table) => [index('FocusSessions_userId_status_completedAt_idx').on(table.userId, table.status, table.completedAt)],
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
