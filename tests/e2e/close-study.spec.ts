// risk: test-plan.md #3 — a vote is accepted for a closed study (app side of #6: the manual close)
// facet: a participant whose ballot was already open when the author closed the study through the
//        two-step „Zakończ badanie” button cannot vote with it: the send lands on „Badanie jest
//        zakończone”, and the author still sees the results with nothing counted. The endpoint
//        contract is tests/http/study-closing.test.ts; the closing rule, the deadline and the
//        vote/close race are pgTAP (supabase/tests/study_closing*.test.sql, study_deadline.test.sql).
// seed: tests/e2e/seed.spec.ts
import { test, expect } from "@playwright/test";
import { deleteStudiesTitled } from "./support/cleanup";
import { waitForIslands } from "./support/hydration";

const ANONYMOUS = { cookies: [], origins: [] };

test.describe("risk #3: no vote after a manual close", () => {
  const title = `E2E close ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const alfa = `Alfa ${title}`;
  const beta = `Beta ${title}`;

  test.afterEach(async () => {
    await deleteStudiesTitled(title);
  });

  test("a ballot opened before the author closes the study cannot vote after it", async ({ page, browser }) => {
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

    // A participant opens the link while the study is still running and picks a variant.
    const participant = await (await browser.newContext({ storageState: ANONYMOUS })).newPage();
    await participant.goto(link);
    await waitForIslands(participant);
    await participant.getByRole("radio", { name: alfa }).check();

    // The author closes the study through the confirmation step.
    await waitForIslands(page);
    await page.getByRole("button", { name: "Zakończ badanie" }).click();
    await expect(page.getByRole("alert")).toContainText("Zakończonego badania nie da się wznowić");
    await page.getByRole("button", { name: "Tak, zakończ" }).click();
    // The form posts and the page reloads without the confirmation step.
    await expect(page.getByRole("button", { name: "Tak, zakończ" })).toBeHidden();

    // The participant sends the ballot that was open all along: no thank-you, the study has ended.
    await participant.getByRole("button", { name: "Wyślij głos" }).click();
    await expect(participant.getByRole("heading", { name: "Badanie jest zakończone", level: 1 })).toBeVisible();
    await participant.context().close();

    // The author still sees the results, closed, with nothing counted.
    await page.reload();
    await expect(page.getByText("Status: Zakończone")).toBeVisible();
    await expect(page.getByText("Odpowiedziało 0 z 2")).toBeVisible();
    await expect(page.getByRole("button", { name: "Zakończ badanie" })).toHaveCount(0);
  });
});
