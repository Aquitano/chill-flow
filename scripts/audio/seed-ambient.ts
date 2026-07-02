import 'dotenv/config';
import process from 'node:process';
import { createDatabase } from '../../src/server/db/client';
import { ambientSounds } from '../../src/server/db/schema';
import { readAmbientManifest, type AmbientManifestEntry } from './_shared';

// Upsert the checked-in ambient manifest into the ambient_sounds table (the runtime
// source of truth). Idempotent by id, safe to run locally and once against production.

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    console.error('DATABASE_URL is required to seed ambient sounds.');
    process.exit(1);
}

const manifest = readAmbientManifest();
if (manifest.length === 0) {
    console.error('ambient-manifest.json is empty. Add ambient sound entries first.');
    process.exit(1);
}

function assertValid(entry: AmbientManifestEntry): void {
    const missing = (['id', 'label', 'category', 'storageKey'] as const).filter((key) => !entry[key]);
    if (missing.length > 0) {
        console.error(`Ambient entry "${entry.id ?? '(no id)'}" is missing required field(s): ${missing.join(', ')}.`);
        process.exit(1);
    }
}

manifest.forEach(assertValid);

const db = createDatabase(databaseUrl);

let sortIndex = 0;
for (const entry of manifest) {
    const values = {
        label: entry.label,
        category: entry.category,
        storageKey: entry.storageKey,
        gainPercent: entry.gainPercent ?? 100,
        sortIndex: entry.sortIndex ?? sortIndex,
        isActive: true,
    };
    await db
        .insert(ambientSounds)
        .values({ id: entry.id, ...values })
        .onConflictDoUpdate({
            target: ambientSounds.id,
            set: { ...values, updatedAt: new Date() },
        });
    console.log(`Seeded ${entry.id}`);
    sortIndex += 1;
}

// Upsert only — rows absent from the manifest stay untouched so a re-seed never
// deletes sounds added by other means. Retire sounds by flipping isActive by hand.
console.log(`Seeded ${manifest.length} ambient sound(s) into the ambient_sounds table.`);
