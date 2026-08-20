'use client';

import { ApiError, api, describeApiError, type WorkspacePresetInput } from '@/lib/api';
import { Task, UserPreferences } from '@/models/app';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

declare module '@tanstack/react-query' {
    interface Register {
        /** Set by mutations that toast their own failure; see `rollbackTasks`. */
        mutationMeta: { toasted?: true };
    }
}

const queryKeys = {
    tasks: ['tasks'],
    tracks: ['tracks'],
    preferences: ['preferences'],
    presets: ['presets'],
    sessions: ['sessions'],
    sessionHistory: ['sessions', 'history'],
    taskFocusTotals: ['sessions', 'task-totals'],
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

/** Saved workspace presets; pass enabled=false until the picker is showing. */
export function usePresetsQuery(enabled: boolean) {
    return useQuery({
        queryKey: queryKeys.presets,
        queryFn: api.presets.list,
        enabled,
    });
}

export function useSavePresetMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: WorkspacePresetInput) => api.presets.save(input),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.presets });
        },
    });
}

export function useUpdatePresetMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: WorkspacePresetInput & { id: string }) => api.presets.update(input),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.presets });
        },
    });
}

export function useDeletePresetMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { id: string }) => api.presets.delete(input),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.presets });
        },
    });
}

export function usePreferencesQuery() {
    return useQuery({
        queryKey: queryKeys.preferences,
        queryFn: api.preferences.get,
    });
}

/**
 * Totals plus the day streak. The zone travels with the request because the streak is
 * counted in the user's calendar days, and only the browser knows which those are. Resolved
 * inside the query function so it reads the client's zone, never the server's during SSR.
 */
export function useSessionsQuery() {
    return useQuery({
        queryKey: queryKeys.sessions,
        queryFn: () => api.sessions.list({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
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
 * Focus time per task, for the task list. Keyed under `sessions` so finishing a block
 * refreshes it along with the totals; its only consumer mounts with the tasks panel, which
 * is gate enough without an `enabled` flag.
 */
export function useTaskFocusTotalsQuery() {
    return useQuery({
        queryKey: queryKeys.taskFocusTotals,
        queryFn: api.sessions.taskTotals,
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

/**
 * Shared failure path for the task writes: undo the optimistic list and name what broke,
 * so every call site (row, composer, timer prompt) reports the same way. The generic
 * mutation-cache toast in providers.tsx stands down for `meta.toasted` mutations, so a
 * failure still shows exactly one toast.
 */
function rollbackTasks(queryClient: QueryClient, title: string) {
    return (error: Error, _input: unknown, context: TaskListContext | undefined) => {
        if (context?.previous) {
            queryClient.setQueryData(queryKeys.tasks, context.previous);
        }
        toast.error(title, { description: describeApiError(error) });
    };
}

export function useCreateTaskMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { text: string; priority: Task['priority']; dueAt?: Date | null; dueHasTime?: boolean }) =>
            api.tasks.create(input),
        meta: { toasted: true },
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
        onError: rollbackTasks(queryClient, "Couldn't add that task"),
        onSettled: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
        },
    });
}

type TaskUpdateInput = {
    id: string;
    text?: string;
    priority?: Task['priority'];
    isCompleted?: boolean;
    dueAt?: Date | null;
    dueHasTime?: boolean;
};

/**
 * Mirrors `updateTaskInputSchema` in src/server/validation/app.ts, so the optimistic row
 * matches what the server writes back: a cleared due date can never keep a time of day.
 */
function nextDueHasTime(task: Task, input: TaskUpdateInput, dueAt: Date | null): boolean {
    if (dueAt === null) return false;
    if (input.dueAt !== undefined) return input.dueHasTime ?? false;
    return input.dueHasTime ?? task.dueHasTime;
}

export function useUpdateTaskMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: TaskUpdateInput) => api.tasks.update(input),
        meta: { toasted: true },
        onMutate: async (input): Promise<TaskListContext> => {
            await queryClient.cancelQueries({ queryKey: queryKeys.tasks });
            const previous = queryClient.getQueryData<Task[]>(queryKeys.tasks);
            queryClient.setQueryData<Task[]>(queryKeys.tasks, (old = []) =>
                old.map((task) => {
                    if (task.id !== input.id) return task;
                    const dueAt = input.dueAt === undefined ? task.dueAt : input.dueAt;
                    return { ...task, ...input, dueHasTime: nextDueHasTime(task, input, dueAt) };
                }),
            );
            return { previous };
        },
        onError: rollbackTasks(queryClient, "Couldn't save that change"),
        onSettled: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
        },
    });
}

export function useDeleteTaskMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { id: string }) => api.tasks.delete(input),
        meta: { toasted: true },
        onMutate: async (input): Promise<TaskListContext> => {
            await queryClient.cancelQueries({ queryKey: queryKeys.tasks });
            const previous = queryClient.getQueryData<Task[]>(queryKeys.tasks);
            queryClient.setQueryData<Task[]>(queryKeys.tasks, (old = []) => old.filter((task) => task.id !== input.id));
            return { previous };
        },
        onError: rollbackTasks(queryClient, "Couldn't delete that task"),
        onSettled: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
        },
    });
}

export function useClearCompletedTasksMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: () => api.tasks.clearCompleted(),
        meta: { toasted: true },
        onMutate: async (): Promise<TaskListContext> => {
            await queryClient.cancelQueries({ queryKey: queryKeys.tasks });
            const previous = queryClient.getQueryData<Task[]>(queryKeys.tasks);
            queryClient.setQueryData<Task[]>(queryKeys.tasks, (old = []) => old.filter((task) => !task.isCompleted));
            return { previous };
        },
        onError: rollbackTasks(queryClient, "Couldn't clear completed tasks"),
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
        mutationFn: (input: { id: string; elapsedSeconds: number; savedAtMs: number }) => api.sessions.recover(input),
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
