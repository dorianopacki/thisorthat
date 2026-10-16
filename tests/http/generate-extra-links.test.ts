import { beforeAll, describe, expect, it } from "vitest";
import {
  createStartedStudy,
  describeResponse,
  newAuthor,
  newClient,
  redirectTarget,
  uniqueSuffix,
  type Author,
  type Client,
  type StartedStudy,
} from "./client";

// generate-extra-links (S-07), app side: POST /api/studies/<id>/links and the study page around it.
// add_study_links itself (owner only, effectively active only, the 100 cap, N := total, the race with the
// last vote) is proven in pgTAP (supabase/tests/). Fixtures go through the app's own endpoints with
// unique titles, so the suite can run repeatedly.

// createStartedStudy starts a two-variant study with participant_target = 2, so N = 2 links.
const N = 2;
const MAX = 100;
const CLOSED_MESSAGE = "Badanie jest zakończone — nie można dodać linków.";
const LIMIT_MESSAGE = `Badanie może mieć najwyżej ${String(MAX)} linków.`;
const COUNT_MESSAGE = `Podaj liczbę linków od 1 do ${String(MAX - N)}.`;

function addLinks(author: Client, studyId: string, count: string) {
  return author.request(`/api/studies/${studyId}/links`, { method: "POST", form: { count } });
}

function errorTarget(studyId: string, message: string) {
  return `/studies/${studyId}?error=${encodeURIComponent(message)}`;
}

async function linkTotal(author: Client, studyId: string): Promise<number> {
  const response = await author.request(`/api/studies/${studyId}/results`);
  expect(response.status, describeResponse(response)).toBe(200);
  return (JSON.parse(response.body) as { total: number }).total;
}

function tokensOf(body: string): string[] {
  return [...new Set([...body.matchAll(/\/v\/([A-Za-z0-9_-]+)/g)].map((m) => m[1]))];
}

/** How many copy buttons the page renders for link number `n` (one per list it appears in). */
function copyButtons(body: string, n: number): number {
  return body.split(`aria-label="Kopiuj link ${String(n)}"`).length - 1;
}

describe("adding links to an active study (owner)", () => {
  let owner: Author;
  let study: StartedStudy;
  let newTokens: string[] = [];

  beforeAll(async () => {
    owner = await newAuthor();
    study = await createStartedStudy(owner, `Extra links ${uniqueSuffix()}`);
  });

  it("the page offers „Dogeneruj linki” with a count field", async () => {
    const page = await owner.request(`/studies/${study.id}`);
    expect(page.status, describeResponse(page)).toBe(200);
    expect(page.body).toContain("Dogeneruj linki");
    expect(page.body).toContain(`action="/api/studies/${study.id}/links"`);
    expect(page.body).toContain(`name="count"`);
  });

  it("POST count=3 redirects to the study page with ?added=3", async () => {
    const response = await addLinks(owner, study.id, "3");
    expect(response.status, describeResponse(response)).toBe(302);
    expect(redirectTarget(response)).toBe(`/studies/${study.id}?added=3`);
  });

  it("the page shows „Nowe linki (3)” numbered N+1…N+3 above the full list of N+3 links", async () => {
    const page = await owner.request(`/studies/${study.id}?added=3`);
    expect(page.status, describeResponse(page)).toBe(200);
    expect(page.body).toContain("Nowe linki (3)");
    expect(page.body).toContain("Kopiuj nowe");
    expect(page.body).toContain(`Linki do głosowania (${String(N + 3)})`);
    expect(page.body).toMatch(new RegExp(`Liczba uczestników: <span[^>]*>${String(N + 3)}</span>`));
    expect(page.body.indexOf("Nowe linki (3)")).toBeLessThan(page.body.indexOf("Linki do głosowania"));

    // The new links appear twice (their own block and the full list); the original ones once.
    for (let n = 1; n <= N; n++) expect(copyButtons(page.body, n), `link ${String(n)}`).toBe(1);
    for (let n = N + 1; n <= N + 3; n++) expect(copyButtons(page.body, n), `link ${String(n)}`).toBe(2);
    expect(copyButtons(page.body, N + 4)).toBe(0);

    const tokens = tokensOf(page.body);
    expect(tokens).toHaveLength(N + 3);
    // The „Nowe linki” block comes first in the page, so its tokens are the first three found.
    newTokens = tokens.slice(0, 3);
    for (const token of study.tokens) expect(newTokens).not.toContain(token);
  });

  it("without ?added= the page shows no „Nowe linki” block", async () => {
    const page = await owner.request(`/studies/${study.id}`);
    expect(page.status, describeResponse(page)).toBe(200);
    expect(page.body).not.toContain("Nowe linki");
    expect(page.body).toContain(`Linki do głosowania (${String(N + 3)})`);
    // Ordered by position: the original links stay first, the added ones come last.
    expect(tokensOf(page.body)).toEqual([...study.tokens, ...newTokens]);
  });

  it("the results endpoint reports total = N+3", async () => {
    expect(await linkTotal(owner, study.id)).toBe(N + 3);
  });

  it("a new link's /v/<token> shows the ballot", async () => {
    expect(newTokens).toHaveLength(3);
    const response = await newClient().request(`/v/${newTokens[0] ?? ""}`);
    expect(response.status, describeResponse(response)).toBe(200);
    expect(response.body).toContain(study.title);
    expect(response.body).toContain("Wyślij głos");
  });
});

describe("adding links to a closed study", () => {
  let owner: Author;
  let study: StartedStudy;

  beforeAll(async () => {
    owner = await newAuthor();
    study = await createStartedStudy(owner, `Extra links closed ${uniqueSuffix()}`);
    const close = await owner.request(`/api/studies/${study.id}/close`, { method: "POST" });
    if (close.status !== 302) throw new Error(`close: expected 302, got ${describeResponse(close)}`);
  });

  it("the page has no „Dogeneruj linki” form", async () => {
    const page = await owner.request(`/studies/${study.id}`);
    expect(page.status, describeResponse(page)).toBe(200);
    expect(page.body).not.toContain("Dogeneruj linki");
    expect(page.body).not.toContain(`action="/api/studies/${study.id}/links"`);
  });

  it("POST redirects with the closed message and adds nothing", async () => {
    const response = await addLinks(owner, study.id, "1");
    expect(response.status, describeResponse(response)).toBe(302);
    expect(redirectTarget(response)).toBe(errorTarget(study.id, CLOSED_MESSAGE));
    expect(await linkTotal(owner, study.id)).toBe(N);
  });

  it("a bad count still gets the closed message (status is checked before the count)", async () => {
    const response = await addLinks(owner, study.id, "abc");
    expect(response.status, describeResponse(response)).toBe(302);
    expect(redirectTarget(response)).toBe(errorTarget(study.id, CLOSED_MESSAGE));
  });

  it("?added= is ignored: no „Nowe linki” block", async () => {
    const page = await owner.request(`/studies/${study.id}?added=1`);
    expect(page.status, describeResponse(page)).toBe(200);
    expect(page.body).not.toContain("Nowe linki");
  });
});

describe("the 100-link cap and bad input", () => {
  let owner: Author;
  let study: StartedStudy;

  beforeAll(async () => {
    owner = await newAuthor();
    study = await createStartedStudy(owner, `Extra links cap ${uniqueSuffix()}`);
  });

  it.each(["0", "abc", "", "1.5", "101"])("count=%j redirects with the count message", async (count) => {
    const response = await addLinks(owner, study.id, count);
    expect(response.status, describeResponse(response)).toBe(302);
    expect(redirectTarget(response)).toBe(errorTarget(study.id, COUNT_MESSAGE));
  });

  it("a count over the cap redirects with how many can still be added, and adds nothing", async () => {
    const response = await addLinks(owner, study.id, String(MAX - N + 1));
    expect(response.status, describeResponse(response)).toBe(302);
    expect(redirectTarget(response)).toBe(errorTarget(study.id, COUNT_MESSAGE));
    expect(await linkTotal(owner, study.id)).toBe(N);
  });

  it("reaching exactly 100 links replaces the form with the limit note", async () => {
    const response = await addLinks(owner, study.id, String(MAX - N));
    expect(redirectTarget(response), describeResponse(response)).toBe(`/studies/${study.id}?added=${String(MAX - N)}`);

    const page = await owner.request(`/studies/${study.id}`);
    expect(page.status, describeResponse(page)).toBe(200);
    expect(page.body).toContain(`Linki do głosowania (${String(MAX)})`);
    expect(page.body).not.toContain("Dogeneruj linki");
    expect(page.body).toContain(`Badanie ma już ${String(MAX)} linków`);
  });

  it("at 100 links a further POST redirects with the limit message", async () => {
    const response = await addLinks(owner, study.id, "1");
    expect(response.status, describeResponse(response)).toBe(302);
    expect(redirectTarget(response)).toBe(errorTarget(study.id, LIMIT_MESSAGE));
    expect(await linkTotal(owner, study.id)).toBe(MAX);
  });
});

describe("isolation", () => {
  let owner: Author;
  let other: Author;
  let study: StartedStudy;

  beforeAll(async () => {
    owner = await newAuthor();
    other = await newAuthor();
    study = await createStartedStudy(owner, `Extra links isolation ${uniqueSuffix()}`);
  });

  it("another author's POST redirects to the study page without ?error= and adds nothing", async () => {
    const response = await addLinks(other, study.id, "3");
    expect(response.status, describeResponse(response)).toBe(302);
    expect(redirectTarget(response)).toBe(`/studies/${study.id}`);

    const followed = await other.request(redirectTarget(response));
    expect(followed.status, describeResponse(followed)).toBe(404);
    expect(await linkTotal(owner, study.id)).toBe(N);
  });

  it("another author's POST with a bad count also redirects without ?error=", async () => {
    const response = await addLinks(other, study.id, "abc");
    expect(response.status, describeResponse(response)).toBe(302);
    expect(redirectTarget(response)).toBe(`/studies/${study.id}`);
  });
});
