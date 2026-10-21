import { env } from "cloudflare:workers";
import { listDurableObjectIds } from "cloudflare:test";
import { expect, it } from "vitest";
import { mintToken, verifyToken } from "../src/token";
import { send, sync } from "./client";

const createSpace = (ip: string) =>
  send("/v1/spaces", { method: "POST", headers: { "CF-Connecting-IP": ip } });

it("mints verifiable tokens up to the per-address limit", async () => {
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
  expect((await send("/v1/space", { method: "DELETE" })).status).toBe(401);

  expect(await listDurableObjectIds(env.SYNC_SPACE)).toEqual([]);
});
