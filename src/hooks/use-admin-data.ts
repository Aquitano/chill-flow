'use client';

import { api, type AdminTrackUpdateInput } from '@/lib/api';
import { MAX_AUDIO_BYTES, MAX_IMAGE_BYTES } from '@/lib/upload-limits';
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

function fileExt(name: string, fallback: string): string {
    const match = /\.[a-z0-9]+$/i.exec(name);
    return match ? match[0].toLowerCase() : fallback;
}

/** Reject oversized files before uploading (server presign enforces the same caps). */
function assertWithinLimit(audio: File | null, cover: File | null): void {
    if (audio && audio.size > MAX_AUDIO_BYTES) {
        throw new Error('Audio file exceeds the 50MB limit.');
    }
    if (cover && cover.size > MAX_IMAGE_BYTES) {
        throw new Error('Cover image exceeds the 5MB limit.');
    }
}

function readAudioDuration(file: File): Promise<number> {
    return new Promise((resolve) => {
        const audio = document.createElement('audio');
        audio.preload = 'metadata';
        const src = URL.createObjectURL(file);
        const finish = (value: number) => {
            URL.revokeObjectURL(src);
            resolve(Number.isFinite(value) && value > 0 ? Math.round(value) : 0);
        };
        audio.onloadedmetadata = () => finish(audio.duration);
        audio.onerror = () => finish(0);
        audio.src = src;
    });
}

async function putToStorage(target: { url: string; headers: Record<string, string> }, file: File): Promise<void> {
    const response = await fetch(target.url, { method: 'PUT', body: file, headers: target.headers });
    if (!response.ok) {
        throw new Error(`Direct upload failed (${response.status}).`);
    }
}

export type ImportTrackInput = {
    id: string;
    title: string;
    artist: string;
    category: string;
    tags: string[];
    file: File;
    cover: File | null;
};

export function useImportTrackMutation() {
    const invalidate = useInvalidateTracks();
    return useMutation({
        mutationFn: async (input: ImportTrackInput) => {
            assertWithinLimit(input.file, input.cover);
            const durationSec = await readAudioDuration(input.file);
            const audioExt = fileExt(input.file.name, '.mp3');
            const coverExt = input.cover ? fileExt(input.cover.name, '.jpg') : undefined;
            const presign = await api.tracks.presignUpload({
                id: input.id,
                audioExt,
                coverExt,
                audioBytes: input.file.size,
                coverBytes: input.cover?.size,
            });

            // No R2 backend: send the file through the multipart route (local/dev backend).
            if (presign.mode === 'local') {
                const form = new FormData();
                form.set('file', input.file);
                form.set('id', input.id);
                form.set('title', input.title);
                form.set('artist', input.artist);
                form.set('category', input.category);
                form.set('tags', input.tags.join(','));
                if (input.cover) form.set('cover', input.cover);
                return api.tracks.upload(form);
            }

            if (!presign.audio) throw new Error('No upload URL returned for the audio file.');
            if (input.cover && !presign.cover) throw new Error('No upload URL returned for the cover image.');
            await putToStorage(presign.audio, input.file);
            let thumbnailKey: string | undefined;
            if (input.cover && presign.cover) {
                await putToStorage(presign.cover, input.cover);
                thumbnailKey = presign.cover.key;
            }
            return api.tracks.create({
                id: input.id,
                storageKey: presign.audio.key,
                title: input.title,
                artist: input.artist,
                category: input.category,
                tags: input.tags,
                durationSec,
                thumbnailKey,
            });
        },
        onSuccess: () => invalidate(),
    });
}

export type ReplaceAssetInput = { id: string; audio: File | null; cover: File | null };

export function useReplaceTrackAssetMutation() {
    const invalidate = useInvalidateTracks();
    return useMutation({
        mutationFn: async (input: ReplaceAssetInput) => {
            assertWithinLimit(input.audio, input.cover);
            const audioExt = input.audio ? fileExt(input.audio.name, '.mp3') : undefined;
            const coverExt = input.cover ? fileExt(input.cover.name, '.jpg') : undefined;
            const presign = await api.tracks.presignUpload({
                id: input.id,
                audioExt,
                coverExt,
                audioBytes: input.audio?.size,
                coverBytes: input.cover?.size,
            });

            if (presign.mode === 'local') {
                const form = new FormData();
                form.set('id', input.id);
                if (input.audio) form.set('file', input.audio);
                if (input.cover) form.set('cover', input.cover);
                return api.tracks.replaceAsset(form);
            }

            if (input.audio && !presign.audio) throw new Error('No upload URL returned for the audio file.');
            if (input.cover && !presign.cover) throw new Error('No upload URL returned for the cover image.');

            const updates: AdminTrackUpdateInput = { id: input.id };
            if (input.audio && presign.audio) {
                await putToStorage(presign.audio, input.audio);
                updates.storageKey = presign.audio.key;
                updates.durationSec = await readAudioDuration(input.audio);
            }
            if (input.cover && presign.cover) {
                await putToStorage(presign.cover, input.cover);
                updates.thumbnailKey = presign.cover.key;
            }
            return api.tracks.update(updates);
        },
        onSuccess: () => invalidate(),
    });
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
