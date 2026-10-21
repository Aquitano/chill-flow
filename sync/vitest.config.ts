import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      experimental: { newConfig: true },
      miniflare: {
        bindings: { SYNC_SECRET: "test-secret", DAILY_NEW_SPACES: "8", DAILY_CHANGES_PER_SPACE: "6000" },
        // The Worker reaches its Durable Objects through `exports`; listing their ids in a test
        // needs a named binding.
        durableObjects: { SYNC_SPACE: "SyncSpace" },
      },
    }),
  ],
});
