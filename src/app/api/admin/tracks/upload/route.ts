import { appRepository } from '@/server/repositories/app-repository';
import { probeDurationFromBytes, readFileBytes } from '@/server/storage/asset-upload';
import { getAudioStorage } from '@/server/storage/audio-storage';
import { uploadTrackMetadataSchema } from '@/server/validation/app';
import { NextResponse } from 'next/server';
import { requireAdminRequest, validateAsset } from '../_lib';

export const runtime = 'nodejs';

export async function POST(request: Request) {
    const guard = await requireAdminRequest(request);
    if ('response' in guard) return guard.response;
    const { database } = guard;

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json({ message: 'An audio file is required.' }, { status: 422 });
    }
    const audioValidation = validateAsset(file, 'audio');
    if ('response' in audioValidation) return audioValidation.response;

    const parsedMetadata = uploadTrackMetadataSchema.safeParse({
        id: String(form.get('id') ?? ''),
        title: String(form.get('title') ?? ''),
        artist: String(form.get('artist') ?? ''),
        category: String(form.get('category') ?? ''),
        tags: String(form.get('tags') ?? '')
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
    });
    if (!parsedMetadata.success) {
        return NextResponse.json({ message: parsedMetadata.error.issues[0]?.message ?? 'Invalid metadata.' }, { status: 422 });
    }
    const metadata = parsedMetadata.data;

    const cover = form.get('cover');
    let thumbnailKey: string | null = null;
    if (cover instanceof File && cover.size > 0) {
        const coverValidation = validateAsset(cover, 'image');
        if ('response' in coverValidation) return coverValidation.response;
        thumbnailKey = `cover-${metadata.id}${coverValidation.ext}`;
    }

    if (await appRepository.getTrackById(database, metadata.id)) {
        return NextResponse.json({ message: `A track with id "${metadata.id}" already exists.` }, { status: 409 });
    }

    const storage = getAudioStorage();
    const storageKey = `${metadata.id}${audioValidation.ext}`;
    const audioBytes = await readFileBytes(file);
    await storage.put(storageKey, audioBytes);
    const durationSec = await probeDurationFromBytes(audioBytes, audioValidation.ext);
    if (thumbnailKey && cover instanceof File) {
        await storage.put(thumbnailKey, await readFileBytes(cover));
    }

    const track = await appRepository.createTrack(database, {
        id: metadata.id,
        storageKey,
        title: metadata.title,
        artist: metadata.artist,
        category: metadata.category,
        tags: metadata.tags,
        durationSec,
        thumbnailKey,
    });

    return NextResponse.json(track);
}
