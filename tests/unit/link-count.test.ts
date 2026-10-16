import { describe, expect, it } from "vitest";
import { parseAddedCount, parseLinkCount } from "@/lib/link-count";
import { MAX_PARTICIPANTS } from "@/lib/study-limits";

describe("parseLinkCount (form field `count`)", () => {
  it.each([
    ["1", 1],
    [" 3 ", 3],
    [String(MAX_PARTICIPANTS), MAX_PARTICIPANTS],
  ])("accepts %j as %d", (value, expected) => {
    expect(parseLinkCount(value)).toBe(expected);
  });

  it.each(["0", String(MAX_PARTICIPANTS + 1), "abc", "", "1.5", "-1", "+2", "1e1"])("rejects %j", (value) => {
    expect(parseLinkCount(value)).toBeNull();
  });

  it("rejects a missing field or a file", () => {
    expect(parseLinkCount(null)).toBeNull();
    expect(parseLinkCount(undefined)).toBeNull();
    expect(parseLinkCount(new Blob(["1"]))).toBeNull();
  });
});

describe("parseAddedCount (?added=k against the live total)", () => {
  const total = 5;

  it.each([
    ["1", 1],
    [String(total), total],
    [String(total + 1), total],
  ])("?added=%s gives %d", (value, expected) => {
    expect(parseAddedCount(value, total)).toBe(expected);
  });

  it.each([null, "0", "abc", "", "-1", "2.5"])("ignores ?added=%j", (value) => {
    expect(parseAddedCount(value, total)).toBeNull();
  });

  it("ignores any value when there are no links", () => {
    expect(parseAddedCount("1", 0)).toBeNull();
  });
});
