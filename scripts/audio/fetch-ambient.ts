import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { AMBIENT_ORIGINALS_DIR, PUBLIC_AUDIO_DIR, readAmbientManifest } from './_shared';

// Download each ambient source recording (CC0/CC-BY masters, see ambient-manifest.json)
// into scripts/audio/originals/ambient/, then cut a loudness-normalized loop window into
// public/audio/<storageKey>. Loop-seam smoothing happens client-side (the mixer crossfades
// the buffer tail into its head), so no fades are baked in here.

const manifest = readAmbientManifest();
if (manifest.length === 0) {
    console.error('ambient-manifest.json is empty. Add ambient sound entries first.');
    process.exit(1);
}

mkdirSync(AMBIENT_ORIGINALS_DIR, { recursive: true });
mkdirSync(PUBLIC_AUDIO_DIR, { recursive: true });

function extensionFromUrl(url: string): string {
    const clean = new URL(url).pathname;
    const ext = path.extname(clean).toLowerCase();
    return ext || '.mp3';
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Wikimedia rate-limits bursts with 429s; honor Retry-After and back off politely.
async function download(url: string): Promise<Response | null> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'chillflow-audio-pipeline/1.0 (ambient catalog build)' },
        });
        if (response.status !== 429) return response;
        const retryAfter = Number(response.headers.get('retry-after')) || 30;
        console.log(`  Rate-limited (429), retrying in ${retryAfter}s...`);
        await sleep(retryAfter * 1000);
    }
    return null;
}

let prepared = 0;
for (const entry of manifest) {
    const original = path.join(AMBIENT_ORIGINALS_DIR, `${entry.id}${extensionFromUrl(entry.source.url)}`);

    if (!existsSync(original)) {
        console.log(`Downloading ${entry.id} from ${entry.source.url}`);
        const response = await download(entry.source.url);
        if (!response?.ok) {
            console.error(`! ${entry.id}: download failed with HTTP ${response?.status ?? 429}. Skipping.`);
            continue;
        }
        writeFileSync(original, new Uint8Array(await response.arrayBuffer()));
        // Space out requests so hosts don't read the batch as a scrape burst.
        await sleep(3000);
    }

    const output = path.join(PUBLIC_AUDIO_DIR, entry.storageKey);
    const trimStart = entry.trimStartSec ?? 2;
    const loopSec = entry.loopSec ?? 75;
    console.log(`Preparing ${entry.id} -> public/audio/${entry.storageKey} (${loopSec}s loop)`);
    execFileSync(
        'ffmpeg',
        [
            '-y',
            '-hide_banner',
            '-loglevel',
            'error',
            '-ss',
            String(trimStart),
            '-i',
            original,
            '-t',
            String(loopSec),
            // Quieter target than the music (-14): ambience sits under the track by default.
            '-af',
            'loudnorm=I=-16:TP=-1.5:LRA=11',
            '-c:a',
            'libmp3lame',
            '-b:a',
            '192k',
            output,
        ],
        { stdio: 'inherit' },
    );
    prepared += 1;
}

console.log(`Done. Prepared ${prepared}/${manifest.length} ambient loop(s) into public/audio/.`);
