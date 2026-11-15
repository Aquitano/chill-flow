import { env, exports } from "cloudflare:workers";
import { mintToken } from "../src/token";

export const newToken = () => mintToken(env.SYNC_SECRET);

let clients = 0;

/** Each request comes from an address of its own unless it names one, as if from many machines. */
export function send(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("CF-Connecting-IP")) headers.set("CF-Connecting-IP", `2001:db8:${(++clients).toString(16)}::1`);
  return exports.default.fetch(new Request(`https://sync.test${path}`, { ...init, headers }));
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
