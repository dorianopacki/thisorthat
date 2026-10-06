import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Plain Node config on purpose: no getViteConfig(), so the Cloudflare vite plugin stays out of tests.
// "unit" needs no server; "http" runs against a running build (BASE_URL), one file at a time.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    projects: [
      { test: { name: "unit", include: ["tests/unit/**/*.test.ts"] } },
      {
        test: {
          name: "http",
          include: ["tests/http/**/*.test.ts"],
          setupFiles: ["tests/http/setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
