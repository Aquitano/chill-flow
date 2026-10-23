import { type } from "arktype";

export const limits = {
  requestBytes: 2 * 1024 * 1024,
  changesPerRequest: 2000,
  idChars: 200,
  bodyBytes: 256 * 1024,
  recordsPerPage: 1000,
  pageBytes: 4 * 1024 * 1024,
  spaceBytes: 10 * 1024 * 1024,
};

const kind = type("'like' | 'saved' | 'scene' | 'mix' | 'focus' | 'setting'");

const recordKey = {
  kind,
  id: `0 < string <= ${limits.idChars}`,
  updatedAt: "number.epoch >= 0",
} as const;

const encoder = new TextEncoder();

// A record that isn't deleted needs a body: a live `null` would serialize like a tombstone and
// leave equal-time conflicts without a winner. The check runs on the serialized form, since a
// number too large for JSON.parse turns into Infinity and serializes as `null` too.
const serializedBody = type("unknown").pipe((body, ctx) => {
  const json = JSON.stringify(body);
  if (json === "null") return ctx.error({ expected: "a body for a record that is not deleted", actual: "null" });
  const bytes = encoder.encode(json).byteLength;
  return bytes <= limits.bodyBytes
    ? json
    : ctx.error({ expected: `at most ${limits.bodyBytes} bytes of JSON`, actual: `${bytes} bytes` });
});

const incomingRecord = type({ ...recordKey, deleted: "true", body: type("null").pipe(() => "null") }).or({
  ...recordKey,
  deleted: "false",
  body: serializedBody,
});

export const syncRequest = type({
  cursor: "number.integer >= 0",
  changes: incomingRecord.array().atMostLength(limits.changesPerRequest),
});

export type SyncRecord = typeof incomingRecord.inferIn;

/** A record on its way into storage, with the body serialized to JSON. */
export type StoredChange = typeof incomingRecord.infer;

export type SyncFailure =
  | { type: "full" }
  | { type: "over budget" }
  | { type: "deleted" };

export type SyncResult = Response | SyncFailure;
