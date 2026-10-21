import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
  worker: {
    name: "chill-sync",
    // The newest date the pinned workerd supports; tests fail on a later one.
    compatibilityDate: "2026-10-19",
    entrypoint,
    // chill's default sync_url, and the only way in.
    domains: ["chill-sync.aquitano.me"],
    workersDev: false,
    observability: {
      enabled: true,
      logs: {
        enabled: true,
        headSamplingRate: 1,
        // Invocation logs would record each request, Authorization header included, so only
        // the Worker's own error lines are kept.
        invocationLogs: false,
      },
      traces: {
        enabled: true,
        headSamplingRate: 0.01,
      },
    },
    env: {
      DAILY_NEW_SPACES: bindings.text("100"),
      DAILY_CHANGES_PER_SPACE: bindings.text("20000"),
      SYNC_SECRET: bindings.secret(),
      // Rate-limit namespaces must be unique in the account; change them if 1001 or 1002 is taken.
      SPACE_CREATION_LIMITER: bindings.rateLimit({ namespace: "1001", simple: { limit: 5, period: 60 } }),
      SYNC_LIMITER: bindings.rateLimit({ namespace: "1002", simple: { limit: 30, period: 60 } }),
    },
    exports: {
      SyncSpace: exports.durableObject({ storage: "sqlite" }),
      Admission: exports.durableObject({ storage: "sqlite" }),
    },
  },
});
