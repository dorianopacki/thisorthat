import { describe, expect, it } from "vitest";
import { progressLabel } from "@/lib/study-progress";

// N for a started study is the live link count (total), never participant_target: S-07 adds links
// mid-study. A draft has no links, so it shows the planned participant_target.
describe("progressLabel", () => {
  it("shows the planned participant_target for a draft", () => {
    expect(progressLabel({ status: "draft", responded: 0, total: 0, participant_target: 7 })).toBe(
      "Planowana liczba uczestników: 7",
    );
  });

  it("shows responded of total for an active study, including 0 z N", () => {
    expect(progressLabel({ status: "active", responded: 0, total: 5, participant_target: 5 })).toBe(
      "Odpowiedziało 0 z 5",
    );
  });

  it("uses total, not participant_target, for a started study", () => {
    expect(progressLabel({ status: "active", responded: 3, total: 12, participant_target: 10 })).toBe(
      "Odpowiedziało 3 z 12",
    );
  });

  it("shows responded of total for a closed study", () => {
    expect(progressLabel({ status: "closed", responded: 4, total: 4, participant_target: 4 })).toBe(
      "Odpowiedziało 4 z 4",
    );
  });
});
