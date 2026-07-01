import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.opus', '.webm', '.wav']);
export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
export { MAX_AUDIO_BYTES, MAX_IMAGE_BYTES } from '@/lib/upload-limits';

export function fileExtension(file: File, fallback: string): string {
    return path.extname(file.name).toLowerCase() || fallback;
}

/**
 * A storage key with a short random suffix so every uploaded object is unique and
 * content-independent. R2 serves objects with a one-year immutable cache, so reusing an
 * id-based key on replace would keep serving the old bytes; a fresh key per upload avoids it.
 */
export function uniqueAssetKey(prefix: string, ext: string): string {
    const token = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    return `${prefix}-${token}${ext}`;
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
