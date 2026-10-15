// risk: test-plan.md #3 — one link yields two votes, or an accepted vote is lost
// facet: a second browser without the "voted" cookie cannot add a vote through the same link, and the
//        author's results count exactly the accepted vote. A vote after a manual close is
//        close-study.spec.ts; the vote/close race and the closing rule are proven in pgTAP
//        (supabase/tests/study_closing.test.sql, study_closing_race.test.sql). Deleted studies wait for S-06.
// seed: tests/e2e/seed.spec.ts
import { test, expect, type Browser, type Page } from "@playwright/test";
import { deleteStudiesTitled } from "./support/cleanup";
import { waitForIslands } from "./support/hydration";

const ANONYMOUS = { cookies: [], origins: [] };

// A participant has no account and their own browser: a fresh context with no session and no cookies.
async function voteAsNewParticipant(browser: Browser, link: string, variant: string): Promise<Page> {
  const context = await browser.newContext({ storageState: ANONYMOUS });
  const page = await context.newPage();
  await page.goto(link);
  await waitForIslands(page);
  await page.getByRole("radio", { name: variant }).check();
  await page.getByRole("button", { name: "Wyślij głos" }).click();
  return page;
}

test.describe("risk #3: one link, one vote", () => {
  const title = `E2E one vote ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const alfa = `Alfa ${title}`;
  const beta = `Beta ${title}`;

  test.afterEach(async () => {
    await deleteStudiesTitled(title);
  });

  test("a second browser on a used link adds no vote and the author sees exactly one", async ({ page, browser }) => {
    test.info().annotations.push({ type: "test-data", description: title });

    // The author creates a study for two participants and starts it.
    await page.goto("/studies/new");
    await waitForIslands(page);
    await page.getByLabel("Tytuł badania").fill(title);
    await page.getByLabel("Liczba uczestników").fill("2");
    await page.getByRole("textbox", { name: "Wariant 1" }).fill(alfa);
    await page.getByRole("textbox", { name: "Wariant 2" }).fill(beta);
    await page.getByRole("button", { name: "Utwórz szkic" }).click();
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();

    await waitForIslands(page);
    await page.getByRole("button", { name: "Rozpocznij" }).click();
    await page.getByRole("button", { name: "Tak, rozpocznij" }).click();
    await expect(page.getByRole("heading", { name: "Linki do głosowania (2)" })).toBeVisible();
    const link = await page
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: "Kopiuj link 1" }) })
      .getByText(/\/v\/[0-9a-f]+$/)
      .innerText();

    // Participant 1 votes through the link and is thanked.
    const first = await voteAsNewParticipant(browser, link, alfa);
    await expect(first.getByRole("heading", { name: "Dziękujemy za udział w badaniu" })).toBeVisible();
    await first.context().close();

    // A second browser, without the "voted" cookie, gets the ballot again and tries another variant.
    const second = await voteAsNewParticipant(browser, link, beta);
    await expect(second.getByRole("heading", { name: "Twój głos został już oddany" })).toBeVisible();
    await second.context().close();

    // The author's results count exactly the accepted vote.
    await page.reload();
    await expect(page.getByText("Odpowiedziało 1 z 2")).toBeVisible();
    const results = page.getByRole("listitem");
    await expect(results.filter({ hasText: alfa }).getByText("1 głos", { exact: true })).toBeVisible();
    await expect(results.filter({ hasText: beta }).getByText("0 głosów", { exact: true })).toBeVisible();
  });
});
