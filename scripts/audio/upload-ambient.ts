import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { appEnv } from '../../src/lib/env';
import { getAudioStorage } from '../../src/server/storage/audio-storage';
import { PUBLIC_AUDIO_DIR, readAmbientManifest } from './_shared';

// Upload each prepared ambient loop to R2 (same flow as audio:upload for tracks).

if (!appEnv.isR2Configured) {
    console.error(
        'R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET in .env.',
    );
    process.exit(1);
}

const manifest = readAmbientManifest();
if (manifest.length === 0) {
    console.error('ambient-manifest.json is empty. Nothing to upload.');
    process.exit(1);
}

const storage = getAudioStorage();

let uploaded = 0;
for (const entry of manifest) {
    const file = path.join(PUBLIC_AUDIO_DIR, entry.storageKey);
    if (!existsSync(file)) {
        console.warn(`! ${entry.storageKey} missing in public/audio/ — run ambient:fetch first. Skipping.`);
        continue;
    }
    await storage.put(entry.storageKey, new Uint8Array(readFileSync(file)));
    console.log(`Uploaded ${entry.storageKey}`);
    uploaded += 1;
}

console.log(`Uploaded ${uploaded}/${manifest.length} ambient loop(s) to R2.`);
