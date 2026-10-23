import { exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import exchange from "../fixtures/exchange.json";
import { limits } from "../src/protocol";
import { like, newToken, send, sync } from "./client";

type SyncResponse = {
  cursor: number;
  changes: { kind: string; id: string; updatedAt: number; deleted: boolean; body: unknown }[];
  more: boolean;
};

async function pull(token: string, cursor = 0) {
  const response = await sync(token, { cursor, changes: [] });
  expect(response.status).toBe(200);
  return response.json<SyncResponse>();
}

it("answers the fixture exchange exactly as documented", async () => {
  const response = await sync(await newToken(), exchange.request);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(exchange.response);
});

it("keeps the newest write per record, with tombstones and a body tie-break", async () => {
  const token = await newToken();
  await sync(token, { cursor: 0, changes: [like("a", 100, { v: 1 }), like("b", 100, { v: 1 })] });

  const later = [
    like("a", 50, { v: 9 }),
    like("a", 100, { v: 2 }),
    like("a", 100, { v: 0 }),
    { kind: "like", id: "b", updatedAt: 200, deleted: true, body: null },
    like("b", 150, { v: 3 }),
  ];
  for (const change of later) {
    expect((await sync(token, { cursor: 0, changes: [change] })).status).toBe(200);
  }

  const { changes, cursor } = await pull(token);
  expect(changes).toEqual([
    like("a", 100, { v: 2 }),
    { kind: "like", id: "b", updatedAt: 200, deleted: true, body: null },
  ]);
  expect(cursor).toBe(4);
});

it("sends the winner back to a client whose change lost a tie, even below its cursor", async () => {
  const token = await newToken();
  const { cursor } = await sync(token, { cursor: 0, changes: [like("a", 100, { v: 2 })] }).then((response) =>
    response.json<SyncResponse>(),
  );

  const lost = await sync(token, { cursor, changes: [like("a", 100, { v: 0 })] });

  expect(await lost.json()).toEqual({ cursor, changes: [like("a", 100, { v: 2 })], more: false });
});

it("returns every tie winner when they exceed the page budgets and still advances the cursor", async () => {
  const token = await newToken();
  const chime = { kind: "setting", id: "chime", updatedAt: 100, deleted: false, body: true };
  const mixes = Array.from({ length: limits.changesPerRequest - 23 }, (_, index) => ({
    kind: "mix", id: `mix-${index}`, updatedAt: 100, deleted: false, body: { rain: 50 },
  }));
  const playlists = Array.from({ length: 42 }, (_, index) => ({
    kind: "saved", id: `ytpl:${index}`, updatedAt: 100, deleted: false,
    body: {
      id: `ytpl:${index}`, url: `https://youtube.com/playlist?list=${index}`,
      title: "é".repeat(100 * 1024), channel: "", items: [],
    },
  }));
  expect((await sync(token, { cursor: 0, changes: [chime, ...mixes] })).status).toBe(200);
  for (let offset = 0; offset < playlists.length; offset += 7) {
    const changes = playlists.slice(offset, offset + 7);
    expect((await sync(token, { cursor: mixes.length + 1 + offset, changes })).status).toBe(200);
  }

  const cursor = mixes.length + 22;
  const winners = [chime, ...mixes, ...playlists.slice(0, 21), playlists.at(-1)!];
  const forward = playlists.slice(21);
  const changes = winners.map((record) => ({
    ...record, deleted: record.kind !== "setting", body: record.kind === "setting" ? false : null,
  }));
  const response = await sync(token, { cursor, changes });
  expect(response.status).toBe(200);
  const first = await response.json<SyncResponse>();
  expect(first.changes[0]).toEqual(chime);
  expect(first.changes).toHaveLength(winners.length + 1);
  expect(first.changes.slice(0, winners.length)).toEqual(winners);
  expect(first.changes.slice(winners.length)).toEqual(forward.slice(0, 1));
  expect(first).toMatchObject({ cursor: cursor + 1, more: true });
  const bytes = new TextEncoder().encode(JSON.stringify(first)).byteLength;
  expect(bytes).toBeGreaterThan(limits.pageBytes);
  expect(bytes).toBeLessThan(16 * 1024 * 1024);

  const received = first.changes.slice(winners.length);
  let page = first;
  for (let pages = 0; page.more; pages++) {
    expect(pages).toBeLessThan(forward.length);
    const next = await pull(token, page.cursor);
    expect(next.cursor).toBeGreaterThan(page.cursor);
    received.push(...next.changes);
    page = next;
  }
  expect(received).toEqual(forward);
  expect(page.cursor).toBe(cursor + forward.length);
});

it("pages through changes in seq order and reports when more remain", async () => {
  const token = await newToken();
  const changes = Array.from({ length: 1500 }, (_, index) => like(`track-${index}`, 1_000 + index));

  const first = await sync(token, { cursor: 0, changes }).then((response) => response.json<SyncResponse>());
  expect(first.changes).toHaveLength(1000);
  expect(first.changes.at(-1)?.id).toBe("track-999");
  expect(first).toMatchObject({ cursor: 1000, more: true });

  const second = await pull(token, first.cursor);
  expect(second.changes).toHaveLength(500);
  expect(second.changes[0]?.id).toBe("track-1000");
  expect(second).toMatchObject({ cursor: 1500, more: false });

  expect(await pull(token, second.cursor)).toEqual({ cursor: 1500, changes: [], more: false });
});

it("rejects a sync that would overfill the space and applies none of it", async () => {
  const token = await newToken();
  const filler = "x".repeat(limits.bodyBytes - 100);
  const perBatch = Math.floor(limits.requestBytes / limits.bodyBytes) - 1;
  let cursor = 0;

  for (let batch = 0; ; batch++) {
    expect(batch).toBeLessThan(20);
    const changes = Array.from({ length: perBatch }, (_, index) => like(`${batch}-${index}`, 1, { filler }));
    const response = await sync(token, { cursor, changes });
    if (response.status === 507) {
      expect(batch).toBeGreaterThan(1);
      expect(await response.json()).toEqual({ error: "this sync space is full" });
      // Nothing of the refused batch is stored, but it still counts against the day's allowance,
      // since its rows were written before the rollback.
      const stored = await runInDurableObject(exports.SyncSpace.getByName(token.split(".")[0]!), (_, state) => ({
        ...state.storage.sql.exec<{ records: number; seq: number }>("SELECT count(*) AS records, max(seq) AS seq FROM records").one(),
        ...state.storage.sql.exec<{ changes: number }>("SELECT changes FROM budget").one(),
      }));
      expect(stored).toEqual({ records: perBatch * batch, seq: cursor, changes: perBatch * (batch + 1) });
      return;
    }
    expect(response.status).toBe(200);
    cursor = (await response.json<SyncResponse>()).cursor;
  }
});

describe("request limits", () => {
  it("rejects request bodies over the cap, by header and by bytes read", async () => {
    const token = await newToken();
    const huge = JSON.stringify({ cursor: 0, changes: [], padding: "x".repeat(limits.requestBytes) });
    const headers = { Authorization: `Bearer ${token}` };

    expect((await send("/v1/sync", { method: "POST", headers, body: huge })).status).toBe(413);

    const unsized = new Blob([huge]).stream();
    expect((await send("/v1/sync", { method: "POST", headers, body: unsized })).status).toBe(413);
  });

  it.each([
    ["too many records", { cursor: 0, changes: Array.from({ length: limits.changesPerRequest + 1 }, (_, i) => like(`${i}`, 1)) }],
    ["an id that is too long", { cursor: 0, changes: [like("x".repeat(limits.idChars + 1), 1)] }],
    ["a record body that is too large", { cursor: 0, changes: [like("a", 1, "x".repeat(limits.bodyBytes))] }],
    ["an unknown kind", { cursor: 0, changes: [{ ...like("a", 1), kind: "playlist" }] }],
    ["a tombstone with a body", { cursor: 0, changes: [{ ...like("a", 1), deleted: true }] }],
    ["a live record without a body", { cursor: 0, changes: [like("a", 1, null)] }],
    ["the same record twice", { cursor: 0, changes: [like("a", 1), like("a", 2)] }],
    ["a negative cursor", { cursor: -1, changes: [] }],
    ["a fractional updatedAt", { cursor: 0, changes: [like("a", 1.5)] }],
  ])("rejects %s", async (_, body) => {
    const response = await sync(await newToken(), body);
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("error");
  });
});

it("rejects a live body that JSON turns into null", async () => {
  const token = await newToken();
  const body = '{"cursor":0,"changes":[{"kind":"like","id":"a","updatedAt":1,"deleted":false,"body":1e400}]}';
  const response = await send("/v1/sync", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body });
  expect(response.status).toBe(400);
});

it("turns a space away for the day once it has used its allowance of changes", async () => {
  // The tests allow 6000 changes a day per space.
  const token = await newToken();
  for (let batch = 0; batch < 3; batch++) {
    const changes = Array.from({ length: 2000 }, (_, index) => like(`${batch}-${index}`, 1));
    expect((await sync(token, { cursor: 0, changes })).status).toBe(200);
  }

  const over = await sync(token, { cursor: 0, changes: [like("one-more", 1)] });
  expect(over.status).toBe(429);
  expect(await over.json()).toEqual({ error: "this sync space changed too much today, try again tomorrow" });
  expect((await pull(token, 6000)).changes).toEqual([]);
});

it("deletes a space for good, so a machine still holding the token is told it is gone", async () => {
  const token = await newToken();
  await sync(token, { cursor: 0, changes: [like("a", 1), like("b", 1)] });
  const remove = () => send("/v1/space", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });

  expect((await remove()).status).toBe(204);

  const after = await sync(token, { cursor: 0, changes: [like("c", 1)] });
  expect(after.status).toBe(410);
  expect(await after.json()).toEqual({ error: "this sync space was deleted" });
  expect((await remove()).status).toBe(204);
  const kept = await runInDurableObject(exports.SyncSpace.getByName(token.split(".")[0]!), (_, state) =>
    state.storage.sql.exec<{ records: number }>("SELECT count(*) AS records FROM records").one(),
  );
  expect(kept.records).toBe(0);
});

it("ends a page early rather than send more than a few MiB at once", async () => {
  const token = await newToken();
  const body = { filler: "é".repeat(125 * 1024) };
  for (let batch = 0; batch < 3; batch++) {
    const changes = Array.from({ length: 7 }, (_, index) => like(`${batch}-${index}`, 1, body));
    expect((await sync(token, { cursor: 0, changes })).status).toBe(200);
  }

  const first = await pull(token);
  expect(first.more).toBe(true);
  expect(new TextEncoder().encode(JSON.stringify(first.changes)).byteLength).toBeLessThan(limits.pageBytes + 64 * 1024);
  const second = await pull(token, first.cursor);
  expect(second.more).toBe(false);
  expect(first.changes.length + second.changes.length).toBe(21);
});

it("answers unknown routes with 404", async () => {
  expect((await send("/v1/elsewhere")).status).toBe(404);
});
