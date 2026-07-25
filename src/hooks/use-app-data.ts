'use client';

import { ApiError, api } from '@/lib/api';
import { Task, UserPreferences } from '@/models/app';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const queryKeys = {
    tasks: ['tasks'],
    tracks: ['tracks'],
    preferences: ['preferences'],
    sessions: ['sessions'],
    sessionHistory: ['sessions', 'history'],
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

export function useUpdateAmbientMixMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { id: string; name: string; levels: Record<string, number> }) =>
            api.ambient.updateMix(input),
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

/**
 * Recent completed blocks. Keyed under `sessions` so finishing a block invalidates the
 * history along with the totals; pass enabled=false until the progress panel is showing.
 */
export function useSessionHistoryQuery(enabled: boolean) {
    return useQuery({
        queryKey: queryKeys.sessionHistory,
        queryFn: api.sessions.history,
        enabled,
    });
}

/**
 * Retry once on a dropped connection or a server fault, never on a rejected request: a 4xx
 * fails the same way twice, and retrying a 429 only digs the rate limit deeper. Used by the
 * session writes, where a lost request costs the user their recorded focus time.
 */
function retryTransientOnce(failureCount: number, error: Error) {
    return failureCount < 1 && !(error instanceof ApiError && error.status < 500);
}

type TaskListContext = { previous?: Task[] };

export function useCreateTaskMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { text: string; priority: Task['priority']; dueAt?: Date | null; dueHasTime?: boolean }) =>
            api.tasks.create(input),
        onMutate: async (input): Promise<TaskListContext> => {
            await queryClient.cancelQueries({ queryKey: queryKeys.tasks });
            const previous = queryClient.getQueryData<Task[]>(queryKeys.tasks);
            // Newest task renders first (server orders by createdAt desc), so prepend.
            const optimisticTask: Task = {
                id: `optimistic-${crypto.randomUUID()}`,
                text: input.text,
                priority: input.priority,
                isCompleted: false,
                dueAt: input.dueAt ?? null,
                dueHasTime: input.dueAt == null ? false : (input.dueHasTime ?? false),
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
        mutationFn: (input: {
            id: string;
            text?: string;
            priority?: Task['priority'];
            isCompleted?: boolean;
            dueAt?: Date | null;
            dueHasTime?: boolean;
        }) => api.tasks.update(input),
        onMutate: async (input): Promise<TaskListContext> => {
            await queryClient.cancelQueries({ queryKey: queryKeys.tasks });
            const previous = queryClient.getQueryData<Task[]>(queryKeys.tasks);
            queryClient.setQueryData<Task[]>(queryKeys.tasks, (old = []) =>
                old.map((task) => {
                    if (task.id !== input.id) return task;
                    const dueAt = input.dueAt === undefined ? task.dueAt : input.dueAt;
                    const dueHasTime =
                        dueAt === null
                            ? false
                            : input.dueAt !== undefined
                              ? (input.dueHasTime ?? false)
                              : (input.dueHasTime ?? task.dueHasTime);
                    return { ...task, ...input, dueHasTime };
                }),
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

export function useClearCompletedTasksMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: () => api.tasks.clearCompleted(),
        onMutate: async (): Promise<TaskListContext> => {
            await queryClient.cancelQueries({ queryKey: queryKeys.tasks });
            const previous = queryClient.getQueryData<Task[]>(queryKeys.tasks);
            queryClient.setQueryData<Task[]>(queryKeys.tasks, (old = []) => old.filter((task) => !task.isCompleted));
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
        mutationFn: (input: {
            mode: string;
            timerKind: 'focus' | 'pomodoro';
            plannedDurationSeconds: number;
            trackId: string | null;
            taskId: string | null;
        }) => api.sessions.start(input),
        retry: retryTransientOnce,
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
        },
    });
}

export function useSessionCompleteMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { id: string; elapsedSeconds: number }) => api.sessions.complete(input),
        retry: retryTransientOnce,
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
        },
    });
}

export function useSessionCycleCompleteMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { id: string }) => api.sessions.completeCycle(input),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
        },
    });
}

export function useSessionRecoverMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { id: string; elapsedSeconds: number }) => api.sessions.recover(input),
        retry: retryTransientOnce,
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
