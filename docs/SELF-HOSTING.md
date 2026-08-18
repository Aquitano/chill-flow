# Self-hosting runbook (VPS + Cloudflare)

An alternative to [DEPLOYMENT.md](DEPLOYMENT.md): the Next.js server runs as a container on
your own VPS, and everything Cloudflare can do for free sits in front of it. `proxy.ts` runs
on its native Node runtime with no adapter in the way, there is no request-body or execution
limit, and the monthly cost is a fixed VPS bill rather than metered usage. The trade is that
uptime, patching, and backups become yours.

## Architecture

| Concern             | Where                       | Notes                                                                  |
| ------------------- | --------------------------- | ---------------------------------------------------------------------- |
| App                 | Docker container on the VPS | `node server.js` from Next's standalone output                         |
| Ingress             | Cloudflare Tunnel           | No inbound ports open; the container binds to loopback only            |
| DNS, TLS, CDN, DDoS | Cloudflare (proxied record) | Free plan                                                              |
| Audio + cover files | Cloudflare R2               | Unchanged from the Vercel path                                         |
| Database            | Neon                        | Unchanged; the `neon-http` driver works fine from a long-lived process |
| Auth                | Clerk                       | Production instance keys                                               |
| Errors (optional)   | Sentry                      | Enabled only when a DSN is set                                         |

A 2 vCPU / 4 GB box is the sensible floor. Build the image in CI rather than on the VPS —
Next builds are memory-hungry and will fight the running container for RAM.

## Prerequisites

- A VPS with Docker Engine and the Compose plugin.
- A Cloudflare account with the app's domain onboarded, plus the R2 bucket from
  [DEPLOYMENT.md](DEPLOYMENT.md#2-audio-storage-cloudflare-r2).
- Neon and Clerk set up per steps 1 and 3 of [DEPLOYMENT.md](DEPLOYMENT.md).
- GitHub Actions enabled if you want push-to-deploy images.

---

## 1. Build the image

`NEXT_PUBLIC_*` values are inlined into the client bundle at build time, so they are **build
args**, not runtime env. Changing one needs a rebuild, not a restart. The build also fails
outright without `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, since the landing page is prerendered
through `<ClerkProvider>`.

### In CI (recommended)

`.github/workflows/docker-image.yml` builds on every push to `main` and publishes to
`ghcr.io/<owner>/chill-flow`. Configure the repository first:

| Setting                             | Kind     | Value                                       |
| ----------------------------------- | -------- | ------------------------------------------- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | variable | Clerk production publishable key            |
| `NEXT_PUBLIC_APP_URL`               | variable | `https://<your-domain>`                     |
| `NEXT_PUBLIC_SENTRY_DSN`            | variable | Optional; omit to disable Sentry            |
| `SENTRY_AUTH_TOKEN`                 | secret   | Optional; only needed for source-map upload |

The publishable key is a public value by design — a repository variable is the right home for
it, and it has to be readable at build time anyway.

### Locally

```bash
docker compose build          # reads the same NEXT_PUBLIC_* names from your .env
```

## 2. Configure the VPS

Copy `.env.example` to `.env` next to `docker-compose.yml` and fill in the runtime variables
from [DEPLOYMENT.md](DEPLOYMENT.md#5-deploy-to-vercel) — the same list applies, with
`AUDIO_BASE_URL` pointing at the R2 public base and `ALLOWED_CORS_ORIGINS` plus
`NEXT_PUBLIC_APP_URL` set to your production origin. `NEXT_PUBLIC_APP_URL` is required here:
the `VERCEL_URL` fallback in `src/lib/client.ts` does not exist off Vercel.

Keep the file at `chmod 600` and owned by the deploying user. It holds `DATABASE_URL`,
`CLERK_SECRET_KEY`, and `R2_SECRET_ACCESS_KEY`.

## 3. Cloudflare Tunnel

Zero Trust → Networks → Tunnels → create a tunnel, then add a public hostname routing your
domain to `http://app:3000` (the compose service name). Put the tunnel token in `.env` as
`CLOUDFLARE_TUNNEL_TOKEN` and start both containers:

```bash
docker compose --profile tunnel up -d
```

The app publishes only to `127.0.0.1:3000`, so the tunnel is the sole path in — no firewall
rules, no public IP exposure, and TLS terminates at Cloudflare.

Two optional hardening steps worth taking:

- **Cache rule** for `/_next/static/*` — those filenames are content-hashed and immutable, so
  an edge cache TTL of a year is safe and takes the asset load off the box entirely.
- **Cloudflare Access** in front of `/admin` — free up to 50 users, and it gates the route
  before a request ever reaches the app. The in-app admin check
  (`src/server/security/admin.ts`) still applies underneath.

## 4. Apply migrations

Run these from your workstation or CI against the production database, never from the
container entrypoint — two replicas racing the same migration is a bad failure mode.

```bash
DATABASE_URL='postgres://...neon.tech/...' bun run db:migrate
```

The ordering rule from [DEPLOYMENT.md](DEPLOYMENT.md#1-database-neon) still holds: additive
migrations ship before the deploy that uses them, column drops ship after the deploy that
stopped reading them.

## 5. Deploy and update

The first workflow run publishes the GHCR package as **private** even when the repository is
public — package visibility is a separate setting, and Compose does not authenticate on its
own, so `docker compose pull` on a fresh VPS fails with `denied` until you do one of:

- flip the package to public under Packages → chill-flow → Package settings → Change
  visibility, or
- log the VPS in once with a token carrying the `read:packages` scope:

    ```bash
    echo "$GHCR_TOKEN" | docker login ghcr.io -u <github-username> --password-stdin
    ```

Then, for every release:

```bash
docker compose pull && docker compose up -d
```

Expect a few seconds of downtime. `app` holds a fixed `127.0.0.1:3000` binding, so Compose
stops and removes the old container before the replacement can claim the port, and the tunnel
returns errors until the new process listens. Compose does not gate that swap on the
healthcheck — the `service_healthy` condition only decides when `cloudflared` starts. A
zero-downtime swap would need two app services behind a local reverse proxy; for a
single-box deploy the outage is not worth that.

Confirm the rollout landed:

```bash
docker compose ps    # app turns healthy at the first check, one interval in
```

To roll back, pin `image:` to a previous `sha-` tag and repeat.

## 6. Post-deploy smoke test

Run the [full checklist](DEPLOYMENT.md#6-post-deploy-smoke-test), plus the parts specific to
this setup:

- [ ] `curl -fsS https://<your-domain>/api/health` returns `{"status":"ok"}`.
- [ ] `docker compose ps` shows the app as `healthy`.
- [ ] `/admin` upload of a real track succeeds end to end: presigned PUT to R2, then the new
      track appears in the catalog and plays.
- [ ] The VPS is not reachable directly: a request to `http://<vps-ip>:3000` times out.

## Operations

- **Backups** — Neon keeps automatic backups with point-in-time restore. If you later move
  Postgres onto the VPS, a `pg_dump` cron writing off-box becomes mandatory, not optional.
- **Uptime** — point a Cloudflare health check or an external monitor at `/api/health`.
- **Housekeeping** — `docker image prune -f` on a cron; old image layers add up fast.
- **Updates** — unattended-upgrades for the OS, and watch for Docker Engine releases.

## Pre-deploy verification

```bash
bun run lint && bun run test && bun run build
```
