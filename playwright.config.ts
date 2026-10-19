import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Local secrets (E2E_USERNAME, E2E_PASSWORD, optional E2E_PORT) come from .dev.vars: gitignored,
// pointed at the local Supabase, and the file the Cloudflare preview reads. Never .env — it may
// hold a hosted project. In CI the file is written by the job (see .github/workflows/ci.yml).
if (existsSync(".dev.vars")) process.loadEnvFile(".dev.vars");

// 4321 is the `astro preview` default (astro.config.mjs sets no server.port).
// E2E_PORT overrides it when that port is taken on this machine.
const PORT = Number(process.env.E2E_PORT ?? 4321);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/user.json" },
      dependencies: ["setup"],
      // The image ballot is a phone risk; it runs only in mobile-chrome.
      testIgnore: /image-variants\.spec\.ts/,
    },
    {
      // S-08: the image ballot at phone width (Pixel 7). Only the image spec runs here.
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"], storageState: "playwright/.auth/user.json" },
      dependencies: ["setup"],
      testMatch: /image-variants\.spec\.ts/,
    },
  ],
  webServer: {
    // Production-like build + preview on the Cloudflare runtime, on the port above.
    command: `npm run build && npm run preview -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Astro 7 moves `astro preview` into a background daemon when it detects an AI agent;
    // keep it in the foreground so Playwright owns (and stops) the server.
    env: { ASTRO_PREVIEW_BACKGROUND: "1" },
  },
});
