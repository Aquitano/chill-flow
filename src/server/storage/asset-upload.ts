import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.opus', '.webm', '.wav']);
export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function fileExtension(file: File, fallback: string): string {
    return path.extname(file.name).toLowerCase() || fallback;
}

export async function readFileBytes(file: File): Promise<Uint8Array> {
    return new Uint8Array(await file.arrayBuffer());
}

/**
 * ffprobe a track's duration from its bytes (via a temp file), so it works no matter which
 * storage backend the file lives in. Returns 0 if ffprobe is unavailable (e.g. on Vercel,
 * where the admin can set the duration manually afterward).
 */
export async function probeDurationFromBytes(bytes: Uint8Array, ext: string): Promise<number> {
    const dir = await mkdtemp(path.join(tmpdir(), 'chillflow-audio-'));
    const tempFile = path.join(dir, `probe${ext}`);
    try {
        await writeFile(tempFile, bytes);
        const { stdout } = await execFileAsync('ffprobe', [
            '-v',
            'error',
            '-show_entries',
            'format=duration',
            '-of',
            'default=noprint_wrappers=1:nokey=1',
            tempFile,
        ]);
        const seconds = Math.round(Number(stdout.trim()));
        return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    } catch {
        return 0;
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}
