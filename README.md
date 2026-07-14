# ChillFlow

ChillFlow is a focus workspace that pairs lo-fi music and ambient sound with a task list and a focus timer. Start a session, mix your soundscape, work through your tasks, and see your focused time add up.

## Features

- **Lo-fi tracks** served from a database-backed catalog, with liked tracks and per-account selection
- **Ambient mixer** — layer rain, cafe, and other loops over the music and save named mixes
- **Focus and Pomodoro timers** — presets, custom durations, open-ended focus, and configurable Pomodoro cadence
- **Progress stats** — focused minutes, completed sessions, full Pomodoro cycles, and a day streak
- **Tasks** with priorities and natural-language due dates
- **Persistent preferences** — mode, scene, track, volume, and timer defaults follow your account
- **Admin importer** — upload and manage tracks at `/admin` (writes to R2 in production)

## Tech stack

- Next.js (App Router) with TypeScript and Tailwind CSS
- JStack/Hono API routes
- Drizzle ORM on Postgres (Neon in production)
- Clerk authentication
- Cloudflare R2 for audio and cover files
- Sentry error monitoring (optional, enabled by DSN)

## Getting started

Prerequisites: [bun](https://bun.sh), a Postgres database (a free Neon project works), and a Clerk application.

1. Clone and install:

    ```bash
    git clone https://github.com/aquitano/chill-flow.git
    cd chill-flow
    bun install
    ```

2. Configure the environment:

    ```bash
    cp .env.example .env
    ```

    Required for the workspace: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `DATABASE_URL`, and `AUDIO_BASE_URL` (keep the default `/audio` to serve audio from `public/audio/` in dev). The R2 and Sentry variables are optional locally — see the comments in `.env.example`.

3. Apply the database schema:

    ```bash
    bun run db:migrate
    ```

4. Add audio. Tracks are read from the database at runtime; the audio binaries are not in git. Pull the published files from the public bucket and seed the catalog metadata:

    ```bash
    bun run audio:pull
    bun run db:seed:tracks
    bun run db:seed:ambient
    ```

    `scripts/audio/README.md` documents the full pipeline (normalizing new masters, uploading to R2). Alternatively, sign in, grant your Clerk user `{ "role": "admin" }` (public metadata), and import tracks from `/admin`.

5. Start the dev server and open [http://localhost:3000](http://localhost:3000):

    ```bash
    bun run dev
    ```

## Verification

```bash
bun run lint && bun run test && bun run build
```

## Deployment

The production setup (Vercel, Neon, Cloudflare R2, Clerk) is documented step by step in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
