import { expect, test } from "vitest";

// Throwaway: proves the ci-passed gate goes red. Removed in the next commit.
test("gate check (deliberate failure A)", () => {
  expect(1).toBe(2);
});
