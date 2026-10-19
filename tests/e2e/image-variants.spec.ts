// risk: S-08 image variants on a phone (PRD FR-003, NFR §mobile) — test-plan.md rollout phase 4 (the loop
//       at phone width) and #1 (the participant link stays public, now with images)
// facet: an author creates a study mixing two image variants and a text variant and starts it; a
//        participant on a phone, with no session, sees both images through signed URLs, full width with no
//        horizontal scroll, votes for an image variant by its description and is thanked; the author's
//        results count that vote. Upload, sniffing, cleanup and the signing gate (closed or unknown token)
//        are tests/http/image-variants.test.ts; storage isolation is pgTAP (image_variants.test.sql).
// seed: tests/e2e/seed.spec.ts
import { test, expect, devices, type Page } from "@playwright/test";
import { deleteStudiesTitled } from "./support/cleanup";
import { waitForIslands } from "./support/hydration";

const ANONYMOUS = { cookies: [], origins: [] };
const RED = "tests/e2e/fixtures/variant-red.png";
const BLUE = "tests/e2e/fixtures/variant-blue.png";

// Picks an image for variant n and waits until the browser has resized it (the preview appears), so the
// form can be sent: submit is blocked while a resize is pending.
async function addImageVariant(page: Page, n: number, file: string, description: string) {
  await page
    .getByRole("group", { name: `Rodzaj wariantu ${String(n)}` })
    .getByRole("radio", { name: "Grafika" })
    .check();
  await page.getByLabel(`Grafika wariantu ${String(n)} (JPEG, PNG lub WebP)`).setInputFiles(file);
  await expect(page.getByRole("img", { name: `Podgląd grafiki wariantu ${String(n)}` })).toBeVisible();
  await page.getByRole("textbox", { name: `Wariant ${String(n)} Opis grafiki` }).fill(description);
}

test.describe("S-08: image ballot on a phone", () => {
  const title = `E2E images ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const red = `Czerwony ${title}`;
  const blue = `Niebieski ${title}`;
  const text = `Tekst ${title}`;

  test.afterEach(async () => {
    await deleteStudiesTitled(title);
  });

  test("a participant on a phone sees the image variants full width and votes for one", async ({ page, browser }) => {
    test.info().annotations.push({ type: "test-data", description: title });

    // The author creates a study with two image variants and one text variant, and starts it.
    await page.goto("/studies/new");
    await waitForIslands(page);
    await page.getByLabel("Tytuł badania").fill(title);
    await page.getByLabel("Liczba uczestników").fill("2");
    await addImageVariant(page, 1, RED, red);
    await addImageVariant(page, 2, BLUE, blue);
    await page.getByRole("button", { name: "Dodaj wariant" }).click();
    await page.getByRole("textbox", { name: "Wariant 3", exact: true }).fill(text);
    await page.getByRole("button", { name: "Utwórz szkic" }).click();
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await expect(page.getByRole("img", { name: red })).toBeVisible();

    await waitForIslands(page);
    await page.getByRole("button", { name: "Rozpocznij" }).click();
    await page.getByRole("button", { name: "Tak, rozpocznij" }).click();
    await expect(page.getByRole("heading", { name: "Linki do głosowania (2)" })).toBeVisible();
    const link = await page
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: "Kopiuj link 1" }) })
      .getByText(/\/v\/[0-9a-f]+$/)
      .innerText();

    // A participant opens the link on their own phone, with no session.
    const phone = await browser.newContext({ ...devices["Pixel 7"], storageState: ANONYMOUS });
    const participant = await phone.newPage();
    await participant.goto(link);
    await waitForIslands(participant);

    // Both images arrive (the signed URLs load), each spanning most of the screen width.
    const viewportWidth = participant.viewportSize()?.width ?? 0;
    for (const description of [red, blue]) {
      const image = participant.getByRole("img", { name: description });
      await expect(image).toBeVisible();
      // Bring each image into view, as a participant scrolling the ballot would.
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
      const box = await image.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThan(viewportWidth * 0.7);
    }

    // The page does not scroll sideways.
    const overflow = await participant.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // The participant votes for an image variant by its description and is thanked.
    await participant.getByRole("radio", { name: blue }).check();
    await participant.getByRole("button", { name: "Wyślij głos" }).click();
    await expect(participant.getByRole("heading", { name: "Dziękujemy za udział w badaniu" })).toBeVisible();
    await phone.close();

    // The author's results count the vote for that image variant.
    await page.reload();
    await expect(page.getByText("Odpowiedziało 1 z 2")).toBeVisible();
    const results = page.getByRole("listitem");
    await expect(results.filter({ hasText: blue }).getByText("1 głos", { exact: true })).toBeVisible();
    await expect(results.filter({ hasText: red }).getByText("0 głosów", { exact: true })).toBeVisible();
  });
});
