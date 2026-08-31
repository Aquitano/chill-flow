import { appEnv } from '@/lib/env';
import { backgroundCatalog } from '@/lib/backgrounds';
import { MIN_RECORDED_SECONDS } from '@/lib/focus-session';
import { quotes } from '@/lib/quotes';
import {
    AdminTrack,
    AmbientMix,
    AmbientSound,
    Background,
    DailyFocus,
    FocusSession,
    PomodoroSettings,
    SavedPreset,
    Task,
    TaskFocusTotal,
    Track,
    UserPreferences,
} from '@/models/app';
import { and, asc, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { EXPORT_SCHEMA_VERSION, type UserDataExport } from '../account-export';
import { Database } from '../db/client';
import { calculateCurrentStreak, dayKeyInZone } from '../streak';
import {
    DEFAULT_POMODORO_SETTINGS,
    ambientMixes,
    ambientSounds,
    focusSessions,
    savedPresets,
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

function mapSavedPreset(row: typeof savedPresets.$inferSelect): SavedPreset {
    return {
        id: row.id,
        name: row.name,
        trackId: row.trackId,
        backgroundId: row.backgroundId,
        mode: row.mode,
    };
}

type SavedPresetInput = Omit<SavedPreset, 'id'>;

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
    volume: 50,
    showNotifications: true,
    timerSound: true,
    timerMode: 'focus',
    timerPreset: '25m',
    customMinutes: '25',
    pomodoroSettings: { ...DEFAULT_POMODORO_SETTINGS },
    // Resolved on the client from the track list (first available) when null; the catalog
    // now lives in the DB so there is no static default to point at here.
    selectedTrackId: null,
    selectedBackgroundId: backgroundCatalog[0]?.id ?? null,
    likedTrackIds: [],
};

function clone<T>(value: T): T {
    return structuredClone(value) as T;
}

/** Unlike asIsoString, keeps a missing timestamp missing — the export must not invent one. */
function toIsoOrNull(value: Date | null) {
    return value ? value.toISOString() : null;
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
        taskId: row.taskId,
        completedAt: asIsoString(row.completedAt ?? row.startedAt),
        cycleCompletedAt: row.cycleCompletedAt ? asIsoString(row.cycleCompletedAt) : null,
    };
}

function mapPreferences(row: typeof userPreferences.$inferSelect): UserPreferences {
    return {
        defaultMode: row.defaultMode,
        volume: row.volume,
        showNotifications: row.showNotifications,
        timerSound: row.timerSound,
        timerMode: row.timerMode as UserPreferences['timerMode'],
        timerPreset: row.timerPreset,
        customMinutes: row.customMinutes,
        // Merged over the defaults: rows written before a cadence field existed hold the
        // older JSON shape, and a missing key must read as the default rather than undefined.
        pomodoroSettings: { ...DEFAULT_POMODORO_SETTINGS, ...row.pomodoroSettings },
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
            volume: defaultPreferences.volume,
            showNotifications: defaultPreferences.showNotifications,
            timerSound: defaultPreferences.timerSound,
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

/**
 * The calendar day a session lands on *for the user*. `completedAt` is a `timestamp`
 * without a zone holding UTC, so it has to be pinned to UTC before it can be converted —
 * a bare `AT TIME ZONE` would read it as local server time instead.
 *
 * Aliased so GROUP BY / ORDER BY reference the alias instead of repeating the expression:
 * each repetition binds `timeZone` as a fresh placeholder, and Postgres then rejects the
 * query because the select expression (`$1`) never matches the grouped one (`$4`).
 */
function completedDayInZone(timeZone: string) {
    return sql<string>`to_char((${focusSessions.completedAt} AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM-DD')`.as(
        'day',
    );
}

/** Bound on the day list behind the streak; longer than any streak worth reporting. */
const STREAK_WINDOW_DAYS = 366;

/** How far back the progress panel's history list reaches. */
const SESSION_HISTORY_LIMIT = 50;

/**
 * Days of per-day focus totals behind the trend strip: two weeks on screen, plus enough
 * behind them that "last week" is always a complete week.
 */
const DAILY_FOCUS_WINDOW_DAYS = 28;

function completedSessionsOf(userId: string) {
    return and(
        eq(focusSessions.userId, userId),
        eq(focusSessions.status, 'completed'),
        isNotNull(focusSessions.completedAt),
    );
}

function taskDueTimePatch(
    input: Partial<Pick<Task, 'text' | 'priority' | 'isCompleted' | 'dueAt' | 'dueHasTime'>>,
) {
    if (input.dueAt === null) {
        return { dueHasTime: false };
    }

    if (input.dueAt === undefined && input.dueHasTime === true) {
        return { dueHasTime: sql<boolean>`case when ${tasks.dueAt} is null then false else true end` };
    }

    return {};
}

/**
 * Record a finished block. Matches by id even when the row is no longer 'active' — a
 * concurrent startSession in another tab may have flipped it to 'canceled'. That focus time
 * is real and must still be recorded, but only the part that ran *before* the handover:
 * without the clamp, two tabs running in parallel each bank the whole overlap. Every SET
 * expression reads the pre-update row, so canceledAt is still readable here.
 *
 * The `status != 'completed'` guard keeps this idempotent — a re-complete, such as the
 * unload beacon racing the in-app write, matches no row and returns null.
 *
 * Module-level rather than a method so session recovery can reuse it without the repository
 * referring to itself.
 */
async function completeSession(database: Database, userId: string, sessionId: string, elapsedSeconds: number) {
    const [completedSession] = await database
        .update(focusSessions)
        .set({
            status: 'completed',
            completedAt: new Date(),
            canceledAt: null,
            elapsedSeconds: sql<number>`case
                when ${focusSessions.status} = 'canceled' and ${focusSessions.canceledAt} is not null
                    then least(
                        ${elapsedSeconds}::int,
                        greatest(0, floor(extract(epoch from (${focusSessions.canceledAt} - ${focusSessions.startedAt})))::int)
                    )
                else ${elapsedSeconds}::int
            end`,
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
}

async function cancelSession(database: Database, userId: string, sessionId: string) {
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

    async listSavedPresets(database: Database, userId: string): Promise<SavedPreset[]> {
        const rows = await database
            .select()
            .from(savedPresets)
            .where(eq(savedPresets.userId, userId))
            .orderBy(asc(savedPresets.createdAt));
        return rows.map(mapSavedPreset);
    },

    async createSavedPreset(database: Database, userId: string, input: SavedPresetInput): Promise<SavedPreset> {
        const [created] = await database
            .insert(savedPresets)
            .values({ id: crypto.randomUUID(), userId, ...input })
            .returning();

        if (!created) {
            throw new Error('Workspace preset could not be created.');
        }

        return mapSavedPreset(created);
    },

    async updateSavedPreset(
        database: Database,
        userId: string,
        presetId: string,
        input: SavedPresetInput,
    ): Promise<SavedPreset | null> {
        const [updated] = await database
            .update(savedPresets)
            .set(input)
            .where(and(eq(savedPresets.userId, userId), eq(savedPresets.id, presetId)))
            .returning();

        return updated ? mapSavedPreset(updated) : null;
    },

    async deleteSavedPreset(database: Database, userId: string, presetId: string) {
        const deleted = await database
            .delete(savedPresets)
            .where(and(eq(savedPresets.userId, userId), eq(savedPresets.id, presetId)))
            .returning({ id: savedPresets.id });

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
                ...taskDueTimePatch(input),
                updatedAt: new Date(),
            })
            .where(and(eq(tasks.userId, userId), eq(tasks.id, taskId)))
            .returning();

        return updatedTask ? mapTask(updatedTask) : null;
    },

    async clearCompletedTasks(database: Database, userId: string) {
        const deletedTasks = await database
            .delete(tasks)
            .where(and(eq(tasks.userId, userId), eq(tasks.isCompleted, true)))
            .returning({ id: tasks.id });

        return { count: deletedTasks.length };
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

    async updatePreferences(
        database: Database,
        userId: string,
        input: Omit<Partial<UserPreferences>, 'pomodoroSettings'> & { pomodoroSettings?: Partial<PomodoroSettings> },
    ) {
        const storedPreferences = await ensureUserPreferences(database, userId);
        const { pomodoroSettings: cadencePatch, ...rest } = input;

        const [updatedPreferences] = await database
            .update(userPreferences)
            .set({
                ...rest,
                // pomodoroSettings is a single JSON column, so a write replaces it whole.
                // Layering the patch over the stored row keeps a client that posts only the
                // shape it knows from resetting fields added since — an older tab's next
                // preference save would otherwise undo a deliberate setting.
                ...(cadencePatch
                    ? {
                          pomodoroSettings: {
                              ...DEFAULT_POMODORO_SETTINGS,
                              ...storedPreferences.pomodoroSettings,
                              ...cadencePatch,
                          },
                      }
                    : {}),
                updatedAt: new Date(),
            })
            .where(eq(userPreferences.userId, userId))
            .returning();

        if (!updatedPreferences) {
            throw new Error('User preferences could not be updated.');
        }

        return mapPreferences(updatedPreferences);
    },

    async startSession(
        database: Database,
        userId: string,
        input: Pick<FocusSession, 'mode' | 'timerKind' | 'plannedDurationSeconds' | 'trackId'> &
            Partial<Pick<FocusSession, 'taskId'>>,
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
                taskId: input.taskId ?? null,
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

    completeSession,

    /**
     * Settle the session a device left open after a hard reload — a crash, a kill, a dead
     * battery — where the unload beacon never got to run.
     *
     * The client names the row from its own timer snapshot rather than asking for "the
     * active one", so opening a second tab can never close a session still running in the
     * first. A block too short to record is canceled instead.
     *
     * Its claim is never taken at face value: the block can't have outlasted its planned
     * duration, nor the wall time between starting and the device's last snapshot. That
     * second bound is what keeps a stale claim honest — a preset retuned between the crash
     * and the reload would otherwise let the client derive elapsed time from the wrong phase
     * length, and reopening days later leaves `now` far too generous a ceiling.
     */
    async recoverSession(
        database: Database,
        userId: string,
        sessionId: string,
        provenElapsedSeconds: number,
        snapshotSavedAtMs: number,
    ) {
        const [openSession] = await database
            .select()
            .from(focusSessions)
            .where(
                and(
                    eq(focusSessions.userId, userId),
                    eq(focusSessions.id, sessionId),
                    eq(focusSessions.status, 'active'),
                ),
            )
            .limit(1);

        if (!openSession) {
            return { outcome: 'none' as const, elapsedSeconds: 0 };
        }

        // A clock ahead of ours would otherwise widen its own ceiling.
        const lastAliveMs = Math.min(snapshotSavedAtMs, Date.now());
        const aliveSeconds = Math.floor((lastAliveMs - openSession.startedAt.getTime()) / 1000);
        const elapsedSeconds = Math.max(
            0,
            Math.min(provenElapsedSeconds, openSession.plannedDurationSeconds, aliveSeconds),
        );

        if (elapsedSeconds < MIN_RECORDED_SECONDS) {
            await cancelSession(database, userId, sessionId);
            return { outcome: 'canceled' as const, elapsedSeconds: 0 };
        }

        const recovered = await completeSession(database, userId, sessionId, elapsedSeconds);
        return { outcome: 'completed' as const, elapsedSeconds: recovered?.elapsedSeconds ?? elapsedSeconds };
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

    cancelSession,

    /**
     * Erase everything keyed to a user, for the Clerk `user.deleted` webhook. Batched so a
     * partial failure can't leave personal data behind — neon-http has no interactive
     * transactions, and batch() is the transactional primitive it does support. Deleting
     * nothing is a no-op, so webhook redeliveries are safe.
     */
    async deleteUserData(database: Database, userId: string) {
        await database.batch([
            database.delete(tasks).where(eq(tasks.userId, userId)),
            database.delete(focusSessions).where(eq(focusSessions.userId, userId)),
            database.delete(ambientMixes).where(eq(ambientMixes.userId, userId)),
            database.delete(savedPresets).where(eq(savedPresets.userId, userId)),
            database.delete(userPreferences).where(eq(userPreferences.userId, userId)),
        ]);
    },

    /**
     * Everything keyed to a user, for the account data export.
     *
     * Reads exactly the five tables deleteUserData erases: what the product destroys on
     * account deletion is what it has to be able to hand back. Deliberately unbounded —
     * a partial export would be a worse answer than a slow one, and this runs at most a
     * few times per account.
     */
    async exportUserData(database: Database, userId: string): Promise<UserDataExport> {
        const [exportedTasks, exportedSessions, exportedMixes, exportedPresets, storedPreferences] = await Promise.all([
            database.select().from(tasks).where(eq(tasks.userId, userId)).orderBy(asc(tasks.createdAt)),
            database
                .select({ session: focusSessions, taskText: tasks.text })
                .from(focusSessions)
                // Left, not inner: a session outlives the task it named, and losing those
                // rows would quietly drop focus time the user actually spent.
                .leftJoin(tasks, eq(tasks.id, focusSessions.taskId))
                .where(eq(focusSessions.userId, userId))
                .orderBy(asc(focusSessions.startedAt)),
            database.select().from(ambientMixes).where(eq(ambientMixes.userId, userId)).orderBy(asc(ambientMixes.createdAt)),
            database.select().from(savedPresets).where(eq(savedPresets.userId, userId)).orderBy(asc(savedPresets.createdAt)),
            database.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1),
        ]);

        return {
            exportedAt: new Date().toISOString(),
            schemaVersion: EXPORT_SCHEMA_VERSION,
            tasks: exportedTasks.map((row) => ({
                id: row.id,
                text: row.text,
                priority: row.priority,
                isCompleted: row.isCompleted,
                dueAt: toIsoOrNull(row.dueAt),
                dueHasTime: row.dueHasTime,
                createdAt: row.createdAt.toISOString(),
                updatedAt: row.updatedAt.toISOString(),
            })),
            focusSessions: exportedSessions.map(({ session, taskText }) => ({
                id: session.id,
                mode: session.mode,
                timerKind: session.timerKind,
                status: session.status,
                plannedDurationSeconds: session.plannedDurationSeconds,
                elapsedSeconds: session.elapsedSeconds,
                trackId: session.trackId,
                taskId: session.taskId,
                taskText,
                startedAt: session.startedAt.toISOString(),
                completedAt: toIsoOrNull(session.completedAt),
                canceledAt: toIsoOrNull(session.canceledAt),
                cycleCompletedAt: toIsoOrNull(session.cycleCompletedAt),
            })),
            preferences: storedPreferences[0] ? mapPreferences(storedPreferences[0]) : null,
            ambientMixes: exportedMixes.map((row) => ({
                id: row.id,
                name: row.name,
                levels: row.levels,
                createdAt: row.createdAt.toISOString(),
            })),
            savedPresets: exportedPresets.map((row) => ({
                id: row.id,
                name: row.name,
                trackId: row.trackId,
                backgroundId: row.backgroundId,
                mode: row.mode,
                createdAt: row.createdAt.toISOString(),
            })),
        };
    },

    /**
     * Recent blocks for the progress panel. Bounded on the server rather than by a client
     * parameter: this is a "what have I been doing lately" list, and no caller has a reason
     * to ask for a user's entire history.
     */
    async listRecentSessions(database: Database, userId: string) {
        const recentSessions = await database
            .select()
            .from(focusSessions)
            .where(completedSessionsOf(userId))
            .orderBy(desc(focusSessions.completedAt))
            .limit(SESSION_HISTORY_LIMIT);

        return recentSessions.map(mapSession);
    },

    /**
     * Focus time banked against each task, for the task list. Inner-joined to `tasks` rather
     * than grouped on `focusSessions.taskId` alone: sessions deliberately outlive the task
     * they named, and totals for tasks the user has since deleted are payload no caller can
     * render — that residue would otherwise grow with every task ever deleted.
     */
    async listTaskFocusTotals(database: Database, userId: string): Promise<TaskFocusTotal[]> {
        return database
            .select({
                taskId: tasks.id,
                totalSeconds: sql<number>`coalesce(sum(${focusSessions.elapsedSeconds}), 0)::int`,
                sessionCount: sql<number>`count(*)::int`,
            })
            .from(focusSessions)
            .innerJoin(tasks, eq(tasks.id, focusSessions.taskId))
            .where(and(completedSessionsOf(userId), eq(tasks.userId, userId)))
            .groupBy(tasks.id);
    },

    /**
     * Focus seconds per user-local calendar day over the recent window — grouped in the
     * database the same way the streak days are. The SQL window is padded a day so a zone
     * west of UTC never loses its oldest local day to the cutoff.
     */
    async listDailyFocus(database: Database, userId: string, timeZone: string): Promise<DailyFocus[]> {
        const completedDay = completedDayInZone(timeZone);
        return database
            .select({
                day: completedDay,
                totalSeconds: sql<number>`coalesce(sum(${focusSessions.elapsedSeconds}), 0)::int`,
            })
            .from(focusSessions)
            .where(
                and(
                    completedSessionsOf(userId),
                    sql`${focusSessions.completedAt} >= now() - make_interval(days => ${DAILY_FOCUS_WINDOW_DAYS + 1})`,
                ),
            )
            .groupBy(completedDay)
            .orderBy(asc(completedDay));
    },

    async getSessionSummary(database: Database, userId: string, timeZone: string) {
        const completedDay = completedDayInZone(timeZone);

        // Four numbers, so let the database produce four numbers. Pulling every completed
        // row back to count it in JS grew with the user's whole history, which is exactly
        // the payload that gets heaviest for the people who use the product most.
        const [totals, activeDays] = await Promise.all([
            database
                .select({
                    totalSessions: sql<number>`count(*)::int`,
                    totalSeconds: sql<number>`coalesce(sum(${focusSessions.elapsedSeconds}), 0)::int`,
                    completedCycles: sql<number>`count(${focusSessions.cycleCompletedAt})::int`,
                })
                .from(focusSessions)
                .where(completedSessionsOf(userId)),
            // The streak only ever reads back from the newest day until a gap, so a window
            // this wide can never cut one short in practice.
            database
                .select({ day: completedDay })
                .from(focusSessions)
                .where(completedSessionsOf(userId))
                .groupBy(completedDay)
                .orderBy(desc(completedDay))
                .limit(STREAK_WINDOW_DAYS),
        ]);

        return {
            totalSessions: totals[0]?.totalSessions ?? 0,
            totalMinutes: Math.round((totals[0]?.totalSeconds ?? 0) / 60),
            completedCycles: totals[0]?.completedCycles ?? 0,
            currentStreak: calculateCurrentStreak(
                activeDays.map((row) => row.day),
                dayKeyInZone(new Date(), timeZone),
            ),
        };
    },
};

export type AppRepository = typeof appRepository;
export type RepositoryBackground = Background;
