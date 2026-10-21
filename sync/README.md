# chill sync

A Cloudflare Worker that keeps chill's library, likes, scenes, mixes, focus sessions, and settings in step across machines. Each sync space is one SQLite-backed Durable Object holding opaque JSON records. There are no accounts: anyone can create a space, and the token for it is the only key.

## Protocol v1

All bodies are UTF-8 JSON. Errors are `{"error": "<sentence>"}` with the status code. Unknown routes answer 404.

- `POST /v1/spaces` returns `201 {"token": "<spaceId>.<signature>"}`.
- `POST /v1/sync` with `Authorization: Bearer <token>` and `{"cursor": 0, "changes": [Record]}` returns `200 {"cursor": n, "changes": [Record], "more": bool}`.
- `DELETE /v1/space` with the bearer token deletes everything in the space and returns `204`.

A record is `{"kind", "id", "updatedAt", "deleted", "body"}`. `kind` is one of `like`, `saved`, `scene`, `mix`, `focus`, `setting`. `updatedAt` is milliseconds since the epoch. A deleted record keeps its key with `body: null`.

The server keeps the record with the greater `updatedAt` for each `(kind, id)`. On equal timestamps it keeps the one whose serialized body sorts later byte by byte. Every applied change gets the next `seq`. The response holds up to 1000 records with `seq` above the request cursor. When `more` is true, the client calls again with the returned cursor and no changes. A cursor ahead of the server, which happens after the space was deleted, is treated as 0.

[`fixtures/exchange.json`](fixtures/exchange.json) is a complete request and response. The tests and the Rust client both parse it, so it is the contract for field names and types.

## Cost safeguards

- A token is the space id plus an HMAC-SHA256 signature made with `SYNC_SECRET`. The Worker checks it before anything else, so a bad token never reaches a Durable Object.
- Creating a space only signs a token. The Durable Object first exists when that space syncs.
- Each request makes at most one RPC call to one Durable Object. There are no alarms, WebSockets, or outbound fetches.
- Rate limits: 5 new spaces per minute per IP address, 30 syncs or deletes per minute per space. Over the limit gets 429.
- Request bodies are capped at 2 MiB (413). A sync carries at most 2000 records, ids up to 200 characters, and bodies up to 256 KiB of JSON each (400).
- A space holds about 10 MiB. A sync that would go past that is rolled back whole and answered with 507.

## Development

```bash
bun install
bun run typecheck   # regenerates the binding types, then runs tsc
bun run test        # vitest inside the Workers runtime
bun run dev         # local server; put SYNC_SECRET=... in .dev.vars first
```

## Deploy

The two rate limiters in `wrangler.jsonc` use `namespace_id` 1001 and 1002. These ids must be unique within the Cloudflare account, so change them if they are taken.

```bash
openssl rand -base64 32 | bunx wrangler secret put SYNC_SECRET
bunx wrangler deploy
```

Changing `SYNC_SECRET` later invalidates every token that exists. To serve the Worker on your own hostname, add a custom domain route to `wrangler.jsonc`, for example `"routes": [{ "pattern": "sync.example.com", "custom_domain": true }]`, and deploy again.
