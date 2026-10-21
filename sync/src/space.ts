import { DurableObject } from "cloudflare:workers";
import { limits, type StoredChange, type SyncResult } from "./protocol";

type Row = {
  kind: StoredChange["kind"];
  id: string;
  updated_at: number;
  deleted: number;
  body: string;
  seq: number;
};

// Last write wins per (kind, id). Equal timestamps fall back to comparing the serialized
// bodies in SQLite, which compares UTF-8 bytes like Rust's `str` ordering does.
const upsert = `
  INSERT INTO records (kind, id, updated_at, deleted, body, seq) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (kind, id) DO UPDATE SET
    updated_at = excluded.updated_at, deleted = excluded.deleted, body = excluded.body, seq = excluded.seq
  WHERE excluded.updated_at > records.updated_at
    OR (excluded.updated_at = records.updated_at AND excluded.body > records.body)
  RETURNING seq`;

/** Thrown inside the transaction to roll it back and answer with `result` instead. */
class Refused extends Error {
  constructor(readonly result: SyncResult) {
    super(result.type);
  }
}

export class SyncSpace extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS records (
          kind TEXT NOT NULL,
          id TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted INTEGER NOT NULL,
          body TEXT NOT NULL,
          seq INTEGER NOT NULL,
          PRIMARY KEY (kind, id)
        );
        CREATE INDEX IF NOT EXISTS records_by_seq ON records (seq);
        CREATE TABLE IF NOT EXISTS budget (day TEXT PRIMARY KEY, changes INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS closed (at INTEGER NOT NULL);
      `);
    });
  }

  sync(cursor: number, changes: StoredChange[]): SyncResult {
    const sql = this.ctx.storage.sql;
    if (this.isClosed()) return { type: "deleted" };
    const lostTies: StoredChange[] = [];
    // Charged in a transaction of its own, so a sync rolled back below still counts: SQLite bills
    // the rows it wrote before the rollback.
    if (changes.length > 0 && !this.ctx.storage.transactionSync(() => this.spend(changes.length))) {
      return { type: "over budget" };
    }
    try {
      this.ctx.storage.transactionSync(() => {
        let seq = sql.exec<{ seq: number | null }>("SELECT max(seq) AS seq FROM records").one().seq ?? 0;
        for (const change of changes) {
          const applied = sql
            .exec(upsert, change.kind, change.id, change.updatedAt, change.deleted ? 1 : 0, change.body, seq + 1)
            .toArray();
          if (applied.length > 0) seq++;
          else lostTies.push(change);
        }
        if (sql.databaseSize > limits.spaceBytes) throw new Refused({ type: "full" });
      });
    } catch (error) {
      if (error instanceof Refused) return error.result;
      throw error;
    }

    // Only this server decides ties, so a client whose change lost one gets the winner back even
    // when the client has seen its seq already. Clients take equal-time records from the server.
    const winners = lostTies.flatMap(({ kind, id, updatedAt }) =>
      sql
        .exec<Row>(
          "SELECT kind, id, updated_at, deleted, body, seq FROM records WHERE kind = ? AND id = ? AND updated_at = ? AND seq <= ?",
          kind,
          id,
          updatedAt,
          cursor,
        )
        .toArray(),
    );

    const rows = sql
      .exec<Row>(
        "SELECT kind, id, updated_at, deleted, body, seq FROM records WHERE seq > ? ORDER BY seq LIMIT ?",
        cursor,
        limits.recordsPerPage + 1,
      )
      .toArray();
    // A page also stops at a size, so a client never has to hold a thousand of the largest bodies.
    const page: Row[] = [];
    let bytes = 0;
    for (const row of [...rows.slice(0, limits.recordsPerPage), ...winners]) {
      if (page.length > 0 && bytes + row.body.length > limits.pageBytes) break;
      page.push(row);
      bytes += row.body.length;
    }
    const sent = page.filter((row) => row.seq > cursor);
    return {
      type: "synced",
      cursor: sent.at(-1)?.seq ?? cursor,
      changes: page.map(toChange),
      more: sent.length < rows.length,
    };
  }

  /**
   * Wipes the space and closes it for good. Another machine that still holds the token is told
   * the space is gone, rather than filling it again, and a seq is never reused.
   */
  deleteSpace() {
    const sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      sql.exec("DELETE FROM records");
      sql.exec("DELETE FROM budget");
      if (!this.isClosed()) sql.exec("INSERT INTO closed (at) VALUES (?)", Date.now());
    });
  }

  private isClosed() {
    return this.ctx.storage.sql.exec("SELECT 1 FROM closed").toArray().length > 0;
  }

  /**
   * Rows written are billed whether or not they grow the space, so a space gets a daily
   * allowance of changes. Returns false, spending nothing, when `count` doesn't fit today.
   */
  private spend(count: number): boolean {
    const sql = this.ctx.storage.sql;
    const day = new Date().toISOString().slice(0, 10);
    sql.exec("DELETE FROM budget WHERE day <> ?", day);
    const used = sql.exec<{ changes: number }>("SELECT changes FROM budget WHERE day = ?", day).toArray()[0]?.changes ?? 0;
    if (used + count > Number(this.env.DAILY_CHANGES_PER_SPACE)) return false;
    sql.exec("INSERT OR REPLACE INTO budget (day, changes) VALUES (?, ?)", day, used + count);
    return true;
  }
}

function toChange(row: Row): StoredChange {
  const key = { kind: row.kind, id: row.id, updatedAt: row.updated_at, body: row.body };
  return row.deleted ? { ...key, deleted: true } : { ...key, deleted: false };
}
