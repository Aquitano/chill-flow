# Audio pipeline

ChillFlow stores MP3s in **Cloudflare R2**. At runtime the **`tracks` DB table is the
source of truth**, and the app resolves each track's `storageKey` against `AUDIO_BASE_URL`
to produce a playable URL. The checked-in `manifest.json` describes tracks published
through this script pipeline; tracks imported through `/admin` can exist only in the database.

- **Dev** serves audio same-origin from `public/audio/` (`AUDIO_BASE_URL=/audio`) — no CORS, offline, free.
- **Prod** serves from the public R2 bucket (`AUDIO_BASE_URL=https://pub-….r2.dev`) — CORS required.

`public/audio/`, `scripts/audio/originals/`, and `scripts/audio/out/` are gitignored. The
manifest is the only checked-in record; the binaries live in R2.

## Prerequisites

- `ffmpeg` and `ffprobe` on PATH.
- An R2 bucket with public access enabled and an S3 API token. Upload and CORS use the S3
  API (no `wrangler login` needed). Set these in `.env` (see `.env.example`):
  - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` — S3 credentials.
  - `R2_PUBLIC_BASE` — public bucket base URL (e.g. `https://pub-xxxx.r2.dev`), used by `audio:pull`.
  - `DATABASE_URL` — to seed the catalog.

## Publish a catalog (first time / when tracks change)

1. Drop WAV, FLAC, MP3, or other master files in `scripts/audio/originals/`. The source
   filename stem becomes the storage key and the normalizer always emits an MP3
   (for example, `deep-focus-01.wav` becomes `deep-focus-01.mp3`).
2. Normalize loudness and emit MP3s to `public/audio/`:
   ```bash
   bun run audio:normalize
   ```
3. Add one entry per track to `manifest.json` (omit `durationSec`, it is filled next):
   ```json
   [
     {
       "id": "deep-focus-01",
       "storageKey": "deep-focus-01.mp3",
       "title": "Deep Focus Loop",
       "artist": "ChillFlow Radio",
       "category": "focus",
       "tags": ["focus", "instrumental"],
       "durationSec": 0
     }
   ]
   ```
4. Fill durations from the normalized files (`ffprobe`):
   ```bash
   bun run audio:build
   ```
5. Upload to R2 (immutable cache, `audio/mpeg`):
   ```bash
   bun run audio:upload
   ```
6. Seed the `tracks` table (idempotent upsert by id):
   ```bash
   bun run db:seed:tracks
   ```

To re-encode a track, bump its `storageKey` (e.g. `deep-focus-01-v2.mp3`) so the immutable
cache never serves a stale file, then re-run steps 2–6.

## Local dev on a fresh clone

The binaries are not in git. Pull them from the public bucket (no credentials needed):

```bash
bun run audio:pull
```

Then `bun run dev` with `AUDIO_BASE_URL=/audio` serves them same-origin.

## R2 setup notes

- **Public access**: enable the bucket's public `r2.dev` URL (or attach a custom domain) and
  use it as `R2_PUBLIC_BASE` / production `AUDIO_BASE_URL`.
- **CORS is mandatory**: the audio engine uses `crossOrigin="anonymous"` and Web Audio, so a
  cross-origin host must return CORS headers or playback fails silently. Edit the origins in
  `cors.json`, then apply it via the S3 API:
  ```bash
  bun run audio:cors
  ```
- **Range requests** work on R2 natively — no configuration needed.
- Verify in DevTools: the audio request returns `206 Partial Content` with an
  `access-control-allow-origin` header.
