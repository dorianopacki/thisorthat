import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ROUTE_AUDIENCE, requiresAuthor } from "@/lib/route-access";

const PAGES_DIR = fileURLToPath(new URL("../../src/pages", import.meta.url));
const ROUTE_FILE = /\.(astro|ts)$/;

// src/pages/api/studies/[id]/start.ts -> /api/studies/[id]/start; index files map to their folder.
function routePattern(relativePath: string): string {
  const segments = relativePath.replace(ROUTE_FILE, "").split(/[\\/]/);
  if (segments.at(-1) === "index") segments.pop();
  return `/${segments.join("/")}`;
}

const pageFiles = readdirSync(PAGES_DIR, { recursive: true, encoding: "utf8" }).filter((file) => ROUTE_FILE.test(file));
const filePatterns = new Map(pageFiles.map((file) => [routePattern(file), file]));

describe("route classification", () => {
  it("finds the pages directory", () => {
    expect(pageFiles.length).toBeGreaterThan(0);
  });

  it.each([...filePatterns])("%s is classified in src/lib/route-access.ts", (pattern, file) => {
    expect(
      Object.hasOwn(ROUTE_AUDIENCE, pattern),
      `src/pages/${file} (route ${pattern}) has no entry in ROUTE_AUDIENCE in src/lib/route-access.ts`,
    ).toBe(true);
  });

  it.each(Object.keys(ROUTE_AUDIENCE))("%s has a file under src/pages", (pattern) => {
    expect(filePatterns.has(pattern), `ROUTE_AUDIENCE entry ${pattern} matches no file under src/pages`).toBe(true);
  });
});

describe("requiresAuthor", () => {
  it("is true for an author route", () => {
    expect(requiresAuthor("/api/studies/[id]/start")).toBe(true);
  });

  it("is false for a participant route", () => {
    expect(requiresAuthor("/v/[token]")).toBe(false);
  });

  it("is false for a public route", () => {
    expect(requiresAuthor("/auth/signin")).toBe(false);
  });

  it("is false for an unknown pattern", () => {
    expect(requiresAuthor("/_image")).toBe(false);
    expect(requiresAuthor("toString")).toBe(false);
  });
});
