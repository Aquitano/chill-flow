'use client';

import { client } from '@/lib/client';
import { Background, FocusSession, Quote, Task, Track, UserPreferences } from '@/models/app';

async function unwrap<T>(request: Promise<Response>): Promise<T> {
    const response = await request;

    if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
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
        currentStreak: number;
    };
};

export const api = {
    tasks: {
        list: () => unwrap<Task[]>(client.tasks.list.$get()),
        create: (input: { text: string; priority: Task['priority'] }) => unwrap<Task>(client.tasks.create.$post(input)),
        update: (input: { id: string; text?: string; priority?: Task['priority']; isCompleted?: boolean }) =>
            unwrap<Task | null>(client.tasks.update.$post(input)),
        complete: (input: { id: string; isCompleted: boolean }) =>
            unwrap<Task | null>(client.tasks.complete.$post(input)),
        delete: (input: { id: string }) => unwrap<{ success: boolean }>(client.tasks.delete.$post(input)),
    },
    tracks: {
        list: () => unwrap<Track[]>(client.tracks.list.$get()),
        getById: (id: string) => unwrap<Track | null>(client.tracks.getById.$get({ id })),
    },
    preferences: {
        get: () => unwrap<PreferencesPayload>(client.preferences.get.$get()),
        update: (input: Partial<UserPreferences>) =>
            unwrap<UserPreferences>(client.preferences.update.$post(input)),
    },
    sessions: {
        list: () => unwrap<SessionPayload>(client.sessions.list.$get()),
        start: (input: { mode: string; durationSeconds: number; trackId: string | null }) =>
            unwrap<FocusSession>(client.sessions.start.$post(input)),
        complete: (input: { id: string; durationSeconds?: number }) =>
            unwrap<FocusSession | null>(client.sessions.complete.$post(input)),
    },
};
