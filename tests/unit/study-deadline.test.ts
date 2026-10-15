import { describe, expect, it } from "vitest";
import { formatDeadline } from "@/lib/study-deadline";

// The deadline is shown in the zone the author set it in (studies.closes_tz), not in the server's
// zone: Workers run in UTC.
describe("formatDeadline", () => {
  it("shows a summer instant in Warsaw time (+02)", () => {
    const text = formatDeadline("2030-06-15T16:00:00+00:00", "Europe/Warsaw");
    expect(text).toContain("15 czerwca 2030");
    expect(text).toContain("18:00");
    expect(text).toContain("Europe/Warsaw");
  });

  it("shows a winter instant in Warsaw time (+01)", () => {
    const text = formatDeadline("2030-01-15T16:00:00+00:00", "Europe/Warsaw");
    expect(text).toContain("15 stycznia 2030");
    expect(text).toContain("17:00");
  });

  it("uses the stored zone, not a fixed one", () => {
    const text = formatDeadline("2030-06-15T16:00:00+00:00", "America/New_York");
    expect(text).toContain("12:00");
    expect(text).toContain("America/New_York");
  });
});
