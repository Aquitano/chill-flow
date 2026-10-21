# chill sync

A Cloudflare Worker that keeps chill's library, likes, scenes, mixes, focus sessions, and settings in step across machines. Each sync space is one SQLite-backed Durable Object holding opaque JSON records. There are no accounts: anyone can create a space, and the token for it is the only key.

## Protocol v1

All bodies are UTF-8 JSON. Errors are `{"error": "<sentence>"}` with the status code. Unknown routes answer 404.

- `POST /v1/spaces` returns `201 {"token": "<spaceId>.<signature>"}`.
- `POST /v1/sync` with `Authorization: Bearer <token>` and `{"cursor": 0, "changes": [Record]}` returns `200 {"cursor": n, "changes": [Record], "more": bool}`.
- `DELETE /v1/space` with the bearer token wipes the space and closes it for good, returning `204`. Every later sync with that token gets `410`, so a machine that still holds it learns the space is gone instead of filling it again.

A record is `{"kind", "id", "updatedAt", "deleted", "body"}`. `kind` is one of `like`, `saved`, `scene`, `mix`, `focus`, `setting`. `updatedAt` is milliseconds since the epoch. A deleted record keeps its key with `body: null`, and a record that isn't deleted must have a body other than `null`. A sync changes each `(kind, id)` at most once.

The server keeps the record with the greater `updatedAt` for each `(kind, id)`. On equal timestamps it keeps the one whose serialized body sorts later byte by byte, where a deleted record counts as `null`. Only the server decides ties: when a pushed record loses one, the response also carries the winner even if its `seq` is at or below the cursor, and a client takes an equal-time record from the server unless it has an unsent change of its own for that item. Every applied change gets the next `seq`. The response holds up to 1000 records with `seq` above the request cursor. A page also ends once its bodies pass about 4 MiB. When `more` is true, the client calls again with the returned cursor and no changes. A deleted space never reopens, so a `seq` is never reused.

[`fixtures/exchange.json`](fixtures/exchange.json) is a complete request and response. The tests and the Rust client both parse it, so it is the contract for field names and types.

## Cost safeguards

- A token is the space id plus an HMAC-SHA256 signature made with `SYNC_SECRET`. The Worker checks it before anything else, so a bad token never reaches a Durable Object.
- Creating a space only signs a token. The Durable Object first exists when that space syncs.
- Each request makes at most one RPC call to one Durable Object. There are no alarms, WebSockets, or outbound fetches.
- New spaces: 5 per minute per IP address (429), and `DAILY_NEW_SPACES` per UTC day across every address (503), counted in one small `Admission` Durable Object that only space creation touches. Since every space has its own limits below, this daily cap is what bounds how fast storage and writes can grow overall.
- Each space may write `DAILY_CHANGES_PER_SPACE` changes per UTC day, counted inside its Durable Object; past that a sync with changes gets 429 until the next day. Rows written are billed even when they don't grow the space, so this is the limit on writes. Pulling with no changes is not counted.
- 30 syncs per minute per space. Cloudflare counts this per location and only roughly, so it only filters bursts before they reach a Durable Object.
- Request bodies are capped at 2 MiB (413). A sync carries at most 2000 records, ids up to 200 characters, and bodies up to 256 KiB of JSON each (400).
- A space holds about 10 MiB. A sync that would go past that is rolled back whole and answered with 507.

## Privacy

A space holds what chill syncs, readable by whoever runs the Worker: likes and saved YouTube links with their titles, scene and mix names, focus blocks with their start times and lengths, and settings including added catalog links. It holds no names, email addresses, or IP addresses. The rate limiters see the client's IP address but keep only counters, and the Worker's logs keep its own error lines without request headers. "Delete sync data" in chill deletes everything a space holds.

## Development

The Worker is configured in `cloudflare.config.ts` and built and deployed with [`cf`](https://developers.cloudflare.com/cf/), which needs Node.js 22.18 or later.

```bash
bun install
bun run typecheck   # generates the binding types from cloudflare.config.ts, then runs tsc
bun run test        # vitest inside the Workers runtime
bun run dev         # local server; put SYNC_SECRET=... in .dev.vars first
```

## Deploy

On the Workers Free plan, going past a daily limit makes further calls fail until 00:00 UTC instead of adding to a bill, so the worst case is sync stopping for the day. On the Paid plan, set a billing notification in the dashboard as well.

The Worker answers only on `chill-sync.aquitano.me`, chill's default `sync_url`; `domains` in `cloudflare.config.ts` sets it, and the deploy creates the DNS record and certificate. The two rate limiters use namespaces 1001 and 1002, which must be unique within the Cloudflare account, so change them if they are taken.

Sign in with `cf auth login`, or set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for a token limited to editing Workers in this account and zone. The first deploy creates `SYNC_SECRET` along with the Worker. `cf` reads the secrets file only after building, so it has to be a real file rather than a `<(...)` pipe; this one is readable only by you and gone once the deploy ends:

```bash
cf deploy --dry-run
secrets=$(mktemp) && chmod 600 "$secrets" \
  && printf 'SYNC_SECRET=%s\n' "$(openssl rand -base64 32)" > "$secrets" \
  && cf deploy --secrets-file "$secrets"; rm -f "$secrets"
```

Later deploys are `cf deploy` and keep the secret. Changing `SYNC_SECRET` invalidates every token that exists, so pass `--secrets-file` again only to do that on purpose. `cf` can't stream logs yet; `bunx wrangler tail chill-sync` does.
