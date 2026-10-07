import type { Page } from "@playwright/test";

// Astro removes the `ssr` attribute from an island once it has hydrated. Wait for it before typing
// into or submitting a React island when the action must not run twice (it creates data): input sent
// before hydration is lost, and a retry would create a second record.
export async function waitForIslands(page: Page): Promise<void> {
  await page.waitForFunction(() => !document.querySelector("astro-island[ssr]"));
}
