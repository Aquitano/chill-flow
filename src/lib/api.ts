'use client';

import { client } from '@/lib/client';
import {
    AdminTrack,
    AmbientMix,
    AmbientSound,
    Background,
    FocusSession,
    Quote,
    Task,
    Track,
    UserPreferences,
} from '@/models/app';

export type AdminTrackUpdateInput = {
    id: string;
    title?: string;
    artist?: string;
    category?: string;
    tags?: string[];
    storageKey?: string;
    durationSec?: number;
    thumbnailKey?: string;
};

export type CreateTrackInput = {
    id: string;
    storageKey: string;
    title: string;
    artist: string;
    category: string;
    tags: string[];
    durationSec: number;
    thumbnailKey?: string | null;
};

type PresignedTarget = { key: string; url: string; headers: Record<string, string> };
export type PresignResponse =
    | { mode: 'local' }
    | { mode: 'r2'; audio: PresignedTarget | null; cover: PresignedTarget | null };

export class ApiError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
    }
}

/** Maps an API/network failure to a short, user-facing message for toasts. */
export function describeApiError(error: unknown): string {
    if (error instanceof ApiError) {
        switch (error.status) {
            case 401:
                return 'Your session expired — please sign in again.';
            case 403:
                return 'That request was blocked. Try reloading the page.';
            case 422:
                return "That didn't look valid. Please check and retry.";
            case 429:
                return 'Slow down a moment — too many requests. Please retry shortly.';
            case 503:
                return 'The workspace backend is unavailable right now.';
            default:
                return error.status >= 500
                    ? 'Something went wrong on our end. Please retry.'
                    : error.message || 'Request failed. Please retry.';
        }
    }

    return error instanceof Error && error.message ? error.message : 'Something went wrong. Please retry.';
}

async function unwrap<T>(request: Promise<Response>): Promise<T> {
    const response = await request;

    if (!response.ok) {
        let message = `Request failed with status ${response.status}`;
        try {
            const body = (await response.clone().json()) as unknown;
            if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
                message = body.message;
            }
        } catch {
            // Non-JSON error body; fall back to the status-based message above.
        }
        throw new ApiError(response.status, message);
    }

    return response.json() as Promise<T>;
}

export type PreferencesPayload = {
    preferences: UserPreferences;
    backgrounds: Background[];
    quotes: Quote[];
};

export type SessionPayload = {
    sessions: FocusSession[];
    summary: {
        totalSessions: number;
        totalMinutes: number;
        completedCycles: number;
        currentStreak: number;
    };
};

export const api = {
    tasks: {
        list: () => unwrap<Task[]>(client.tasks.list.$get()),
        create: (input: { text: string; priority: Task['priority'] }) => unwrap<Task>(client.tasks.create.$post(input)),
        update: (input: { id: string; text?: string; priority?: Task['priority']; isCompleted?: boolean }) =>
            unwrap<Task | null>(client.tasks.update.$post(input)),
        delete: (input: { id: string }) => unwrap<{ success: boolean }>(client.tasks.delete.$post(input)),
    },
    tracks: {
        list: () => unwrap<Track[]>(client.tracks.list.$get()),
        getById: (id: string) => unwrap<Track | null>(client.tracks.getById.$get({ id })),
        adminList: () => unwrap<AdminTrack[]>(client.tracks.adminList.$get()),
        create: (input: CreateTrackInput) => unwrap<AdminTrack>(client.tracks.create.$post(input)),
        update: (input: AdminTrackUpdateInput) => unwrap<AdminTrack | null>(client.tracks.update.$post(input)),
        delete: (input: { id: string }) => unwrap<{ success: boolean }>(client.tracks.delete.$post(input)),
        presignUpload: (input: {
            id: string;
            audioExt?: string;
            coverExt?: string;
            audioBytes?: number;
            coverBytes?: number;
        }) => unwrap<PresignResponse>(client.tracks.presignUpload.$post(input)),
        upload: (formData: FormData) =>
            unwrap<AdminTrack>(fetch('/api/admin/tracks/upload', { method: 'POST', body: formData })),
        replaceAsset: (formData: FormData) =>
            unwrap<AdminTrack | null>(fetch('/api/admin/tracks/replace', { method: 'POST', body: formData })),
    },
    ambient: {
        sounds: () => unwrap<AmbientSound[]>(client.ambient.sounds.$get()),
        listMixes: () => unwrap<AmbientMix[]>(client.ambient.listMixes.$get()),
        saveMix: (input: { name: string; levels: Record<string, number> }) =>
            unwrap<AmbientMix>(client.ambient.saveMix.$post(input)),
        updateMix: (input: { id: string; name: string; levels: Record<string, number> }) =>
            unwrap<AmbientMix | null>(client.ambient.updateMix.$post(input)),
        deleteMix: (input: { id: string }) => unwrap<{ success: boolean }>(client.ambient.deleteMix.$post(input)),
    },
    preferences: {
        get: () => unwrap<PreferencesPayload>(client.preferences.get.$get()),
        update: (input: Partial<UserPreferences>) => unwrap<UserPreferences>(client.preferences.update.$post(input)),
    },
    sessions: {
        list: () => unwrap<SessionPayload>(client.sessions.list.$get()),
        start: (input: {
            mode: string;
            timerKind: FocusSession['timerKind'];
            plannedDurationSeconds: number;
            trackId: string | null;
        }) => unwrap<FocusSession>(client.sessions.start.$post(input)),
        complete: (input: { id: string; elapsedSeconds: number }) =>
            unwrap<FocusSession | null>(client.sessions.complete.$post(input)),
        completeCycle: (input: { id: string }) =>
            unwrap<FocusSession | null>(client.sessions.completeCycle.$post(input)),
        cancel: (input: { id: string }) => unwrap<FocusSession | null>(client.sessions.cancel.$post(input)),
    },
};
