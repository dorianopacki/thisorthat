import { beforeAll, describe, expect, it } from "vitest";
import {
  createStartedStudy,
  describeResponse,
  newAuthor,
  newClient,
  redirectTarget,
  uniqueSuffix,
  type Author,
  type StartedStudy,
  variantFields,
} from "./client";

// study-closing-rules (S-04), app side: the manual close endpoint and the deadline entered in the
// wizard. The closing rule itself is proven in pgTAP (supabase/tests/study_closing*.test.sql,
// study_deadline.test.sql); these tests prove the endpoints and the server-rendered pages use it.
// Fixtures go through the app's own endpoints with unique titles, so the suite can run repeatedly.

const DEADLINE_PAST_MESSAGE = "Termin musi być w przyszłości.";

describe("manual close (owner)", () => {
  let owner: Author;
  let study: StartedStudy;

  beforeAll(async () => {
    owner = await newAuthor();
    study = await createStartedStudy(owner, `Close ${uniqueSuffix()}`);
  });

  it("an active study's page offers „Zakończ badanie”", async () => {
    const page = await owner.request(`/studies/${study.id}`);
    expect(page.status, describeResponse(page)).toBe(200);
    expect(page.body).toContain("Zakończ badanie");
  });

  it("POST /api/studies/<id>/close redirects to the study page without ?error=", async () => {
    const response = await owner.request(`/api/studies/${study.id}/close`, { method: "POST" });
    expect(response.status, describeResponse(response)).toBe(302);
    expect(redirectTarget(response)).toBe(`/studies/${study.id}`);
  });

  it('the results endpoint then answers status "closed"', async () => {
    const response = await owner.request(`/api/studies/${study.id}/results`);
    expect(response.status, describeResponse(response)).toBe(200);
    expect(JSON.parse(response.body) as unknown).toMatchObject({ status: "closed" });
  });

  it("the study page shows „Zakończone”, the final notice and no close button", async () => {
    const page = await owner.request(`/studies/${study.id}`);
    expect(page.status, describeResponse(page)).toBe(200);
    expect(page.body).toContain("Zakończone");
    expect(page.body).toContain("Badanie jest zakończone — wyniki są ostateczne.");
    expect(page.body).not.toContain("Zakończ badanie");
  });

  it("a participant link now shows „Badanie jest zakończone”", async () => {
    const response = await newClient().request(`/v/${study.tokens[0] ?? ""}`);
    expect(response.status, describeResponse(response)).toBe(200);
    expect(response.body).toContain("Badanie jest zakończone");
  });

  it("closing again redirects to the study page without ?error=", async () => {
    const response = await owner.request(`/api/studies/${study.id}/close`, { method: "POST" });
    expect(response.status, describeResponse(response)).toBe(302);
    expect(redirectTarget(response)).toBe(`/studies/${study.id}`);
  });
});

describe("deadline from the wizard", () => {
  let owner: Author;

  beforeAll(async () => {
    owner = await newAuthor();
  });

  function createWithDeadline(title: string, closesLocal: string, closesTz = "Europe/Warsaw") {
    return owner.request("/api/studies", {
      method: "POST",
      form: {
        title,
        participant_target: "2",
        ...variantFields(["A", "B"]),
        closes_local: closesLocal,
        closes_tz: closesTz,
      },
    });
  }

  it("a deadline in the past is rejected with a message", async () => {
    const response = await createWithDeadline(`Past deadline ${uniqueSuffix()}`, "2020-01-01T12:00");
    expect(response.status, describeResponse(response)).toBe(302);
    expect(redirectTarget(response)).toBe(`/studies/new?error=${encodeURIComponent(DEADLINE_PAST_MESSAGE)}`);
  });

  it("a future deadline is stored and shown in the author's zone after start", async () => {
    const created = await createWithDeadline(`Future deadline ${uniqueSuffix()}`, "2099-06-15T18:00");
    const match = /^\/studies\/([^/?]+)$/.exec(redirectTarget(created));
    expect(match?.[1], describeResponse(created)).toBeDefined();
    const id = match?.[1] ?? "";

    const start = await owner.request(`/api/studies/${id}/start`, { method: "POST" });
    expect(redirectTarget(start), describeResponse(start)).toBe(`/studies/${id}`);

    const page = await owner.request(`/studies/${id}`);
    expect(page.status, describeResponse(page)).toBe(200);
    expect(page.body).toContain("Zakończy się automatycznie");
    expect(page.body).toContain("15 czerwca 2099");
    expect(page.body).toContain("18:00");
  });

  it("an empty deadline field creates a study without a deadline", async () => {
    const created = await createWithDeadline(`No deadline ${uniqueSuffix()}`, "");
    expect(redirectTarget(created), describeResponse(created)).toMatch(/^\/studies\/[^/?]+$/);
    const page = await owner.request(redirectTarget(created));
    expect(page.body).not.toContain("Zakończy się automatycznie");
  });
});
