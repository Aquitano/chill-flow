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
        variants: jsonb('variants').$type<
            Array<{
                codec: 'webm' | 'm4a';
                bitrateKbps: number;
                url: string;
                bytes: number;
                hash: string;
            }>
        >().notNull(),
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
    (table) => [index('Tasks_userId_idx').on(table.userId)],
);

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
        durationSeconds: integer('durationSeconds').notNull(),
        trackId: text('trackId'),
        completedAt: timestamp('completedAt').defaultNow().notNull(),
    },
    (table) => [index('FocusSessions_userId_idx').on(table.userId)],
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
