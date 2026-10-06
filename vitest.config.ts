import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Plain Node config on purpose: no getViteConfig(), so the Cloudflare vite plugin stays out of tests.
// "unit" needs no server; "http" runs against a running build (BASE_URL), one file at a time.
// Vitest overwrites process.env.BASE_URL in test workers with Vite's `base` ("/"), so the server
// address is read here, in the main process, and handed to the workers as TEST_BASE_URL.
const serverUrl = process.env.BASE_URL;

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
          env: serverUrl ? { TEST_BASE_URL: serverUrl } : {},
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
