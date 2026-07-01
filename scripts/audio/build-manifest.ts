import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { PUBLIC_AUDIO_DIR, readManifest, writeManifest } from './_shared';

// Fill durationSec on each manifest entry by probing the normalized file in public/audio/,
// so durations are never hand-entered. Run after audio:normalize (or audio:pull).

const manifest = readManifest();
if (manifest.length === 0) {
    console.error('manifest.json is empty. Add track entries first (see scripts/audio/README.md).');
    process.exit(1);
}

let updated = 0;
for (const entry of manifest) {
    if (!entry.storageKey) {
        console.error(`! Entry "${entry.id ?? '(no id)'}" is missing "storageKey" (the file name in public/audio/). Skipping.`);
        continue;
    }

    const file = path.join(PUBLIC_AUDIO_DIR, entry.storageKey);
    if (!existsSync(file)) {
        console.warn(`! ${entry.storageKey} not in public/audio/ — run audio:normalize or audio:pull first. Skipping.`);
        continue;
    }

    const probed = execFileSync('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        file,
    ]).toString();
    const seconds = Math.round(Number(probed.trim()));
    if (Number.isFinite(seconds) && seconds > 0) {
        entry.durationSec = seconds;
        updated += 1;
        console.log(`${entry.storageKey}: ${seconds}s`);
    } else {
        console.warn(`! Could not read a valid duration for ${entry.storageKey}.`);
    }
}

writeManifest(manifest);
console.log(`Updated durations for ${updated}/${manifest.length} track(s).`);
