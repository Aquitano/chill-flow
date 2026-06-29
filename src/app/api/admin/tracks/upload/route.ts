import { getDatabase } from '@/server/db/client';
import { appRepository } from '@/server/repositories/app-repository';
import { isAdminUser } from '@/server/security/admin';
import { getAudioStorage, localAudioPath } from '@/server/storage/audio-storage';
import { uploadTrackMetadataSchema } from '@/server/validation/app';
import { auth } from '@clerk/nextjs/server';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);
const ALLOWED_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.opus', '.webm', '.wav']);
const MAX_BYTES = 50 * 1024 * 1024;

/** ffprobe the stored file for its duration; returns 0 if ffprobe is unavailable or fails. */
async function probeDurationSeconds(filePath: string): Promise<number> {
    try {
        const { stdout } = await execFileAsync('ffprobe', [
            '-v',
            'error',
            '-show_entries',
            'format=duration',
            '-of',
            'default=noprint_wrappers=1:nokey=1',
            filePath,
        ]);
        const seconds = Math.round(Number(stdout.trim()));
        return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    } catch {
        return 0;
    }
}

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
    if (file.size > MAX_BYTES) {
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

    const extension = path.extname(file.name).toLowerCase() || '.mp3';
    if (!ALLOWED_EXTENSIONS.has(extension)) {
        return NextResponse.json({ message: `Unsupported audio type: ${extension}` }, { status: 422 });
    }
    const storageKey = `${metadata.id}${extension}`;

    if (await appRepository.getTrackById(database, metadata.id)) {
        return NextResponse.json({ message: `A track with id "${metadata.id}" already exists.` }, { status: 409 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    await getAudioStorage().put(storageKey, bytes);
    const durationSec = await probeDurationSeconds(localAudioPath(storageKey));

    const track = await appRepository.createTrack(database, {
        id: metadata.id,
        storageKey,
        title: metadata.title,
        artist: metadata.artist,
        category: metadata.category,
        tags: metadata.tags,
        durationSec,
    });

    return NextResponse.json(track);
}
