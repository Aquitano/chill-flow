import { appRepository } from '@/server/repositories/app-repository';
import { probeDurationFromBytes, readFileBytes } from '@/server/storage/asset-upload';
import { getAudioStorage } from '@/server/storage/audio-storage';
import { NextResponse } from 'next/server';
import { requireAdminRequest, validateAsset } from '../_lib';

export const runtime = 'nodejs';

type TrackUpdate = {
    storageKey?: string;
    durationSec?: number;
    thumbnailKey?: string;
};

export async function POST(request: Request) {
    const guard = await requireAdminRequest(request);
    if ('response' in guard) return guard.response;
    const { database } = guard;

    const form = await request.formData();
    const id = String(form.get('id') ?? '').trim();
    const existing = id ? await appRepository.getAdminTrackById(database, id) : null;
    if (!existing) {
        return NextResponse.json({ message: 'Track not found.' }, { status: 404 });
    }

    const audio = form.get('file');
    const cover = form.get('cover');
    if (!(audio instanceof File && audio.size > 0) && !(cover instanceof File && cover.size > 0)) {
        return NextResponse.json({ message: 'Provide a new audio file or cover image.' }, { status: 422 });
    }

    const storage = getAudioStorage();
    const updates: TrackUpdate = {};
    const staleKeys: string[] = [];

    if (audio instanceof File && audio.size > 0) {
        const validation = validateAsset(audio, 'audio');
        if ('response' in validation) return validation.response;
        const newKey = `${id}${validation.ext}`;
        const audioBytes = await readFileBytes(audio);
        await storage.put(newKey, audioBytes);
        updates.storageKey = newKey;
        updates.durationSec = await probeDurationFromBytes(audioBytes, validation.ext);
        if (existing.storageKey !== newKey) staleKeys.push(existing.storageKey);
    }

    if (cover instanceof File && cover.size > 0) {
        const validation = validateAsset(cover, 'image');
        if ('response' in validation) return validation.response;
        const newKey = `cover-${id}${validation.ext}`;
        await storage.put(newKey, await readFileBytes(cover));
        updates.thumbnailKey = newKey;
        if (existing.thumbnailKey && existing.thumbnailKey !== newKey) staleKeys.push(existing.thumbnailKey);
    }

    const updated = await appRepository.updateTrack(database, id, updates);

    // Remove superseded files only after the row points at the new ones.
    await Promise.all(staleKeys.map((key) => storage.remove(key).catch(() => {})));

    return NextResponse.json(updated);
}
