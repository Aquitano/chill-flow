import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { SYNC_SECRET: "test-secret", DAILY_NEW_SPACES: "8", DAILY_CHANGES_PER_SPACE: "6000" },
      },
    }),
  ],
});
