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

  await sync(token, {
    cursor: 0,
    changes: [
      like("a", 50, { v: 9 }),
      like("a", 100, { v: 2 }),
      like("a", 100, { v: 0 }),
      { kind: "like", id: "b", updatedAt: 200, deleted: true, body: null },
      like("b", 150, { v: 3 }),
    ],
  });

  const { changes, cursor } = await pull(token);
  expect(changes).toEqual([
    like("a", 100, { v: 2 }),
    { kind: "like", id: "b", updatedAt: 200, deleted: true, body: null },
  ]);
  expect(cursor).toBe(4);
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
      const stored = await pull(token);
      expect(stored.changes).toHaveLength(perBatch * batch);
      expect(stored.cursor).toBe(cursor);
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
    ["a negative cursor", { cursor: -1, changes: [] }],
    ["a fractional updatedAt", { cursor: 0, changes: [like("a", 1.5)] }],
  ])("rejects %s", async (_, body) => {
    const response = await sync(await newToken(), body);
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("error");
  });
});

it("deletes a space, and a client that synced it before starts over", async () => {
  const token = await newToken();
  await sync(token, { cursor: 0, changes: [like("a", 1), like("b", 1)] });

  const deleted = await send("/v1/space", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  expect(deleted.status).toBe(204);
  expect(await pull(token)).toEqual({ cursor: 0, changes: [], more: false });

  const again = await sync(token, { cursor: 2, changes: [like("c", 1)] });
  expect(await again.json()).toEqual({ cursor: 1, changes: [like("c", 1)], more: false });
});

it("answers unknown routes with 404", async () => {
  expect((await send("/v1/elsewhere")).status).toBe(404);
});
