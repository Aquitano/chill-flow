import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { getAudioStorage, localAudioPath } from './audio-storage';

const execFileAsync = promisify(execFile);

export const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.opus', '.webm', '.wav']);
export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function fileExtension(file: File, fallback: string): string {
    return path.extname(file.name).toLowerCase() || fallback;
}

export async function storeFile(key: string, file: File): Promise<void> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await getAudioStorage().put(key, bytes);
}

/** ffprobe the stored file for its duration; returns 0 if ffprobe is unavailable or fails. */
export async function probeDurationSeconds(storageKey: string): Promise<number> {
    try {
        const { stdout } = await execFileAsync('ffprobe', [
            '-v',
            'error',
            '-show_entries',
            'format=duration',
            '-of',
            'default=noprint_wrappers=1:nokey=1',
            localAudioPath(storageKey),
        ]);
        const seconds = Math.round(Number(stdout.trim()));
        return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    } catch {
        return 0;
    }
}
