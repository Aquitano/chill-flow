import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ORIGINALS_DIR, PUBLIC_AUDIO_DIR } from './_shared';

// Loudness-normalize every master in scripts/audio/originals/ to a consistent target and
// write MP3s into public/audio/. Output keeps the input basename, so a master named
// `deep-focus-01.mp3` becomes the storage key `deep-focus-01.mp3`.

const SUPPORTED = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus']);

if (!existsSync(ORIGINALS_DIR)) {
    console.error(`No originals at ${ORIGINALS_DIR}. Drop your master files there (named like deep-focus-01.mp3).`);
    process.exit(1);
}

mkdirSync(PUBLIC_AUDIO_DIR, { recursive: true });

const inputs = readdirSync(ORIGINALS_DIR).filter((file) => SUPPORTED.has(path.extname(file).toLowerCase()));
if (inputs.length === 0) {
    console.error(`No audio files found in ${ORIGINALS_DIR}.`);
    process.exit(1);
}

for (const file of inputs) {
    const input = path.join(ORIGINALS_DIR, file);
    const outName = `${path.basename(file, path.extname(file))}.mp3`;
    const output = path.join(PUBLIC_AUDIO_DIR, outName);
    console.log(`Normalizing ${file} -> public/audio/${outName}`);
    execFileSync(
        'ffmpeg',
        [
            '-y', '-hide_banner', '-loglevel', 'error',
            '-i', input,
            '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11',
            '-c:a', 'libmp3lame', '-b:a', '192k',
            output,
        ],
        { stdio: 'inherit' },
    );
}

console.log(`Done. Normalized ${inputs.length} file(s) into public/audio/.`);
