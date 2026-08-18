# Deployment runbook

ChillFlow deploys as a Next.js app on **Vercel**, backed by **managed Postgres (Neon)**,
**Cloudflare R2** for audio, and **Clerk** for auth. This runbook takes a fresh clone to a
live deployment.

## Architecture

| Concern | Service | Notes |
| --- | --- | --- |
| App hosting | Vercel | Next.js App Router, Node serverless functions |
| Database | Neon (managed Postgres) | Works with the bundled `@neondatabase/serverless` HTTP driver |
| Audio + cover files | Cloudflare R2 | Public bucket; runtime admin uploads use the R2 S3 API |
| Auth | Clerk | Production instance keys |
| Errors (optional) | Sentry | Enabled only when a DSN is set |

## Prerequisites

- A Vercel account with this repo connected.
- A Neon project (free tier is fine).
- A Cloudflare account with R2 enabled.
- A Clerk application (production instance).
- Local tools for the one-time catalog publish: `bun`, `ffmpeg`/`ffprobe`. (Upload and CORS use the R2 S3 token — no `wrangler login` needed.)

---

## 1. Database (Neon)

1. Create a Neon project and copy its pooled connection string → this is `DATABASE_URL`.
2. Apply migrations against it from your machine:
   ```bash
   # bash
   DATABASE_URL='postgres://...neon.tech/...' bun run db:migrate
   ```
   ```powershell
   # PowerShell
   $env:DATABASE_URL='postgres://...neon.tech/...'; bun run db:migrate
   ```
3. A migration that **drops** a column runs after the deploy that stops reading it, never
   before — the previous release is still serving traffic and selects every column it knows
   about. Additive migrations go first, as usual.

## 2. Audio storage (Cloudflare R2)

1. Create a bucket (e.g. `chillflow-audio`).
2. **Enable public access** — either the managed `r2.dev` URL (quick start) or a custom
   domain (recommended for production). Use this base URL as `AUDIO_BASE_URL` (runtime), and
   as `R2_PUBLIC_BASE` if you download published files with `bun run audio:pull`.
3. **Create an S3 API token** (R2 → Manage R2 API Tokens → Object Read & Write). This gives
   `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`; `R2_ACCOUNT_ID` is in the R2 endpoint
   (`https://<account_id>.r2.cloudflarestorage.com`). Put these (and `R2_BUCKET`) in `.env` —
   they power both the catalog publish and runtime admin uploads. If the bucket lives in a
   jurisdiction (e.g. EU), also set `R2_JURISDICTION` (e.g. `eu`) so the S3 endpoint is
   region-prefixed; leave it unset for the default jurisdiction.
4. **Set the CORS policy** (mandatory — the audio engine uses `crossOrigin="anonymous"` +
   Web Audio, which fails silently without it). Edit the origins in `scripts/audio/cors.json`
   to your production domain, then apply via the S3 API:
   ```bash
   bun run audio:cors
   ```

## 3. Auth (Clerk)

1. In the Clerk dashboard, use the **production instance** publishable + secret keys.
2. After your first sign-in (step 6), grant yourself admin: Clerk → Users → your user →
   Metadata → Public → `{ "role": "admin" }`.
3. Clerk → Webhooks → add an endpoint at `https://<your-domain>/api/webhooks/clerk`
   subscribed to **`user.deleted`**, and copy its signing secret into
   `CLERK_WEBHOOK_SIGNING_SECRET`. Clerk owns identity, so this event is the only signal
   that a deleted account's tasks, sessions, and preferences should be erased with it.

## 4. Publish the initial catalog

From your machine, with masters in `scripts/audio/originals/` and entries in
`scripts/audio/manifest.json`:

```bash
bun run audio:normalize          # loudnorm -> public/audio/
bun run audio:build              # ffprobe durations into the manifest
bun run audio:upload             # push to R2 (S3 API; reads R2_* from .env)
DATABASE_URL='<prod>' bun run db:seed:tracks     # seed the prod tracks table
```

(After deploy, admins can also import/replace tracks from `/admin`, which writes to R2
directly when the `R2_*` runtime vars are set.)

## 5. Deploy to Vercel

Import the repo and set the environment variables below, then deploy.

| Variable | Required | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | yes | Clerk production publishable key |
| `CLERK_SECRET_KEY` | yes | Clerk production secret key |
| `CLERK_WEBHOOK_SIGNING_SECRET` | yes | Signing secret of the `/api/webhooks/clerk` endpoint |
| `DATABASE_URL` | yes | Neon connection string (server-only) |
| `AUDIO_BASE_URL` | yes | R2 public base URL (e.g. `https://cdn.chillflow.app`) |
| `ALLOWED_CORS_ORIGINS` | yes | Your production origin(s), comma-separated |
| `NEXT_PUBLIC_APP_URL` | recommended | Production origin (else inferred from `VERCEL_URL`) |
| `R2_ACCOUNT_ID` | for admin upload | R2 account id |
| `R2_ACCESS_KEY_ID` | for admin upload | R2 S3 access key id |
| `R2_SECRET_ACCESS_KEY` | for admin upload | R2 S3 secret (server-only) |
| `R2_BUCKET` | for admin upload | Bucket name |
| `R2_JURISDICTION` | optional | Bucket jurisdiction (e.g. `eu`); unset for default |
| `NEXT_PUBLIC_SENTRY_DSN` | optional | Enables Sentry when set |

`DATABASE_URL` and `R2_SECRET_ACCESS_KEY` must stay server-only — never expose them through
`NEXT_PUBLIC_*`, client bundles, rendered output, or logs.

### Custom domain via Cloudflare DNS

1. Vercel → Project → Settings → Domains → add your domain. Vercel shows the exact record to
   create (a CNAME to `cname.vercel-dns.com`; Cloudflare flattens it automatically at the apex).
2. Create that record in Cloudflare DNS and set it to **DNS only (grey cloud)**. Vercel is
   already a CDN and terminates TLS itself; proxying through Cloudflare stacks a second proxy
   on top, can block Vercel's certificate issuance, and in `Flexible` SSL mode causes an
   infinite redirect loop. Proxy (orange cloud) only if you specifically want Cloudflare WAF
   or Access in front — and then SSL/TLS mode must be **Full (strict)**.
3. Once the domain is live, sweep it through everything that names the origin:
   `ALLOWED_CORS_ORIGINS` and `NEXT_PUBLIC_APP_URL` on Vercel, the origins in
   `scripts/audio/cors.json` followed by `bun run audio:cors`, and the Clerk production
   instance domain plus the webhook URL from step 3.

## 6. Post-deploy smoke test

- [ ] App loads at the production URL; landing page renders.
- [ ] Sign up / sign in works (Clerk production instance).
- [ ] `/app` loads; a seeded track plays — Network shows `206` for the audio URL with an
      `access-control-allow-origin` header (R2 CORS working).
- [ ] Create / complete / delete a task; start and complete a focus session (stats update).
- [ ] `/admin` (as an admin) lists tracks; import a track and confirm it plays.
- [ ] Reload after sign-out/in — preferences persist.
- [ ] Send a test `user.deleted` delivery from Clerk → Webhooks; the endpoint answers `204`
      and that user's rows are gone from `tasks`, `focus_sessions`, `user_preferences`,
      `ambient_mixes`, and `saved_presets`.

## Backups

Neon keeps automatic backups with point-in-time restore. For an additional manual snapshot:

```bash
pg_dump "$DATABASE_URL" > chillflow-backup.sql       # back up
psql "$DATABASE_URL" < chillflow-backup.sql           # restore
```

Run a backup before each migration deploy and verify a restore at least once.

## Observability

Set `NEXT_PUBLIC_SENTRY_DSN` to enable Sentry; leave it unset to disable it (the app starts
fine either way). Confirm a test error appears in Sentry after the first deploy.

## Pre-deploy verification

```bash
bun run lint && bun run test && bun run build
```

All three must pass before promoting a deploy. `bun run build` needs
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in the environment (the landing page prerenders through
`<ClerkProvider>`); without a `.env`, prefix the command with any well-formed key.
