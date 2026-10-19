import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// SUPABASE_SECRET_KEY bypasses RLS. src/lib/supabase-admin.ts wraps it in one signing function, and only
// the ballot page may call it, after get_ballot accepted the token
// (docs/reference/contract-surfaces.md#storage-variant-images). A new importer must be reviewed first.
const SRC_DIR = fileURLToPath(new URL("../../src", import.meta.url));
const ADMIN_MODULE = "lib/supabase-admin.ts";
const ALLOWED_IMPORTERS = ["pages/v/[token].astro"];

// Static `from "…supabase-admin"`, side-effect `import "…"` and dynamic `import("…")`, by any path.
const IMPORTS_ADMIN = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'][^"']*\bsupabase-admin(?:\.[cm]?[jt]s)?["']/;

const sourceFiles = readdirSync(SRC_DIR, { recursive: true, encoding: "utf8" })
  .map((file) => file.split(/[\\/]/).join("/"))
  .filter((file) => /\.(astro|[cm]?[jt]sx?)$/.test(file));

describe("supabase-admin usage", () => {
  it("finds the admin module", () => {
    expect(sourceFiles).toContain(ADMIN_MODULE);
  });

  it("is imported only by the ballot page", () => {
    const importers = sourceFiles
      .filter((file) => file !== ADMIN_MODULE)
      .filter((file) => IMPORTS_ADMIN.test(readFileSync(join(SRC_DIR, file), "utf8")));
    expect(importers).toEqual(ALLOWED_IMPORTERS);
  });

  it("exports only signParticipantImagePaths", () => {
    const source = readFileSync(join(SRC_DIR, ADMIN_MODULE), "utf8");
    const exported = [
      ...source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class|type|interface)\s+(\w+)/gm),
    ];
    expect(exported.map((m) => m[1])).toEqual(["signParticipantImagePaths"]);
    expect(source).not.toMatch(/^export\s*(?:\{|\*|default)/m);
  });
});
