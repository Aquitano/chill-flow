import 'dotenv/config';
import process from 'node:process';
import { notInArray } from 'drizzle-orm';
import { createDatabase } from '../../src/server/db/client';
import { tracks } from '../../src/server/db/schema';
import { readManifest, type ManifestEntry } from './_shared';

// Upsert the checked-in manifest into the tracks table (the runtime source of truth).
// Idempotent by id, so it is safe to run locally and once against production.

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    console.error('DATABASE_URL is required to seed tracks.');
    process.exit(1);
}

const manifest = readManifest();
if (manifest.length === 0) {
    console.error('manifest.json is empty. Add track entries first (see scripts/audio/README.md).');
    process.exit(1);
}

function assertValid(entry: ManifestEntry): void {
    const missing = (['id', 'storageKey', 'title', 'artist', 'category'] as const).filter((key) => !entry[key]);
    if (missing.length > 0) {
        console.error(`Manifest entry "${entry.id ?? '(no id)'}" is missing required field(s): ${missing.join(', ')}.`);
        process.exit(1);
    }
    if (!Number.isFinite(entry.durationSec) || entry.durationSec <= 0) {
        console.error(`Manifest entry "${entry.id}" has no durationSec. Run \`bun run audio:build\` to fill it.`);
        process.exit(1);
    }
}

manifest.forEach(assertValid);

const db = createDatabase(databaseUrl);

for (const entry of manifest) {
    await db
        .insert(tracks)
        .values({
            id: entry.id,
            title: entry.title,
            artist: entry.artist,
            category: entry.category,
            durationSec: entry.durationSec,
            tags: entry.tags ?? [],
            storageKey: entry.storageKey,
        })
        .onConflictDoUpdate({
            target: tracks.id,
            set: {
                title: entry.title,
                artist: entry.artist,
                category: entry.category,
                durationSec: entry.durationSec,
                tags: entry.tags ?? [],
                storageKey: entry.storageKey,
                updatedAt: new Date(),
            },
        });
    console.log(`Seeded ${entry.id}`);
}

// Mirror the manifest: drop rows that are no longer listed so the table can't keep stale
// tracks (e.g. after an id rename). trackId on sessions is a plain string, not an FK, so
// removing a track does not corrupt existing focus-session history.
const manifestIds = manifest.map((entry) => entry.id);
const removed = await db.delete(tracks).where(notInArray(tracks.id, manifestIds)).returning({ id: tracks.id });
if (removed.length > 0) {
    console.log(`Removed ${removed.length} stale track(s) not in manifest: ${removed.map((row) => row.id).join(', ')}`);
}

console.log(`Seeded ${manifest.length} track(s) into the tracks table.`);
