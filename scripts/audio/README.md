# Audio pipeline

The ChillFlow catalog is a set of MP3s stored in **Cloudflare R2** and described by the
checked-in `manifest.json`. At runtime the **`tracks` DB table is the source of truth**
(seeded from the manifest); the app resolves each track's `storageKey` against
`AUDIO_BASE_URL` to a playable URL.

- **Dev** serves audio same-origin from `public/audio/` (`AUDIO_BASE_URL=/audio`) — no CORS, offline, free.
- **Prod** serves from the public R2 bucket (`AUDIO_BASE_URL=https://pub-….r2.dev`) — CORS required.

`public/audio/`, `scripts/audio/originals/`, and `scripts/audio/out/` are gitignored. The
manifest is the only checked-in record; the binaries live in R2.

## Prerequisites

- `ffmpeg` and `ffprobe` on PATH.
- `wrangler` (installed locally) authenticated: `bunx wrangler login`.
- An R2 bucket with public access enabled, and these env vars (see `.env.example`):
  - `R2_BUCKET` — bucket name (e.g. `chillflow-audio`).
  - `R2_PUBLIC_BASE` — public bucket base URL (e.g. `https://pub-xxxx.r2.dev`).
  - `DATABASE_URL` — to seed the catalog.

## Publish a catalog (first time / when tracks change)

1. Drop your master files in `scripts/audio/originals/`, named as the storage key you want
   (e.g. `deep-focus-01.mp3`). Masters can be WAV/FLAC/MP3/etc.
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
  cross-origin host must return CORS headers or playback fails silently. Apply `cors.json`
  (edit the origins first) via the R2 dashboard, or wrangler:
  ```bash
  bunx wrangler r2 bucket cors put $R2_BUCKET --file scripts/audio/cors.json
  ```
- **Range requests** work on R2 natively — no configuration needed.
- Verify in DevTools: the audio request returns `206 Partial Content` with an
  `access-control-allow-origin` header.
