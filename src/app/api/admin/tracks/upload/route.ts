import { getDatabase } from '@/server/db/client';
import { appRepository } from '@/server/repositories/app-repository';
import { isAdminUser } from '@/server/security/admin';
import {
    AUDIO_EXTENSIONS,
    IMAGE_EXTENSIONS,
    MAX_AUDIO_BYTES,
    MAX_IMAGE_BYTES,
    fileExtension,
    probeDurationFromBytes,
    readFileBytes,
} from '@/server/storage/asset-upload';
import { getAudioStorage } from '@/server/storage/audio-storage';
import { uploadTrackMetadataSchema } from '@/server/validation/app';
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

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
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json({ message: 'An audio file is required.' }, { status: 422 });
    }
    if (file.size > MAX_AUDIO_BYTES) {
        return NextResponse.json({ message: 'Audio file exceeds the 50MB limit.' }, { status: 413 });
    }

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

    const audioExt = fileExtension(file, '.mp3');
    if (!AUDIO_EXTENSIONS.has(audioExt)) {
        return NextResponse.json({ message: `Unsupported audio type: ${audioExt}` }, { status: 422 });
    }

    const cover = form.get('cover');
    let thumbnailKey: string | null = null;
    if (cover instanceof File && cover.size > 0) {
        const imageExt = fileExtension(cover, '.jpg');
        if (!IMAGE_EXTENSIONS.has(imageExt)) {
            return NextResponse.json({ message: `Unsupported image type: ${imageExt}` }, { status: 422 });
        }
        if (cover.size > MAX_IMAGE_BYTES) {
            return NextResponse.json({ message: 'Cover image exceeds the 5MB limit.' }, { status: 413 });
        }
        thumbnailKey = `cover-${metadata.id}${imageExt}`;
    }

    if (await appRepository.getTrackById(database, metadata.id)) {
        return NextResponse.json({ message: `A track with id "${metadata.id}" already exists.` }, { status: 409 });
    }

    const storage = getAudioStorage();
    const storageKey = `${metadata.id}${audioExt}`;
    const audioBytes = await readFileBytes(file);
    await storage.put(storageKey, audioBytes);
    const durationSec = await probeDurationFromBytes(audioBytes, audioExt);
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
