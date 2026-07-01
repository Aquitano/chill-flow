import { appRepository } from '@/server/repositories/app-repository';
import { probeDurationFromBytes, readFileBytes, uniqueAssetKey } from '@/server/storage/asset-upload';
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
    const newKeys: string[] = [];

    if (audio instanceof File && audio.size > 0) {
        const validation = validateAsset(audio, 'audio');
        if ('response' in validation) return validation.response;
        const newKey = uniqueAssetKey(id, validation.ext);
        const audioBytes = await readFileBytes(audio);
        await storage.put(newKey, audioBytes);
        newKeys.push(newKey);
        updates.storageKey = newKey;
        // ffprobe returns 0 when unavailable (e.g. on Vercel); don't overwrite a good duration
        // with 0 — the admin can still adjust it manually.
        const durationSec = await probeDurationFromBytes(audioBytes, validation.ext);
        if (durationSec > 0) updates.durationSec = durationSec;
        staleKeys.push(existing.storageKey);
    }

    if (cover instanceof File && cover.size > 0) {
        const validation = validateAsset(cover, 'image');
        if ('response' in validation) return validation.response;
        const newKey = uniqueAssetKey(`cover-${id}`, validation.ext);
        await storage.put(newKey, await readFileBytes(cover));
        newKeys.push(newKey);
        updates.thumbnailKey = newKey;
        if (existing.thumbnailKey) staleKeys.push(existing.thumbnailKey);
    }

    let updated;
    try {
        updated = await appRepository.updateTrack(database, id, updates);
    } catch (error) {
        await Promise.all(newKeys.map((key) => storage.remove(key).catch(() => {})));
        throw error;
    }
    if (!updated) {
        // Row vanished between the lookup and the update; don't leak the just-written objects.
        await Promise.all(newKeys.map((key) => storage.remove(key).catch(() => {})));
        return NextResponse.json({ message: 'Track not found.' }, { status: 404 });
    }

    // Remove superseded files only after the row points at the new ones.
    await Promise.all(staleKeys.map((key) => storage.remove(key).catch(() => {})));

    return NextResponse.json(updated);
}
