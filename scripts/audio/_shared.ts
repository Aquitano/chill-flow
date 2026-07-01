import process from 'node:process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// All audio tooling runs under bun from the repo root (`bun run audio:*`), so cwd is stable.
export const ROOT = process.cwd();
export const ORIGINALS_DIR = path.join(ROOT, 'scripts', 'audio', 'originals');
export const PUBLIC_AUDIO_DIR = path.join(ROOT, 'public', 'audio');
export const MANIFEST_PATH = path.join(ROOT, 'scripts', 'audio', 'manifest.json');

/** One catalog row as authored by hand (durationSec is filled by `audio:build`). */
export type ManifestEntry = {
    id: string;
    storageKey: string;
    title: string;
    artist: string;
    category: string;
    tags?: string[];
    durationSec: number;
};

export function readManifest(): ManifestEntry[] {
    if (!existsSync(MANIFEST_PATH)) return [];
    const raw = readFileSync(MANIFEST_PATH, 'utf8').trim();
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
        throw new Error('manifest.json must be a JSON array of track entries.');
    }
    return parsed as ManifestEntry[];
}

export function writeManifest(entries: ManifestEntry[]): void {
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(entries, null, 4)}\n`);
}

export function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        console.error(`Missing required env var ${name}. See .env.example.`);
        process.exit(1);
    }
    return value;
}
