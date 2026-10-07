#!/usr/bin/env node
// Stop: before the agent finishes, sweep everything this turn changed, with one retry.
// Catches edits that never reached the per-edit hook (files rewritten through Bash).
// Per checkout: ESLint on changed files, the whole unit suite (~5 s), then `astro check`
// (syncs generated types itself and also checks .astro files).
import { existsSync } from "node:fs";
import path from "node:path";
import { LINT_EXTS, block, clearRegistry, git, readPayload, registeredRoots, runBin, toplevel } from "./lib.mjs";

const payload = readPayload();

// Already sent back once by this hook: let it finish; the commit gate and CI catch the rest.
// (loop_count covers Cursor, which imports hooks from .claude/settings.json.)
if (payload.stop_hook_active === true || Number(payload.loop_count ?? 0) > 0) process.exit(0);

const cwd = typeof payload.cwd === "string" && payload.cwd !== "" ? payload.cwd : process.cwd();
const roots = [...new Set([toplevel(cwd), ...registeredRoots(payload)].filter((r) => r && existsSync(r)))];
if (roots.length === 0) {
  // Not silent: the user sees why nothing was checked.
  process.stdout.write(JSON.stringify({ systemMessage: `end-of-turn hook: no git checkout at ${cwd}, nothing checked.` }));
  process.exit(0);
}

// Files that make a whole-project typecheck and test run worth it, beyond lintable sources.
const PROJECT_FILES = new Set(["package.json", "package-lock.json", "tsconfig.json", "vitest.config.ts", "astro.config.mjs"]);

const failures = [];
for (const root of roots) {
  const changed = [
    ...(git(root, ["diff", "--name-only", "HEAD"]) ?? "").split("\n"),
    ...(git(root, ["ls-files", "-o", "--exclude-standard"]) ?? "").split("\n"),
  ]
    .map((f) => f.trim())
    .filter(Boolean);
  if (changed.length === 0) continue; // A Q&A turn: nothing to check here.

  const lintable = [...new Set(changed)].filter(
    (f) => LINT_EXTS.has(path.extname(f).toLowerCase()) && existsSync(path.join(root, f)),
  );
  const projectTouched = changed.some((f) => PROJECT_FILES.has(f));
  if (lintable.length === 0 && !projectTouched) continue; // Docs-only turn.

  if (lintable.length > 0) {
    const lint = runBin(root, "eslint", "bin/eslint.js", ["--quiet", "--no-warn-ignored", ...lintable]);
    if (!lint.ok) failures.push(`ESLint errors in changed files (${root}):\n${lint.output}`);
  }
  const tests = runBin(root, "vitest", "vitest.mjs", ["run", "--project", "unit"]);
  if (!tests.ok) failures.push(`Unit tests fail (${root}):\n${tests.output}`);
  const types = runBin(root, "astro", "bin/astro.mjs", ["check"]);
  if (!types.ok) failures.push(`Typecheck (astro check) fails (${root}):\n${types.output}`);
}

if (failures.length > 0) block(`Fix these before you finish:\n\n${failures.join("\n\n")}`);
// Green: start the next turn with an empty registry.
clearRegistry(payload);
process.exit(0);
