import { test as setup, expect } from "@playwright/test";

const authFile = "playwright/.auth/user.json";

setup("sign in once and save the session", async ({ page }) => {
  const username = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;
  if (!username || !password) {
    throw new Error("Set E2E_USERNAME and E2E_PASSWORD in .dev.vars (see context/foundation/test-stack.md, ## E2E)");
  }

  await page.goto("/auth/signin");
  // The sign-in form is a React island: input typed before it hydrates is lost and its validation
  // then blocks the submit. Retry fill + submit until the submit leaves the sign-in page (signing in
  // twice changes nothing). Clear before filling: re-filling the same value fires no change event.
  await expect(async () => {
    await page.getByLabel("Email").fill("");
    await page.getByLabel("Email").fill(username);
    await page.getByLabel("Password", { exact: true }).fill("");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/signin"), { timeout: 5_000 });
  }).toPass();

  // Only a signed-in author stays on /dashboard, sees their study list and their email in the topbar.
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Twoje badania", level: 1 })).toBeVisible();
  await expect(page.getByText(username, { exact: true })).toBeVisible();

  await page.context().storageState({ path: authFile });
});
