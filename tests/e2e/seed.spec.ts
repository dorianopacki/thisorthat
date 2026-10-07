// Seed for the E2E suite: the pattern every generated test copies.
// Protects test-plan.md risk #1 — an author page is reachable without signing in, or the session
// cookie behaves differently on the Workers runtime than locally (the preview runs on workerd).
// Creates no data, so there is nothing to clean up. Never "clean up" by signing out: sign-out
// revokes the shared session that every other spec loads from storageState.
import { test, expect } from "@playwright/test";

test("signed-in author's session cookie opens an author page on the Workers runtime", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await expect(page.getByText(`Welcome, ${process.env.E2E_USERNAME}`)).toBeVisible();
});

test.describe("signed out", () => {
  // This risk is the signed-out path, so opt out of the saved session.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("author page redirects a signed-out visitor to sign-in", async ({ page }) => {
    await page.goto("/studies/new");

    await page.waitForURL("/auth/signin");
    await expect(page.getByRole("heading", { name: "Sign in", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nowe badanie" })).toBeHidden();
  });
});
