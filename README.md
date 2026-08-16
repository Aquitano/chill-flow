# ChillFlow

ChillFlow is a focus workspace that pairs lo-fi music and ambient sound with a task list and a focus timer. Start a session, mix a soundscape, work through tasks, and track focused time.

## Features

- **Lo-fi tracks** served from a database-backed catalog, with liked tracks and per-account selection. Switching track crossfades rather than cutting
- **Ambient mixer** for layering sound loops over music and saving named mixes
- **Focus and Pomodoro timers** with presets, custom durations, open-ended focus that counts up, and a configurable Pomodoro cadence including whether breaks and focus blocks start themselves. The countdown runs off a wall-clock deadline, so it keeps time in a background tab, and its position survives a reload
- **Focus a task** to aim a block at one item; the session records it and the block ends by offering to check it off
- **Progress stats** for focused minutes, completed sessions, full Pomodoro cycles, and day streaks
- **Tasks** with priorities and natural-language due dates, each showing the focus time banked against it
- **Persistent preferences** for workspace mode, background, track, volume, timer defaults, and timer alerts (chime and browser notification)
- **Data export** from `/account` — the whole account as JSON, or focus sessions as CSV
- **Admin importer** for uploading and managing tracks at `/admin`

## Tech stack

- Next.js App Router with TypeScript and Tailwind CSS
- JStack and Hono API routes
- Drizzle ORM on Postgres (Neon in production)
- Clerk authentication
- Cloudflare R2 for audio and cover files
- Optional Sentry error monitoring

## Getting started

Prerequisites: [Bun](https://bun.sh), Node.js 24 or newer, a Postgres database, and a Clerk application.

1. Clone and install dependencies:

    ```bash
    git clone https://github.com/aquitano/chill-flow.git
    cd chill-flow
    bun install
    ```

2. Configure the environment:

    ```bash
    cp .env.example .env
    ```

    The workspace requires `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `DATABASE_URL`. Keep the default `AUDIO_BASE_URL=/audio` to serve audio from `public/audio/` during local development. R2 and Sentry are optional locally; `.env.example` documents every runtime variable.

3. Apply the database schema:

    ```bash
    bun run db:migrate
    ```

4. Add audio. Tracks and ambient sounds are read from the database, while audio binaries are excluded from git. Pull the published files and seed their metadata:

    ```bash
    bun run audio:pull
    bun run db:seed:tracks
    bun run db:seed:ambient
    ```

    [scripts/audio/README.md](scripts/audio/README.md) documents the full publishing pipeline. Alternatively, grant a Clerk user `{ "role": "admin" }` in public metadata and import tracks from `/admin`.

5. Start the development server and open [http://localhost:3000](http://localhost:3000):

    ```bash
    bun run dev
    ```

## Verification

```bash
bun run lint
bun run test
bun run build
```

## Deployment

The Vercel, Neon, Cloudflare R2, and Clerk production setup is documented in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
