'use client';

import { api } from '@/lib/api';
import { Task, UserPreferences } from '@/models/app';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const queryKeys = {
    tasks: ['tasks'],
    tracks: ['tracks'],
    preferences: ['preferences'],
    sessions: ['sessions'],
    ambientSounds: ['ambient', 'sounds'],
    ambientMixes: ['ambient', 'mixes'],
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

export function useAmbientSoundsQuery() {
    return useQuery({
        queryKey: queryKeys.ambientSounds,
        queryFn: api.ambient.sounds,
        staleTime: 5 * 60 * 1000,
    });
}

/** Account-saved ambient mixes; pass enabled=false while signed out (the route is protected). */
export function useAmbientMixesQuery(enabled: boolean) {
    return useQuery({
        queryKey: queryKeys.ambientMixes,
        queryFn: api.ambient.listMixes,
        enabled,
    });
}

export function useSaveAmbientMixMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { name: string; levels: Record<string, number> }) => api.ambient.saveMix(input),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.ambientMixes });
        },
    });
}

export function useDeleteAmbientMixMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { id: string }) => api.ambient.deleteMix(input),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.ambientMixes });
        },
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

type TaskListContext = { previous?: Task[] };

export function useCreateTaskMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { text: string; priority: Task['priority'] }) => api.tasks.create(input),
        onMutate: async (input): Promise<TaskListContext> => {
            await queryClient.cancelQueries({ queryKey: queryKeys.tasks });
            const previous = queryClient.getQueryData<Task[]>(queryKeys.tasks);
            // Newest task renders first (server orders by createdAt desc), so prepend.
            const optimisticTask: Task = {
                id: `optimistic-${crypto.randomUUID()}`,
                text: input.text,
                priority: input.priority,
                isCompleted: false,
            };
            queryClient.setQueryData<Task[]>(queryKeys.tasks, (old = []) => [optimisticTask, ...old]);
            return { previous };
        },
        onError: (_error, _input, context) => {
            if (context?.previous) {
                queryClient.setQueryData(queryKeys.tasks, context.previous);
            }
        },
        onSettled: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
        },
    });
}

export function useUpdateTaskMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { id: string; text?: string; priority?: Task['priority']; isCompleted?: boolean }) =>
            api.tasks.update(input),
        onMutate: async (input): Promise<TaskListContext> => {
            await queryClient.cancelQueries({ queryKey: queryKeys.tasks });
            const previous = queryClient.getQueryData<Task[]>(queryKeys.tasks);
            queryClient.setQueryData<Task[]>(queryKeys.tasks, (old = []) =>
                old.map((task) => (task.id === input.id ? { ...task, ...input } : task)),
            );
            return { previous };
        },
        onError: (_error, _input, context) => {
            if (context?.previous) {
                queryClient.setQueryData(queryKeys.tasks, context.previous);
            }
        },
        onSettled: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
        },
    });
}

export function useDeleteTaskMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { id: string }) => api.tasks.delete(input),
        onMutate: async (input): Promise<TaskListContext> => {
            await queryClient.cancelQueries({ queryKey: queryKeys.tasks });
            const previous = queryClient.getQueryData<Task[]>(queryKeys.tasks);
            queryClient.setQueryData<Task[]>(queryKeys.tasks, (old = []) => old.filter((task) => task.id !== input.id));
            return { previous };
        },
        onError: (_error, _input, context) => {
            if (context?.previous) {
                queryClient.setQueryData(queryKeys.tasks, context.previous);
            }
        },
        onSettled: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
        },
    });
}

export function useUpdatePreferencesMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: Partial<UserPreferences>) => api.preferences.update(input),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.preferences });
        },
    });
}

export function useSessionStartMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { mode: string; plannedDurationSeconds: number; trackId: string | null }) =>
            api.sessions.start(input),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
        },
    });
}

export function useSessionCompleteMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { id: string; elapsedSeconds: number }) => api.sessions.complete(input),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
        },
    });
}

export function useSessionCancelMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { id: string }) => api.sessions.cancel(input),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
        },
    });
}
