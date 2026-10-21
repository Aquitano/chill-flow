declare namespace Cloudflare {
  interface Env {
    /** Only the tests bind it, see vitest.config.ts. */
    SYNC_SPACE: DurableObjectNamespace<import("../src/space").SyncSpace>;
  }
}
