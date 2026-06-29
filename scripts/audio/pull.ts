import process from 'node:process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PUBLIC_AUDIO_DIR, readManifest, requireEnv } from './_shared';

// Download the catalog's files from the public R2 bucket into public/audio/ for local dev.
// The bucket is public, so no credentials are needed — this just fetches the known keys.

const base = requireEnv('R2_PUBLIC_BASE').replace(/\/+$/, '');
const manifest = readManifest();
if (manifest.length === 0) {
    console.error('manifest.json is empty. Nothing to pull.');
    process.exit(1);
}

mkdirSync(PUBLIC_AUDIO_DIR, { recursive: true });

let pulled = 0;
for (const entry of manifest) {
    const url = `${base}/${entry.storageKey}`;
    const response = await fetch(url);
    if (!response.ok) {
        console.warn(`! ${entry.storageKey}: HTTP ${response.status} from ${url}`);
        continue;
    }
    writeFileSync(path.join(PUBLIC_AUDIO_DIR, entry.storageKey), new Uint8Array(await response.arrayBuffer()));
    console.log(`Pulled ${entry.storageKey}`);
    pulled += 1;
}

console.log(`Pulled ${pulled}/${manifest.length} track(s) into public/audio/.`);
