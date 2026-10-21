import { env, exports } from "cloudflare:workers";
import { mintToken } from "../src/token";

export const newToken = () => mintToken(env.SYNC_SECRET);

export function send(path: string, init: RequestInit = {}) {
  return exports.default.fetch(new Request(`https://sync.test${path}`, init));
}

export function sync(token: string, body: unknown) {
  return send("/v1/sync", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

export function like(id: string, updatedAt: number, body: unknown = { addedAt: updatedAt }) {
  return { kind: "like", id, updatedAt, deleted: false, body };
}
