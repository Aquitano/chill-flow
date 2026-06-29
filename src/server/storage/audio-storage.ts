import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Where uploaded audio physically lives. Only the `local` backend (public/audio/) exists for
 * now; an R2 backend can implement the same interface later without touching callers.
 */
export interface AudioStorage {
    put(key: string, bytes: Uint8Array): Promise<void>;
    remove(key: string): Promise<void>;
}

const PUBLIC_AUDIO_DIR = path.join(process.cwd(), 'public', 'audio');

class LocalAudioStorage implements AudioStorage {
    async put(key: string, bytes: Uint8Array): Promise<void> {
        await mkdir(PUBLIC_AUDIO_DIR, { recursive: true });
        await writeFile(path.join(PUBLIC_AUDIO_DIR, key), bytes);
    }

    async remove(key: string): Promise<void> {
        await rm(path.join(PUBLIC_AUDIO_DIR, key), { force: true });
    }
}

export function getAudioStorage(): AudioStorage {
    return new LocalAudioStorage();
}

/** Absolute path of a stored key under the local backend (used to probe duration). */
export function localAudioPath(key: string): string {
    return path.join(PUBLIC_AUDIO_DIR, key);
}
