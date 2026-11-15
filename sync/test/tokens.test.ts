import { env, exports } from "cloudflare:workers";
import { listDurableObjectIds, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { mintToken, verifyToken } from "../src/token";
import { like, newToken, send, sync } from "./client";

const createSpace = (ip: string) =>
  send("/v1/spaces", { method: "POST", headers: { "CF-Connecting-IP": ip } });

const firstChange = async (address: string) =>
  send("/v1/sync", {
    method: "POST",
    headers: { Authorization: `Bearer ${await newToken()}`, "CF-Connecting-IP": address },
    body: JSON.stringify({ cursor: 0, changes: [like("a", 1)] }),
  });

const today = () => new Date().toISOString().slice(0, 10);

const admittedToday = (spaces?: number) =>
  runInDurableObject(exports.Admission.getByName("spaces"), (_, state) => {
    const sql = state.storage.sql;
    if (spaces !== undefined) sql.exec("INSERT OR REPLACE INTO admitted (day, spaces) VALUES (?, ?)", today(), spaces);
    return sql.exec<{ spaces: number }>("SELECT coalesce(sum(spaces), 0) AS spaces FROM admitted WHERE day = ?", today()).one().spaces;
  });

it("mints verifiable tokens up to the per-address rate limit", async () => {
  const created = await Promise.all(Array.from({ length: 5 }, () => createSpace("203.0.113.7")));
  for (const response of created) {
    expect(response.status).toBe(201);
    const { token } = await response.json<{ token: string }>();
    expect(token).toMatch(/^[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/);
    expect(await verifyToken(env.SYNC_SECRET, token)).toBe(token.split(".")[0]);
  }

  expect((await createSpace("203.0.113.7")).status).toBe(429);
  expect((await createSpace("198.51.100.1")).status).toBe(201);
});

it("rejects missing and forged tokens without reaching a Durable Object", async () => {
  const [spaceId] = (await mintToken(env.SYNC_SECRET)).split(".");
  const otherSecret = await mintToken("some-other-secret");
  const forged = [`${spaceId}.${"A".repeat(43)}`, otherSecret, "not-a-token", `${spaceId}.`];

  for (const token of forged) {
    const response = await sync(token, { cursor: 0, changes: [] });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "the sync token is missing or not valid" });
  }
  expect((await send("/v1/sync", { method: "POST", body: "{}" })).status).toBe(401);

  expect(await listDurableObjectIds(env.SYNC_SPACE)).toEqual([]);
});

it("counts a space against the day only when it first stores a change, and only once", async () => {
  const before = await admittedToday();
  const stockpiled = await Promise.all(Array.from({ length: 5 }, newToken));
  for (const token of stockpiled) {
    const pulled = await sync(token, { cursor: 0, changes: [] });
    expect(await pulled.json()).toEqual({ cursor: 0, changes: [], more: false });
  }
  expect(await admittedToday()).toBe(before);
  const tables = await runInDurableObject(exports.SyncSpace.getByName(stockpiled[0]!.split(".")[0]!), (_, state) =>
    state.storage.sql.exec("SELECT name FROM sqlite_master").toArray(),
  );
  expect(tables).toEqual([]);

  const [token] = stockpiled;
  expect((await sync(token!, { cursor: 0, changes: [like("a", 1)] })).status).toBe(200);
  expect((await sync(token!, { cursor: 1, changes: [like("b", 2)] })).status).toBe(200);
  expect(await admittedToday()).toBe(before + 1);
});

it("lets one address start only a few spaces a day, counting an IPv6 /64 as one address", async () => {
  // The tests allow 3 new spaces a day per address.
  for (const address of ["2001:db8:aa:1::1", "2001:db8:aa:1:ffff::2", "2001:db8:aa:1:0:0:0:3"]) {
    expect((await firstChange(address)).status).toBe(200);
  }
  const refused = await firstChange("2001:db8:aa:1::4");
  expect(refused.status).toBe(429);
  expect(await refused.json()).toEqual({
    error: "too many sync spaces were started from this address today, try again tomorrow",
  });
  expect((await firstChange("2001:db8:aa:2::1")).status).toBe(200);
});

it("turns new spaces away once the day's admissions are spent, while spaces in use keep syncing", async () => {
  const inUse = await newToken();
  expect((await sync(inUse, { cursor: 0, changes: [like("a", 1)] })).status).toBe(200);
  const before = await admittedToday(Number(env.DAILY_NEW_SPACES));

  const refused = await firstChange("198.51.100.9");
  expect(refused.status).toBe(503);
  expect(await refused.json()).toEqual({ error: "sync is not taking new spaces today, try again tomorrow" });
  expect((await sync(inUse, { cursor: 1, changes: [like("b", 2)] })).status).toBe(200);

  await admittedToday(before - 1);
});
