import { DurableObject } from "cloudflare:workers";

/**
 * Counts new sync spaces per UTC day across every address. Every space can store and write up to
 * its own limits, so this daily cap is what bounds how fast the whole service can grow. Only
 * creating a space calls it, never a sync.
 */
export class Admission extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS admitted (day TEXT PRIMARY KEY, spaces INTEGER NOT NULL)");
    });
  }

  admit(limit: number): boolean {
    const sql = this.ctx.storage.sql;
    const day = new Date().toISOString().slice(0, 10);
    sql.exec("DELETE FROM admitted WHERE day <> ?", day);
    const spaces = sql.exec<{ spaces: number }>("SELECT spaces FROM admitted WHERE day = ?", day).toArray()[0]?.spaces ?? 0;
    if (spaces >= limit) return false;
    sql.exec("INSERT OR REPLACE INTO admitted (day, spaces) VALUES (?, ?)", day, spaces + 1);
    return true;
  }
}
