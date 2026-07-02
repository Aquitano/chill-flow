import process from 'node:process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// All audio tooling runs under bun from the repo root (`bun run audio:*`), so cwd is stable.
export const ROOT = process.cwd();
export const ORIGINALS_DIR = path.join(ROOT, 'scripts', 'audio', 'originals');
export const PUBLIC_AUDIO_DIR = path.join(ROOT, 'public', 'audio');
export const MANIFEST_PATH = path.join(ROOT, 'scripts', 'audio', 'manifest.json');

export const AMBIENT_MANIFEST_PATH = path.join(ROOT, 'scripts', 'audio', 'ambient-manifest.json');
export const AMBIENT_ORIGINALS_DIR = path.join(ORIGINALS_DIR, 'ambient');

/** One ambient catalog row; `source` documents provenance and license for attribution. */
export type AmbientManifestEntry = {
    id: string;
    label: string;
    category: string;
    storageKey: string;
    gainPercent?: number;
    sortIndex?: number;
    /** Seconds to skip from the start of the source before the loop window (default 2). */
    trimStartSec?: number;
    /** Loop window length in seconds (default 75). */
    loopSec?: number;
    source: {
        url: string;
        page?: string;
        author?: string;
        license?: string;
    };
};

export function readAmbientManifest(): AmbientManifestEntry[] {
    if (!existsSync(AMBIENT_MANIFEST_PATH)) return [];
    const raw = readFileSync(AMBIENT_MANIFEST_PATH, 'utf8').trim();
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
        throw new Error('ambient-manifest.json must be a JSON array of ambient sound entries.');
    }
    return parsed as AmbientManifestEntry[];
}

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
