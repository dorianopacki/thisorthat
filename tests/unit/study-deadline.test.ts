import { describe, expect, it } from "vitest";
import { formatDeadline, toLocalInputValue } from "@/lib/study-deadline";

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

  it("falls back to UTC for a stored zone Intl cannot format, instead of throwing", () => {
    const text = formatDeadline("2030-06-15T16:00:00+00:00", "posix/Europe/Warsaw");
    expect(text).toContain("16:00");
    expect(text).toContain("(UTC)");
  });

  it("uses the stored zone, not a fixed one", () => {
    const text = formatDeadline("2030-06-15T16:00:00+00:00", "America/New_York");
    expect(text).toContain("12:00");
    expect(text).toContain("America/New_York");
  });
});

// The edit form's datetime-local value: the stored instant as local time in the stored zone. Oracle:
// the offset rules of the zone (Europe/Warsaw: +02 in summer, +01 in winter) and how Postgres reads a
// local time back (`closes_local at time zone closes_tz`), not the implementation.
describe("toLocalInputValue", () => {
  it("gives a summer instant as Warsaw local time (+02)", () => {
    expect(toLocalInputValue("2030-06-15T16:00:00Z", "Europe/Warsaw")).toBe("2030-06-15T18:00");
  });

  it("gives a winter instant as Warsaw local time (+01)", () => {
    expect(toLocalInputValue("2030-01-15T16:00:00+00:00", "Europe/Warsaw")).toBe("2030-01-15T17:00");
  });

  it("round-trips a deadline in the doubled autumn hour to the local time Postgres stored it from", () => {
    // Postgres reads 2027-10-31 02:30 Europe/Warsaw with the offset after the jump back (+01), so it
    // stores 01:30Z; the form must show 02:30 again, which saves to the same instant.
    expect(toLocalInputValue("2027-10-31T01:30:00+00:00", "Europe/Warsaw")).toBe("2027-10-31T02:30");
  });

  it("uses the stored zone, not a fixed one", () => {
    expect(toLocalInputValue("2030-06-15T16:00:00Z", "America/New_York")).toBe("2030-06-15T12:00");
  });

  it("falls back to the UTC value for a zone Intl cannot format, instead of throwing", () => {
    expect(toLocalInputValue("2030-06-15T16:00:00Z", "posix/Europe/Warsaw")).toBe("2030-06-15T16:00");
  });

  it("pads midnight as 00, not 24", () => {
    expect(toLocalInputValue("2030-06-14T22:05:00Z", "Europe/Warsaw")).toBe("2030-06-15T00:05");
  });
});
