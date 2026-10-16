import { beforeAll, describe, expect, it } from "vitest";
import {
  createStartedStudy,
  createStudy,
  describeResponse,
  newAuthor,
  redirectTarget,
  uniqueSuffix,
  type Author,
  type Form,
  type StartedStudy,
} from "./client";

// edit-and-delete-study (S-06), app side: the owner's draft edit through the edit page and
// POST /api/studies/<id>/update. update_study_draft itself (replace semantics, draft-only, limits,
// isolation) is proven in pgTAP (supabase/tests/edit_and_delete_study.test.sql); B against A is in
// author-isolation.test.ts. Fixtures go through the app's own endpoints with unique titles, so the suite
// can run repeatedly.

const NOT_DRAFT_MESSAGE = "Badanie już wystartowało — szkicu nie można edytować.";
const VARIANT_COUNT_MESSAGE = "Badanie musi mieć od 2 do 6 wariantów.";
const DEADLINE_PAST_MESSAGE = "Termin musi być w przyszłości.";

function editForm(title: string, variants: readonly string[], deadline?: { local: string; tz: string }): Form {
  return {
    title,
    participant_target: "3",
    variant: variants,
    closes_local: deadline?.local ?? "",
    closes_tz: deadline?.tz ?? "",
  };
}

describe("draft edit (owner)", () => {
  let owner: Author;
  let draftId: string;
  const run = uniqueSuffix();
  const original = `Edit original ${run}`;
  const edited = `Edit renamed ${run}`;
  const variants = [`Alfa ${run}`, `Beta ${run}`, `Gamma ${run}`];

  beforeAll(async () => {
    owner = await newAuthor();
    draftId = await createStudy(owner, original);
  });

  it("a draft's page offers „Edytuj” linking to its edit page", async () => {
    const page = await owner.request(`/studies/${draftId}`);
    expect(page.status, describeResponse(page)).toBe(200);
    expect(page.body).toContain("Edytuj");
    expect(page.body).toContain(`href="/studies/${draftId}/edit"`);
  });

  it("GET /studies/<draft>/edit answers 200 with the form prefilled", async () => {
    const page = await owner.request(`/studies/${draftId}/edit`);
    expect(page.status, describeResponse(page)).toBe(200);
    expect(page.body).toContain("Edytuj badanie");
    expect(page.body).toContain("Zapisz zmiany");
    expect(page.body).toContain(`action="/api/studies/${draftId}/update"`);
    expect(page.body).toContain(original);
  });

  it("saving a new title, three variants and a deadline redirects to the study page, which shows them", async () => {
    const response = await owner.request(`/api/studies/${draftId}/update`, {
      method: "POST",
      form: editForm(edited, variants, { local: "2099-06-15T18:00", tz: "Europe/Warsaw" }),
    });
    expect(response.status, describeResponse(response)).toBe(302);
    expect(redirectTarget(response)).toBe(`/studies/${draftId}`);

    const page = await owner.request(`/studies/${draftId}`);
    expect(page.status, describeResponse(page)).toBe(200);
    expect(page.body).toContain(edited);
    expect(page.body).not.toContain(original);
    for (const variant of variants) expect(page.body).toContain(variant);
    expect(page.body).toContain("Wariant 3");
    expect(page.body).toContain("Zakończy się automatycznie");
    expect(page.body).toContain("15 czerwca 2099");
    expect(page.body).toContain("18:00");
  });

  it("the edit page prefills the deadline as local time in its stored zone", async () => {
    const page = await owner.request(`/studies/${draftId}/edit`);
    expect(page.status, describeResponse(page)).toBe(200);
    expect(page.body).toContain('value="2099-06-15T18:00"');
    expect(page.body).toContain('value="Europe/Warsaw"');
  });

  it("saving with the deadline cleared removes the „Zakończy się automatycznie” line", async () => {
    const response = await owner.request(`/api/studies/${draftId}/update`, {
      method: "POST",
      form: editForm(edited, variants),
    });
    expect(redirectTarget(response), describeResponse(response)).toBe(`/studies/${draftId}`);

    const page = await owner.request(`/studies/${draftId}`);
    expect(page.status, describeResponse(page)).toBe(200);
    expect(page.body).toContain(edited);
    expect(page.body).not.toContain("Zakończy się automatycznie");
  });

  it("an invalid form (one variant) redirects back to the edit page with ?error=", async () => {
    const response = await owner.request(`/api/studies/${draftId}/update`, {
      method: "POST",
      form: editForm(`Invalid ${run}`, ["Only one"]),
    });
    expect(response.status, describeResponse(response)).toBe(302);
    expect(redirectTarget(response)).toBe(
      `/studies/${draftId}/edit?error=${encodeURIComponent(VARIANT_COUNT_MESSAGE)}`,
    );
  });

  it("a deadline in the past redirects back to the edit page with the deadline message", async () => {
    const response = await owner.request(`/api/studies/${draftId}/update`, {
      method: "POST",
      form: editForm(`Past ${run}`, variants, { local: "2020-01-01T12:00", tz: "Europe/Warsaw" }),
    });
    expect(response.status, describeResponse(response)).toBe(302);
    expect(redirectTarget(response)).toBe(
      `/studies/${draftId}/edit?error=${encodeURIComponent(DEADLINE_PAST_MESSAGE)}`,
    );

    const page = await owner.request(`/studies/${draftId}`);
    expect(page.body).toContain(edited);
  });
});

describe("edit of a started study (owner)", () => {
  let owner: Author;
  let study: StartedStudy;

  beforeAll(async () => {
    owner = await newAuthor();
    study = await createStartedStudy(owner, `Edit started ${uniqueSuffix()}`);
  });

  it("the study page offers no „Edytuj”", async () => {
    const page = await owner.request(`/studies/${study.id}`);
    expect(page.status, describeResponse(page)).toBe(200);
    expect(page.body).not.toContain(`/studies/${study.id}/edit`);
  });

  it("GET /studies/<active>/edit redirects to the study page", async () => {
    const response = await owner.request(`/studies/${study.id}/edit`);
    expect(response.status, describeResponse(response)).toBe(302);
    expect(redirectTarget(response)).toBe(`/studies/${study.id}`);
  });

  it("POST /api/studies/<active>/update redirects with ?error= and leaves the study unchanged", async () => {
    const renamed = `Edit started renamed ${uniqueSuffix()}`;
    const response = await owner.request(`/api/studies/${study.id}/update`, {
      method: "POST",
      form: editForm(renamed, ["X", "Y", "Z"]),
    });
    expect(response.status, describeResponse(response)).toBe(302);
    expect(redirectTarget(response)).toBe(`/studies/${study.id}?error=${encodeURIComponent(NOT_DRAFT_MESSAGE)}`);

    const page = await owner.request(`/studies/${study.id}`);
    expect(page.status, describeResponse(page)).toBe(200);
    expect(page.body).toContain(study.title);
    expect(page.body).not.toContain(renamed);
  });
});
