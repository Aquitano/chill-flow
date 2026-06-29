import { getDatabase } from '@/server/db/client';
import { appRepository } from '@/server/repositories/app-repository';
import { isAdminUser } from '@/server/security/admin';
import { getAudioStorage } from '@/server/storage/audio-storage';
import {
    AUDIO_EXTENSIONS,
    IMAGE_EXTENSIONS,
    MAX_AUDIO_BYTES,
    MAX_IMAGE_BYTES,
    fileExtension,
    probeDurationFromBytes,
    readFileBytes,
} from '@/server/storage/asset-upload';
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

type TrackUpdate = {
    storageKey?: string;
    durationSec?: number;
    thumbnailKey?: string;
};

export async function POST(request: Request) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isAdminUser(userId))) {
        return NextResponse.json({ message: 'Admin access required.' }, { status: 403 });
    }

    const database = getDatabase();
    if (!database) {
        return NextResponse.json({ message: 'Database is not configured.' }, { status: 503 });
    }

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
        if (audio.size > MAX_AUDIO_BYTES) {
            return NextResponse.json({ message: 'Audio file exceeds the 50MB limit.' }, { status: 413 });
        }
        const ext = fileExtension(audio, '.mp3');
        if (!AUDIO_EXTENSIONS.has(ext)) {
            return NextResponse.json({ message: `Unsupported audio type: ${ext}` }, { status: 422 });
        }
        const newKey = `${id}${ext}`;
        const audioBytes = await readFileBytes(audio);
        await storage.put(newKey, audioBytes);
        updates.storageKey = newKey;
        updates.durationSec = await probeDurationFromBytes(audioBytes, ext);
        if (existing.storageKey !== newKey) staleKeys.push(existing.storageKey);
    }

    if (cover instanceof File && cover.size > 0) {
        if (cover.size > MAX_IMAGE_BYTES) {
            return NextResponse.json({ message: 'Cover image exceeds the 5MB limit.' }, { status: 413 });
        }
        const ext = fileExtension(cover, '.jpg');
        if (!IMAGE_EXTENSIONS.has(ext)) {
            return NextResponse.json({ message: `Unsupported image type: ${ext}` }, { status: 422 });
        }
        const newKey = `cover-${id}${ext}`;
        await storage.put(newKey, await readFileBytes(cover));
        updates.thumbnailKey = newKey;
        if (existing.thumbnailKey && existing.thumbnailKey !== newKey) staleKeys.push(existing.thumbnailKey);
    }

    const updated = await appRepository.updateTrack(database, id, updates);

    // Remove superseded files only after the row points at the new ones.
    await Promise.all(staleKeys.map((key) => storage.remove(key).catch(() => {})));

    return NextResponse.json(updated);
}
