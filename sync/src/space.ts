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

class SpaceFull extends Error {}

export class SyncSpace extends DurableObject<Env> {
  // The schema is created on first sync instead of in the constructor, so deleting a space
  // that never synced, or syncing again after a delete, needs no special case.
  private hasSchema = false;

  sync(cursor: number, changes: StoredChange[]): SyncResult {
    const sql = this.ctx.storage.sql;
    this.ensureSchema();
    const maxSeq = () =>
      sql.exec<{ seq: number | null }>("SELECT max(seq) AS seq FROM records").one().seq ?? 0;

    // A cursor past the newest seq comes from a client that synced this space before it was
    // deleted. Its cursor means nothing here any more, so it gets everything from the start.
    const from = cursor > maxSeq() ? 0 : cursor;

    try {
      this.ctx.storage.transactionSync(() => {
        let seq = maxSeq();
        for (const change of changes) {
          const applied = sql
            .exec(upsert, change.kind, change.id, change.updatedAt, change.deleted ? 1 : 0, change.body, seq + 1)
            .toArray();
          if (applied.length > 0) seq++;
        }
        // Throwing is the only way to make transactionSync roll back.
        if (sql.databaseSize > limits.spaceBytes) throw new SpaceFull();
      });
    } catch (error) {
      if (error instanceof SpaceFull) return { type: "full" };
      throw error;
    }

    const rows = sql
      .exec<Row>(
        "SELECT kind, id, updated_at, deleted, body, seq FROM records WHERE seq > ? ORDER BY seq LIMIT ?",
        from,
        limits.recordsPerPage + 1,
      )
      .toArray();
    const page = rows.slice(0, limits.recordsPerPage);
    return {
      type: "synced",
      cursor: page.at(-1)?.seq ?? from,
      changes: page.map(toChange),
      more: rows.length > page.length,
    };
  }

  async deleteSpace() {
    this.hasSchema = false;
    await this.ctx.storage.deleteAll();
  }

  private ensureSchema() {
    if (this.hasSchema) return;
    this.ctx.storage.sql.exec(`
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
    `);
    this.hasSchema = true;
  }
}

function toChange(row: Row): StoredChange {
  const key = { kind: row.kind, id: row.id, updatedAt: row.updated_at, body: row.body };
  return row.deleted ? { ...key, deleted: true } : { ...key, deleted: false };
}
