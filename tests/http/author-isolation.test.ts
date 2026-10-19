import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createStudy,
  describeResponse,
  newAuthor,
  redirectTarget,
  uniqueSuffix,
  variantFields,
  type Author,
} from "./client";
import { exists, signedImages, storageAs, webpFile } from "./storage";

// Author B against author A's study ids. Ownership lives in the database (RLS and the definer
// functions); these tests prove the app translates "not owned" into a 404 page, a JSON 404 or a
// redirect to that page, and that B's requests change nothing. Fixtures go through the app's own
// endpoints, with a unique email and title per run, so the suite can run repeatedly.

interface Fixtures {
  authorA: Author;
  authorB: Author;
  activeId: string;
  draftId: string;
  /** A's draft with an image variant, and that image's object name. */
  imageDraftId: string;
  imagePath: string;
  titles: { active: string; draft: string; image: string; own: string };
}

let fixtures: Fixtures;

beforeAll(async () => {
  const run = uniqueSuffix();
  const titles = { active: `A active ${run}`, draft: `A draft ${run}`, image: `A image ${run}`, own: `B own ${run}` };

  const authorA = await newAuthor();
  const activeId = await createStudy(authorA, titles.active);
  const draftId = await createStudy(authorA, titles.draft);
  const imageDraftId = await createStudy(authorA, titles.image, [
    "A1",
    { description: `A logo ${run}`, image: webpFile() },
  ]);
  const images = signedImages((await authorA.request(`/studies/${imageDraftId}`)).body);
  if (images.length !== 1)
    throw new Error(`A's image draft /studies/${imageDraftId} shows ${String(images.length)} signed images`);
  const [image] = images;
  const start = await authorA.request(`/api/studies/${activeId}/start`, { method: "POST" });
  if (start.status !== 302 || redirectTarget(start) !== `/studies/${activeId}`) {
    throw new Error(
      `start A's study: expected 302 -> /studies/${activeId}, got ${String(start.status)} ${start.location}`,
    );
  }

  const authorB = await newAuthor();
  await createStudy(authorB, titles.own);

  fixtures = { authorA, authorB, activeId, draftId, imageDraftId, imagePath: image.path, titles };
});

// The ids B tries. Resolved lazily: the A ids exist only after beforeAll.
const targets: readonly { target: string; id: () => string }[] = [
  { target: "A-active", id: () => fixtures.activeId },
  { target: "A-draft", id: () => fixtures.draftId },
  { target: "A-image-draft", id: () => fixtures.imageDraftId },
  { target: "unknown uuid", id: () => randomUUID() },
  { target: "non-uuid", id: () => "not-a-uuid" },
];

describe("author B against author A's studies", () => {
  it.each(targets)("B: GET /studies/<$target> answers 404", async ({ id }) => {
    const response = await fixtures.authorB.request(`/studies/${id()}`);
    expect(response.status, describeResponse(response)).toBe(404);
  });

  it.each(targets)('B: GET /api/studies/<$target>/results answers 404 {"error":"not_found"}', async ({ id }) => {
    const response = await fixtures.authorB.request(`/api/studies/${id()}/results`);
    expect(response.status, describeResponse(response)).toBe(404);
    expect(JSON.parse(response.body) as unknown).toEqual({ error: "not_found" });
  });

  it.each(targets)(
    "B: POST /api/studies/<$target>/start redirects to /studies/<$target> without ?error=, which answers B 404",
    async ({ id }) => {
      const studyId = id();
      const response = await fixtures.authorB.request(`/api/studies/${studyId}/start`, { method: "POST" });
      expect(response.status, describeResponse(response)).toBe(302);
      expect(redirectTarget(response)).toBe(`/studies/${studyId}`);

      const followed = await fixtures.authorB.request(redirectTarget(response));
      expect(followed.status, describeResponse(followed)).toBe(404);
    },
  );

  it.each(targets)(
    "B: POST /api/studies/<$target>/close redirects to /studies/<$target> without ?error=, which answers B 404",
    async ({ id }) => {
      const studyId = id();
      const response = await fixtures.authorB.request(`/api/studies/${studyId}/close`, { method: "POST" });
      expect(response.status, describeResponse(response)).toBe(302);
      expect(redirectTarget(response)).toBe(`/studies/${studyId}`);

      const followed = await fixtures.authorB.request(redirectTarget(response));
      expect(followed.status, describeResponse(followed)).toBe(404);
    },
  );

  it.each(targets)("B: GET /studies/<$target>/edit answers 404", async ({ id }) => {
    const response = await fixtures.authorB.request(`/studies/${id()}/edit`);
    expect(response.status, describeResponse(response)).toBe(404);
  });

  it.each(targets)(
    "B: POST /api/studies/<$target>/update redirects to /studies/<$target> without ?error=, which answers B 404",
    async ({ id }) => {
      const studyId = id();
      const response = await fixtures.authorB.request(`/api/studies/${studyId}/update`, {
        method: "POST",
        form: {
          title: `B edit ${uniqueSuffix()}`,
          participant_target: "3",
          ...variantFields(["B1", "B2", "B3"]),
          closes_local: "2099-06-15T18:00",
          closes_tz: "Europe/Warsaw",
        },
      });
      expect(response.status, describeResponse(response)).toBe(302);
      expect(redirectTarget(response)).toBe(`/studies/${studyId}`);

      const followed = await fixtures.authorB.request(redirectTarget(response));
      expect(followed.status, describeResponse(followed)).toBe(404);
    },
  );

  it.each(targets)(
    "B: POST /api/studies/<$target>/delete redirects to /studies/<$target> without ?error=, which answers B 404",
    async ({ id }) => {
      const studyId = id();
      const response = await fixtures.authorB.request(`/api/studies/${studyId}/delete`, { method: "POST" });
      expect(response.status, describeResponse(response)).toBe(302);
      expect(redirectTarget(response)).toBe(`/studies/${studyId}`);

      const followed = await fixtures.authorB.request(redirectTarget(response));
      expect(followed.status, describeResponse(followed)).toBe(404);
    },
  );

  it("B: GET /dashboard lists B's own study and neither of A's", async () => {
    const response = await fixtures.authorB.request("/dashboard");
    expect(response.status, describeResponse(response)).toBe(200);
    expect(response.body).toContain(fixtures.titles.own);
    expect(response.body).not.toContain(fixtures.titles.active);
    expect(response.body).not.toContain(fixtures.titles.draft);
    expect(response.body).not.toContain(fixtures.titles.image);
  });

  it("B: Storage, through B's own session, neither finds nor signs A's image", async () => {
    const storage = await storageAs(fixtures.authorB);
    expect(await exists(storage, fixtures.imagePath)).toBe(false);
    const { data } = await storage.storage.from("variant-images").createSignedUrl(fixtures.imagePath, 60);
    expect(data).toBeNull();
  });

  it("B: GET /dashboard shows B's draft progress from B's own participant_target", async () => {
    const response = await fixtures.authorB.request("/dashboard");
    expect(response.status, describeResponse(response)).toBe(200);
    // createStudy sets N to the variant count (2); B owns exactly one study, a draft.
    expect(response.body).toContain("Planowana liczba uczestników: 2");
    expect(response.body).not.toContain("Odpowiedziało");
  });
});

// Declared after the B block on purpose: Vitest runs a file's tests in order, so these controls
// observe A's studies after every B request above, including B's start attempts.
describe("author A controls, after B's requests", () => {
  it('A: GET /api/studies/<A-draft>/results answers 200 with status "draft"', async () => {
    const response = await fixtures.authorA.request(`/api/studies/${fixtures.draftId}/results`);
    expect(response.status, describeResponse(response)).toBe(200);
    expect(JSON.parse(response.body) as unknown).toMatchObject({ status: "draft" });
  });

  it('A: GET /api/studies/<A-active>/results still answers status "active" after B\'s close attempts', async () => {
    const response = await fixtures.authorA.request(`/api/studies/${fixtures.activeId}/results`);
    expect(response.status, describeResponse(response)).toBe(200);
    expect(JSON.parse(response.body) as unknown).toMatchObject({ status: "active" });
  });

  it("A: GET /studies/<A-draft> still shows the original title and no deadline after B's update and delete attempts", async () => {
    const response = await fixtures.authorA.request(`/studies/${fixtures.draftId}`);
    expect(response.status, describeResponse(response)).toBe(200);
    expect(response.body).toContain(fixtures.titles.draft);
    expect(response.body).not.toContain("B edit ");
    expect(response.body).not.toContain("Zakończy się automatycznie");
  });

  it("A: A's image object and its signed preview survive B's update and delete attempts", async () => {
    const response = await fixtures.authorA.request(`/studies/${fixtures.imageDraftId}`);
    expect(response.status, describeResponse(response)).toBe(200);
    expect(signedImages(response.body).map((i) => i.path)).toEqual([fixtures.imagePath]);
    expect(await exists(await storageAs(fixtures.authorA), fixtures.imagePath)).toBe(true);
  });

  it("A: GET /studies/<A-active> still answers 200 with its title after B's delete attempts", async () => {
    const response = await fixtures.authorA.request(`/studies/${fixtures.activeId}`);
    expect(response.status, describeResponse(response)).toBe(200);
    expect(response.body).toContain(fixtures.titles.active);
  });
});
