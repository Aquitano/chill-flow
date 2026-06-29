'use client';

import { api, type AdminTrackUpdateInput } from '@/lib/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const adminTracksKey = ['admin', 'tracks'];
const publicTracksKey = ['tracks'];

export function useAdminTracksQuery() {
    return useQuery({
        queryKey: adminTracksKey,
        queryFn: api.tracks.adminList,
    });
}

function useInvalidateTracks() {
    const queryClient = useQueryClient();
    return () =>
        Promise.all([
            queryClient.invalidateQueries({ queryKey: adminTracksKey }),
            // Keep the player's public catalog in sync after admin edits.
            queryClient.invalidateQueries({ queryKey: publicTracksKey }),
        ]);
}

export function useUpdateTrackMutation() {
    const invalidate = useInvalidateTracks();
    return useMutation({
        mutationFn: (input: AdminTrackUpdateInput) => api.tracks.update(input),
        onSuccess: () => invalidate(),
    });
}

export function useDeleteTrackMutation() {
    const invalidate = useInvalidateTracks();
    return useMutation({
        mutationFn: (input: { id: string }) => api.tracks.delete(input),
        onSuccess: () => invalidate(),
    });
}

export function useUploadTrackMutation() {
    const invalidate = useInvalidateTracks();
    return useMutation({
        mutationFn: (formData: FormData) => api.tracks.upload(formData),
        onSuccess: () => invalidate(),
    });
}
