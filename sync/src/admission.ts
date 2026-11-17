import { DurableObject } from "cloudflare:workers";
import type { AdmissionRefusal } from "./protocol";
import { sign } from "./token";

/**
 * Counts the sync spaces that come into use per UTC day, across every address and per address.
 * Every space can store and write up to its own limits, so the daily cap is what bounds how fast
 * the whole service can grow. A space calls it once, before it stores its first change.
 */
export class Admission extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS admitted (day TEXT PRIMARY KEY, spaces INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS addresses (
          day TEXT NOT NULL,
          address_hash TEXT NOT NULL,
          spaces INTEGER NOT NULL,
          PRIMARY KEY (day, address_hash)
        );
      `);
    });
  }

  async admit(address: string): Promise<{ type: "admitted" } | AdmissionRefusal> {
    const day = new Date().toISOString().slice(0, 10);
    // Keyed and salted with the day, so the stored value can't be turned back into an address or
    // linked across days.
    const addressHash = await sign(this.env.SYNC_SECRET, `${day} ${network(address)}`);
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM admitted WHERE day <> ?", day);
    sql.exec("DELETE FROM addresses WHERE day <> ?", day);
    const spaces = sql.exec<{ spaces: number }>("SELECT spaces FROM admitted WHERE day = ?", day).toArray()[0]?.spaces ?? 0;
    if (spaces >= Number(this.env.DAILY_NEW_SPACES)) return { type: "closed today" };
    const fromAddress =
      sql
        .exec<{ spaces: number }>("SELECT spaces FROM addresses WHERE day = ? AND address_hash = ?", day, addressHash)
        .toArray()[0]?.spaces ?? 0;
    if (fromAddress >= Number(this.env.DAILY_NEW_SPACES_PER_ADDRESS)) return { type: "address over limit" };
    sql.exec("INSERT OR REPLACE INTO admitted (day, spaces) VALUES (?, ?)", day, spaces + 1);
    sql.exec("INSERT OR REPLACE INTO addresses (day, address_hash, spaces) VALUES (?, ?, ?)", day, addressHash, fromAddress + 1);
    return { type: "admitted" };
  }
}

/** An IPv6 subscriber gets at least a /64, so its first four groups stand for one client. */
function network(address: string) {
  if (!address.includes(":")) return address;
  const [head = "", tail = ""] = address.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const zeros = address.includes("::") ? Math.max(0, 8 - left.length - right.length) : 0;
  return [...left, ...Array<string>(zeros).fill("0"), ...right]
    .slice(0, 4)
    .map((group) => parseInt(group, 16).toString(16))
    .join(":");
}
