import { type } from "arktype";
import { limits, syncRequest, type StoredChange, type SyncRecord } from "./protocol";
import { mintToken, verifyToken } from "./token";

export { SyncSpace } from "./space";

const fail = (status: number, error: string) => Response.json({ error }, { status });

export default {
  async fetch(request, env) {
    const route = `${request.method} ${new URL(request.url).pathname}`;
    try {
      switch (route) {
        case "POST /v1/spaces":
          return await createSpace(request, env);
        case "POST /v1/sync":
          return await sync(request, env);
        case "DELETE /v1/space":
          return await deleteSpace(request, env);
        default:
          return fail(404, "there is nothing at this address");
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "request failed",
          route,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return fail(500, "the sync server ran into a problem, try again later");
    }
  },
} satisfies ExportedHandler<Env>;

async function createSpace(request: Request, env: Env) {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const { success } = await env.SPACE_CREATION_LIMITER.limit({ key: ip });
  if (!success) return fail(429, "too many sync spaces were created from this address, try again in a minute");
  return Response.json({ token: await mintToken(env.SYNC_SECRET) }, { status: 201 });
}

async function sync(request: Request, env: Env) {
  const space = await openSpace(request, env);
  if (space instanceof Response) return space;

  const body = await readBody(request);
  if (body instanceof Response) return body;
  const parsed = syncRequest(body);
  if (parsed instanceof type.errors) return fail(400, `the sync request is not valid: ${parsed.summary}`);

  const result = await space.sync(parsed.cursor, parsed.changes);
  if (result.type === "full") return fail(507, "this sync space is full");
  const { cursor, changes, more } = result;
  return Response.json({ cursor, changes: changes.map(toRecord), more });
}

async function deleteSpace(request: Request, env: Env) {
  const space = await openSpace(request, env);
  if (space instanceof Response) return space;
  await space.deleteSpace();
  return new Response(null, { status: 204 });
}

/** Every check that can reject a request runs here, before anything reaches a Durable Object. */
async function openSpace(request: Request, env: Env) {
  const authorization = request.headers.get("Authorization") ?? "";
  const spaceId = authorization.startsWith("Bearer ")
    ? await verifyToken(env.SYNC_SECRET, authorization.slice("Bearer ".length))
    : null;
  if (!spaceId) return fail(401, "the sync token is missing or not valid");

  const { success } = await env.SYNC_LIMITER.limit({ key: spaceId });
  if (!success) return fail(429, "this sync space is syncing too often, try again in a minute");

  return env.SYNC_SPACE.getByName(spaceId);
}

async function readBody(request: Request): Promise<unknown> {
  const tooLarge = () => fail(413, `the request body is larger than ${limits.requestBytes} bytes`);
  if (Number(request.headers.get("Content-Length")) > limits.requestBytes) return tooLarge();

  // Content-Length can be absent or wrong, so the cap is enforced on the bytes actually read.
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  let size = 0;
  let text = "";
  try {
    for await (const chunk of request.body ?? []) {
      size += chunk.byteLength;
      if (size > limits.requestBytes) return tooLarge();
      text += decoder.decode(chunk, { stream: true });
    }
    text += decoder.decode();
  } catch {
    return fail(400, "the request body is not valid UTF-8");
  }

  try {
    return JSON.parse(text);
  } catch {
    return fail(400, "the request body is not valid JSON");
  }
}

function toRecord({ body, ...change }: StoredChange): SyncRecord {
  return change.deleted
    ? { ...change, deleted: true, body: null }
    : { ...change, deleted: false, body: JSON.parse(body) };
}
