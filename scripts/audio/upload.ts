import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PUBLIC_AUDIO_DIR, ROOT, readManifest, requireEnv } from './_shared';

// Upload each normalized MP3 to the R2 bucket under its storage key, with an immutable
// long-cache header and the correct content type. Re-encoding a track means bumping its
// storage key (e.g. -v2) so the immutable cache is never stale.

const bucket = requireEnv('R2_BUCKET');
const manifest = readManifest();
if (manifest.length === 0) {
    console.error('manifest.json is empty. Nothing to upload.');
    process.exit(1);
}

const wrangler = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'wrangler.exe' : 'wrangler');
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

let uploaded = 0;
for (const entry of manifest) {
    const file = path.join(PUBLIC_AUDIO_DIR, entry.storageKey);
    if (!existsSync(file)) {
        console.warn(`! ${entry.storageKey} missing in public/audio/ — run audio:normalize first. Skipping.`);
        continue;
    }
    console.log(`Uploading ${entry.storageKey} -> r2://${bucket}/${entry.storageKey}`);
    execFileSync(
        wrangler,
        [
            'r2', 'object', 'put', `${bucket}/${entry.storageKey}`,
            '--file', file,
            '--content-type', 'audio/mpeg',
            '--cache-control', CACHE_CONTROL,
        ],
        { stdio: 'inherit' },
    );
    uploaded += 1;
}

console.log(`Uploaded ${uploaded}/${manifest.length} track(s). Ensure the bucket is public and CORS is set (see README).`);
