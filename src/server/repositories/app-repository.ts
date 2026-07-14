import { appEnv } from '@/lib/env';
import { backgroundCatalog } from '@/lib/backgrounds';
import { quotes } from '@/lib/quotes';
import {
    AdminTrack,
    AmbientMix,
    AmbientSound,
    Background,
    FocusSession,
    Task,
    Track,
    UserPreferences,
} from '@/models/app';
import { and, asc, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { Database } from '../db/client';
import {
    DEFAULT_POMODORO_SETTINGS,
    ambientMixes,
    ambientSounds,
    focusSessions,
    tasks,
    tracks,
    userPreferences,
} from '../db/schema';

function resolveAudioUrl(storageKey: string): string {
    return `${appEnv.audioBaseUrl}/${storageKey.replace(/^\/+/, '')}`;
}

function mapTrack(row: typeof tracks.$inferSelect): Track {
    return {
        id: row.id,
        title: row.title,
        artist: row.artist,
        audioUrl: resolveAudioUrl(row.storageKey),
        thumbnailUrl: row.thumbnailKey ? resolveAudioUrl(row.thumbnailKey) : undefined,
        duration: row.durationSec,
        tags: row.tags,
        category: row.category,
    };
}

function mapAdminTrack(row: typeof tracks.$inferSelect): AdminTrack {
    return { ...mapTrack(row), storageKey: row.storageKey, thumbnailKey: row.thumbnailKey };
}

function mapAmbientSound(row: typeof ambientSounds.$inferSelect): AmbientSound {
    return {
        id: row.id,
        label: row.label,
        category: row.category,
        audioUrl: resolveAudioUrl(row.storageKey),
        gainPercent: row.gainPercent,
    };
}

function mapAmbientMix(row: typeof ambientMixes.$inferSelect): AmbientMix {
    return { id: row.id, name: row.name, levels: row.levels };
}

type TrackWriteInput = {
    id: string;
    storageKey: string;
    title: string;
    artist: string;
    category: string;
    tags: string[];
    durationSec: number;
    thumbnailKey?: string | null;
};

export const defaultTasks: Task[] = [
    {
        id: crypto.randomUUID(),
        text: 'Review notes',
        isCompleted: false,
        priority: 'medium',
        dueAt: null,
        dueHasTime: false,
    },
    {
        id: crypto.randomUUID(),
        text: 'Practice coding',
        isCompleted: false,
        priority: 'high',
        dueAt: null,
        dueHasTime: false,
    },
    {
        id: crypto.randomUUID(),
        text: 'Write summary',
        isCompleted: false,
        priority: 'low',
        dueAt: null,
        dueHasTime: false,
    },
];

const defaultPreferences: UserPreferences = {
    defaultMode: 'DeepWork',
    autoPlay: false,
    transitionSpeed: 300,
    volume: 50,
    showNotifications: true,
    theme: 'dark',
    timerMode: 'focus',
    timerPreset: '25m',
    customMinutes: '25',
    pomodoroSettings: { ...DEFAULT_POMODORO_SETTINGS },
    customModes: [],
    // Resolved on the client from the track list (first available) when null; the catalog
    // now lives in the DB so there is no static default to point at here.
    selectedTrackId: null,
    selectedBackgroundId: backgroundCatalog[0]?.id ?? null,
    likedTrackIds: [],
};

function clone<T>(value: T): T {
    return structuredClone(value) as T;
}

function asIsoString(value: Date | string | null | undefined) {
    if (!value) {
        return new Date().toISOString();
    }

    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapTask(row: typeof tasks.$inferSelect): Task {
    return {
        id: row.id,
        text: row.text,
        priority: row.priority as Task['priority'],
        isCompleted: row.isCompleted,
        dueAt: row.dueAt,
        dueHasTime: row.dueHasTime,
    };
}

function mapSession(row: typeof focusSessions.$inferSelect): FocusSession {
    return {
        id: row.id,
        mode: row.mode,
        timerKind: row.timerKind as FocusSession['timerKind'],
        status: row.status as FocusSession['status'],
        plannedDurationSeconds: row.plannedDurationSeconds,
        elapsedSeconds: row.elapsedSeconds,
        trackId: row.trackId,
        completedAt: asIsoString(row.completedAt ?? row.startedAt),
        cycleCompletedAt: row.cycleCompletedAt ? asIsoString(row.cycleCompletedAt) : null,
    };
}

function mapPreferences(row: typeof userPreferences.$inferSelect): UserPreferences {
    return {
        defaultMode: row.defaultMode,
        autoPlay: row.autoPlay,
        transitionSpeed: row.transitionSpeed,
        volume: row.volume,
        showNotifications: row.showNotifications,
        theme: row.theme as UserPreferences['theme'],
        timerMode: row.timerMode as UserPreferences['timerMode'],
        timerPreset: row.timerPreset,
        customMinutes: row.customMinutes,
        pomodoroSettings: row.pomodoroSettings,
        customModes: [],
        selectedTrackId: row.selectedTrackId,
        selectedBackgroundId: row.selectedBackgroundId,
        likedTrackIds: row.likedTrackIds,
    };
}

async function ensureUserPreferences(database: Database, userId: string) {
    const [existingPreferences] = await database
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .limit(1);

    if (existingPreferences) {
        return existingPreferences;
    }

    const [createdPreferences] = await database
        .insert(userPreferences)
        .values({
            userId,
            defaultMode: defaultPreferences.defaultMode,
            autoPlay: defaultPreferences.autoPlay,
            transitionSpeed: defaultPreferences.transitionSpeed,
            volume: defaultPreferences.volume,
            showNotifications: defaultPreferences.showNotifications,
            theme: defaultPreferences.theme,
            timerMode: defaultPreferences.timerMode,
            timerPreset: defaultPreferences.timerPreset,
            customMinutes: defaultPreferences.customMinutes,
            pomodoroSettings: defaultPreferences.pomodoroSettings,
            selectedTrackId: defaultPreferences.selectedTrackId,
            selectedBackgroundId: defaultPreferences.selectedBackgroundId,
            likedTrackIds: defaultPreferences.likedTrackIds,
        })
        .onConflictDoNothing()
        .returning();

    if (createdPreferences) {
        return createdPreferences;
    }

    const [storedPreferences] = await database
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .limit(1);

    if (!storedPreferences) {
        throw new Error('User preferences could not be initialized.');
    }

    return storedPreferences;
}

function calculateCurrentStreak(sessionDates: string[]) {
    if (sessionDates.length === 0) {
        return 0;
    }

    const sortedDays = Array.from(new Set(sessionDates)).sort((left, right) => right.localeCompare(left));
    let streak = 1;
    let cursor = new Date(`${sortedDays[0]}T00:00:00.000Z`);

    for (let index = 1; index < sortedDays.length; index += 1) {
        const nextDate = new Date(`${sortedDays[index]}T00:00:00.000Z`);
        cursor.setUTCDate(cursor.getUTCDate() - 1);

        if (nextDate.getTime() !== cursor.getTime()) {
            break;
        }

        streak += 1;
    }

    return streak;
}

export const appRepository = {
    async listTracks(database: Database) {
        const storedTracks = await database.select().from(tracks).orderBy(asc(tracks.createdAt));
        return storedTracks.map(mapTrack);
    },

    async getTrackById(database: Database, trackId: string) {
        const [track] = await database.select().from(tracks).where(eq(tracks.id, trackId)).limit(1);
        return track ? mapTrack(track) : null;
    },

    async adminListTracks(database: Database): Promise<AdminTrack[]> {
        const storedTracks = await database.select().from(tracks).orderBy(desc(tracks.createdAt));
        return storedTracks.map(mapAdminTrack);
    },

    async getAdminTrackById(database: Database, trackId: string): Promise<AdminTrack | null> {
        const [track] = await database.select().from(tracks).where(eq(tracks.id, trackId)).limit(1);
        return track ? mapAdminTrack(track) : null;
    },

    async createTrack(database: Database, input: TrackWriteInput): Promise<AdminTrack> {
        const [created] = await database
            .insert(tracks)
            .values({
                id: input.id,
                title: input.title,
                artist: input.artist,
                category: input.category,
                durationSec: input.durationSec,
                tags: input.tags,
                storageKey: input.storageKey,
                thumbnailKey: input.thumbnailKey ?? null,
            })
            .returning();

        if (!created) {
            throw new Error('Track could not be created.');
        }

        return mapAdminTrack(created);
    },

    async updateTrack(
        database: Database,
        trackId: string,
        input: Partial<Omit<TrackWriteInput, 'id'>>,
    ): Promise<AdminTrack | null> {
        const [updated] = await database
            .update(tracks)
            .set({ ...input, updatedAt: new Date() })
            .where(eq(tracks.id, trackId))
            .returning();

        return updated ? mapAdminTrack(updated) : null;
    },

    async deleteTrack(database: Database, trackId: string) {
        const [deleted] = await database
            .delete(tracks)
            .where(eq(tracks.id, trackId))
            .returning({ id: tracks.id, storageKey: tracks.storageKey, thumbnailKey: tracks.thumbnailKey });

        return deleted ?? null;
    },

    async listAmbientSounds(database: Database): Promise<AmbientSound[]> {
        const rows = await database
            .select()
            .from(ambientSounds)
            .where(eq(ambientSounds.isActive, true))
            .orderBy(asc(ambientSounds.sortIndex), asc(ambientSounds.label));
        return rows.map(mapAmbientSound);
    },

    async listAmbientMixes(database: Database, userId: string): Promise<AmbientMix[]> {
        const rows = await database
            .select()
            .from(ambientMixes)
            .where(eq(ambientMixes.userId, userId))
            .orderBy(asc(ambientMixes.createdAt));
        return rows.map(mapAmbientMix);
    },

    async createAmbientMix(
        database: Database,
        userId: string,
        input: Pick<AmbientMix, 'name' | 'levels'>,
    ): Promise<AmbientMix> {
        const [created] = await database
            .insert(ambientMixes)
            .values({
                id: crypto.randomUUID(),
                userId,
                name: input.name,
                levels: input.levels,
            })
            .returning();

        if (!created) {
            throw new Error('Ambient mix could not be created.');
        }

        return mapAmbientMix(created);
    },

    async updateAmbientMix(
        database: Database,
        userId: string,
        mixId: string,
        input: Pick<AmbientMix, 'name' | 'levels'>,
    ): Promise<AmbientMix | null> {
        const [updated] = await database
            .update(ambientMixes)
            .set({ name: input.name, levels: input.levels })
            .where(and(eq(ambientMixes.userId, userId), eq(ambientMixes.id, mixId)))
            .returning();

        return updated ? mapAmbientMix(updated) : null;
    },

    async deleteAmbientMix(database: Database, userId: string, mixId: string) {
        const deleted = await database
            .delete(ambientMixes)
            .where(and(eq(ambientMixes.userId, userId), eq(ambientMixes.id, mixId)))
            .returning({ id: ambientMixes.id });

        return { success: deleted.length > 0 };
    },

    listBackgrounds() {
        return clone(backgroundCatalog);
    },

    listQuotes() {
        return clone(quotes);
    },

    async listTasks(database: Database, userId: string) {
        const storedTasks = await database
            .select()
            .from(tasks)
            .where(eq(tasks.userId, userId))
            .orderBy(desc(tasks.createdAt));
        return storedTasks.map(mapTask);
    },

    async createTask(
        database: Database,
        userId: string,
        input: Pick<Task, 'text' | 'priority'> & Partial<Pick<Task, 'dueAt' | 'dueHasTime'>>,
    ) {
        const [createdTask] = await database
            .insert(tasks)
            .values({
                id: crypto.randomUUID(),
                userId,
                text: input.text,
                priority: input.priority,
                isCompleted: false,
                dueAt: input.dueAt ?? null,
                dueHasTime: input.dueAt == null ? false : (input.dueHasTime ?? false),
            })
            .returning();

        if (!createdTask) {
            throw new Error('Task could not be created.');
        }

        return mapTask(createdTask);
    },

    async updateTask(
        database: Database,
        userId: string,
        taskId: string,
        input: Partial<Pick<Task, 'text' | 'priority' | 'isCompleted' | 'dueAt' | 'dueHasTime'>>,
    ) {
        const [updatedTask] = await database
            .update(tasks)
            .set({
                ...input,
                ...(input.dueAt === null
                    ? { dueHasTime: false }
                    : input.dueAt === undefined && input.dueHasTime === true
                      ? { dueHasTime: sql<boolean>`case when ${tasks.dueAt} is null then false else true end` }
                      : {}),
                updatedAt: new Date(),
            })
            .where(and(eq(tasks.userId, userId), eq(tasks.id, taskId)))
            .returning();

        return updatedTask ? mapTask(updatedTask) : null;
    },

    async deleteTask(database: Database, userId: string, taskId: string) {
        const deletedTasks = await database
            .delete(tasks)
            .where(and(eq(tasks.userId, userId), eq(tasks.id, taskId)))
            .returning({ id: tasks.id });

        return { success: deletedTasks.length > 0 };
    },

    async getPreferences(database: Database, userId: string) {
        const storedPreferences = await ensureUserPreferences(database, userId);

        return {
            preferences: mapPreferences(storedPreferences),
            backgrounds: clone(backgroundCatalog),
            quotes: clone(quotes),
        };
    },

    async updatePreferences(database: Database, userId: string, input: Partial<UserPreferences>) {
        await ensureUserPreferences(database, userId);

        const [updatedPreferences] = await database
            .update(userPreferences)
            .set({
                ...input,
                updatedAt: new Date(),
            })
            .where(eq(userPreferences.userId, userId))
            .returning();

        if (!updatedPreferences) {
            throw new Error('User preferences could not be updated.');
        }

        return mapPreferences(updatedPreferences);
    },

    async listSessions(database: Database, userId: string) {
        const storedSessions = await database
            .select()
            .from(focusSessions)
            .where(
                and(
                    eq(focusSessions.userId, userId),
                    eq(focusSessions.status, 'completed'),
                    isNotNull(focusSessions.completedAt),
                ),
            )
            .orderBy(desc(focusSessions.completedAt));

        return storedSessions.map(mapSession);
    },

    async startSession(
        database: Database,
        userId: string,
        input: Pick<FocusSession, 'mode' | 'timerKind' | 'plannedDurationSeconds' | 'trackId'>,
    ) {
        const now = new Date();

        // Supersede any prior active row so a single user has one active session. Across
        // tabs this also cancels another tab's active row, but that tab can still record
        // its real focus time later — completeSession matches by id regardless of status.
        await database
            .update(focusSessions)
            .set({
                status: 'canceled',
                canceledAt: now,
            })
            .where(and(eq(focusSessions.userId, userId), eq(focusSessions.status, 'active')));

        const [createdSession] = await database
            .insert(focusSessions)
            .values({
                id: crypto.randomUUID(),
                userId,
                mode: input.mode,
                timerKind: input.timerKind,
                status: 'active',
                plannedDurationSeconds: input.plannedDurationSeconds,
                elapsedSeconds: 0,
                trackId: input.trackId,
                startedAt: now,
                completedAt: null,
                canceledAt: null,
            })
            .returning();

        if (!createdSession) {
            throw new Error('Session could not be created.');
        }

        return mapSession(createdSession);
    },

    async completeSession(database: Database, userId: string, sessionId: string, elapsedSeconds: number) {
        // Match by id even when the row is no longer 'active' — a concurrent startSession
        // in another tab may have flipped it to 'canceled'. That focus time is real and
        // must still be recorded. The `status != 'completed'` guard keeps this idempotent
        // (a re-complete, e.g. from the pagehide flush, matches no row and returns null).
        const [completedSession] = await database
            .update(focusSessions)
            .set({
                status: 'completed',
                completedAt: new Date(),
                canceledAt: null,
                elapsedSeconds,
            })
            .where(
                and(
                    eq(focusSessions.userId, userId),
                    eq(focusSessions.id, sessionId),
                    ne(focusSessions.status, 'completed'),
                ),
            )
            .returning();

        return completedSession ? mapSession(completedSession) : null;
    },

    async completeSessionCycle(database: Database, userId: string, sessionId: string) {
        // Only a *completed* Pomodoro focus block can gain a cycle mark, and only once —
        // a stale or duplicate call (e.g. after the block was superseded) matches no row.
        const [markedSession] = await database
            .update(focusSessions)
            .set({ cycleCompletedAt: new Date() })
            .where(
                and(
                    eq(focusSessions.userId, userId),
                    eq(focusSessions.id, sessionId),
                    eq(focusSessions.timerKind, 'pomodoro'),
                    eq(focusSessions.status, 'completed'),
                    isNull(focusSessions.cycleCompletedAt),
                ),
            )
            .returning();

        return markedSession ? mapSession(markedSession) : null;
    },

    async cancelSession(database: Database, userId: string, sessionId: string) {
        const [canceledSession] = await database
            .update(focusSessions)
            .set({
                status: 'canceled',
                canceledAt: new Date(),
            })
            .where(
                and(
                    eq(focusSessions.userId, userId),
                    eq(focusSessions.id, sessionId),
                    eq(focusSessions.status, 'active'),
                ),
            )
            .returning();

        return canceledSession ? mapSession(canceledSession) : null;
    },

    async getSessionSummary(database: Database, userId: string) {
        const storedSessions = await database
            .select({
                elapsedSeconds: focusSessions.elapsedSeconds,
                completedAt: focusSessions.completedAt,
                cycleCompletedAt: focusSessions.cycleCompletedAt,
            })
            .from(focusSessions)
            .where(
                and(
                    eq(focusSessions.userId, userId),
                    eq(focusSessions.status, 'completed'),
                    isNotNull(focusSessions.completedAt),
                ),
            );

        const totalSessions = storedSessions.length;
        const totalMinutes = Math.round(storedSessions.reduce((sum, session) => sum + session.elapsedSeconds, 0) / 60);
        const completedCycles = storedSessions.filter((session) => session.cycleCompletedAt !== null).length;
        const distinctDays = storedSessions.map((session) => asIsoString(session.completedAt).slice(0, 10));

        return {
            totalSessions,
            totalMinutes,
            completedCycles,
            currentStreak: calculateCurrentStreak(distinctDays),
        };
    },
};

export type AppRepository = typeof appRepository;
export type RepositoryBackground = Background;
