'use client';

import { api } from '@/lib/api';
import { Task, UserPreferences } from '@/models/app';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const queryKeys = {
    tasks: ['tasks'],
    tracks: ['tracks'],
    preferences: ['preferences'],
    sessions: ['sessions'],
};

export function useTasksQuery() {
    return useQuery({
        queryKey: queryKeys.tasks,
        queryFn: api.tasks.list,
    });
}

export function useTracksQuery() {
    return useQuery({
        queryKey: queryKeys.tracks,
        queryFn: api.tracks.list,
    });
}

export function usePreferencesQuery() {
    return useQuery({
        queryKey: queryKeys.preferences,
        queryFn: api.preferences.get,
    });
}

export function useSessionsQuery() {
    return useQuery({
        queryKey: queryKeys.sessions,
        queryFn: api.sessions.list,
    });
}

export function useCreateTaskMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { text: string; priority: Task['priority'] }) => api.tasks.create(input),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
        },
    });
}

export function useUpdateTaskMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { id: string; text?: string; priority?: Task['priority']; isCompleted?: boolean }) =>
            api.tasks.update(input),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
        },
    });
}

export function useDeleteTaskMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { id: string }) => api.tasks.delete(input),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
        },
    });
}

export function useUpdatePreferencesMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: Partial<UserPreferences>) => api.preferences.update(input),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.preferences }),
                queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
            ]);
        },
    });
}

export function useSessionStartMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { mode: string; durationSeconds: number; trackId: string | null }) => api.sessions.start(input),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
        },
    });
}

export function useSessionCompleteMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { id: string; durationSeconds?: number }) => api.sessions.complete(input),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
        },
    });
}
