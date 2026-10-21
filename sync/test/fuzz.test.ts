import fc from "fast-check";
import { expect, it } from "vitest";
import { newToken, send } from "./client";

const kinds = ["like", "saved", "scene", "mix", "focus", "setting", "playlist", ""];

const change = fc.record({
  kind: fc.constantFrom(...kinds),
  id: fc.oneof(fc.string({ maxLength: 8 }), fc.string({ minLength: 190, maxLength: 210 })),
  updatedAt: fc.oneof(fc.integer(), fc.double(), fc.constant(Number.MAX_SAFE_INTEGER + 2)),
  deleted: fc.boolean(),
  body: fc.oneof(fc.constant(null), fc.jsonValue({ maxDepth: 3 })),
});

const body = fc.oneof(
  fc.string(),
  fc.jsonValue({ maxDepth: 4 }).map((value) => JSON.stringify(value)),
  fc
    .record({ cursor: fc.oneof(fc.nat(), fc.integer(), fc.double(), fc.string()), changes: fc.array(change, { maxLength: 6 }) })
    .map((request) => JSON.stringify(request)),
);

it("answers any request body with a status the client handles, never a server error", async () => {
  await fc.assert(
    fc.asyncProperty(body, async (text) => {
      const token = await newToken();
      const response = await send("/v1/sync", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: text });
      expect([200, 400, 413]).toContain(response.status);
      const answer = await response.json<Record<string, unknown>>();
      expect(response.status === 200 ? "cursor" in answer : typeof answer.error === "string").toBe(true);
    }),
    { numRuns: 300 },
  );
});
