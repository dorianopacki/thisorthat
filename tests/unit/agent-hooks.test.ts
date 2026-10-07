// Proof for the Claude Code hooks in .claude/hooks/ (configured in .claude/settings.json).
// Each case pipes a hook payload into the real script, inside a throwaway git repo whose
// node_modules holds stub eslint / vitest / astro binaries that flag a marker string.
// Git and the scripts are real; only the slow tools are stubbed.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const HOOKS = path.join(REPO, ".claude", "hooks");

const STUBS: Record<string, string> = {
  // Flags every file argument that contains LINT_ERROR.
  "eslint/bin/eslint.js": `
const fs = require("node:fs");
const bad = process.argv.slice(2).filter((a) => !a.startsWith("--") && fs.readFileSync(a, "utf8").includes("LINT_ERROR"));
for (const f of bad) console.log(f + "\\n  1:1  error  stub rule: LINT_ERROR marker");
process.exit(bad.length ? 1 : 0);
`,
  // Fails when any test file contains FAIL_TEST.
  "vitest/vitest.mjs": `
import fs from "node:fs";
const dir = "tests";
const bad = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => fs.readFileSync(dir + "/" + f, "utf8").includes("FAIL_TEST")) : [];
for (const f of bad) console.log("FAIL tests/" + f + " > expected 1 to be 2");
process.exit(bad.length ? 1 : 0);
`,
  // Fails when any source file contains TYPE_ERROR.
  "astro/bin/astro.mjs": `
import fs from "node:fs";
const bad = fs.readdirSync("src").filter((f) => fs.readFileSync("src/" + f, "utf8").includes("TYPE_ERROR"));
for (const f of bad) console.log("\x1b[96msrc/" + f + "\x1b[0m:1:7 - error ts(2322): Type 'string' is not assignable to type 'number'.");
process.exit(bad.length ? 1 : 0);
`,
};

const tmpRoots: string[] = [];
const sessions: string[] = [];

afterAll(() => {
  for (const sid of sessions) rmSync(path.join(os.tmpdir(), "claude-hooks", `${sid}.roots`), { force: true });
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
});

// Run from a git hook (pre-commit), this suite inherits GIT_INDEX_FILE, GIT_DIR and friends,
// which would point every git call in the fixture repos at the outer repository.
// (Cast: src/env.d.ts makes SUPABASE_URL/KEY required on ProcessEnv; the copy keeps whatever is set.)
const CLEAN_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
) as NodeJS.ProcessEnv;

function sh(cwd: string, args: string[]): string {
  const r = spawnSync("git", ["-c", "user.name=hook-test", "-c", "user.email=hook-test@example.com", ...args], {
    cwd,
    encoding: "utf8",
    env: CLEAN_ENV,
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function installStubs(root: string) {
  for (const [rel, body] of Object.entries(STUBS)) {
    const file = path.join(root, "node_modules", rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
}

// A committed, clean repo: src/ok.ts, tests/ok.test.ts, README.md, the hooks and settings.
function makeRepo(): string {
  const base = mkdtempSync(path.join(os.tmpdir(), "agent-hooks-"));
  tmpRoots.push(base);
  const root = path.join(base, "repo");
  mkdirSync(path.join(root, "src"), { recursive: true });
  mkdirSync(path.join(root, "tests"), { recursive: true });
  writeFileSync(path.join(root, "src", "ok.ts"), "export const ok = 1;\n");
  writeFileSync(path.join(root, "tests", "ok.test.ts"), "import { ok } from '../src/ok';\n");
  writeFileSync(path.join(root, "README.md"), "# fixture\n");
  writeFileSync(path.join(root, ".gitignore"), "node_modules/\n");
  cpSync(HOOKS, path.join(root, ".claude", "hooks"), { recursive: true });
  cpSync(path.join(REPO, ".claude", "settings.json"), path.join(root, ".claude", "settings.json"));
  installStubs(root);
  sh(root, ["init", "-q", "-b", "main"]);
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-q", "-m", "fixture"]);
  return root;
}

function sid(): string {
  const id = `hooktest-${randomUUID()}`;
  sessions.push(id);
  return id;
}

interface HookResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runHook(script: string, payload: unknown, cwd: string, env: Record<string, string> = {}): HookResult {
  const input = typeof payload === "string" ? payload : JSON.stringify(payload);
  const r = spawnSync(process.execPath, [path.join(HOOKS, script)], {
    cwd,
    input,
    encoding: "utf8",
    env: { ...CLEAN_ENV, ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const edit = (root: string, file: string, session = sid()) => ({
  session_id: session,
  cwd: root,
  hook_event_name: "PostToolUse",
  tool_name: "Edit",
  tool_input: { file_path: file },
});

const stop = (root: string, extra: Record<string, unknown> = {}) => ({
  session_id: sid(),
  cwd: root,
  hook_event_name: "Stop",
  stop_hook_active: false,
  ...extra,
});

const PER_EDIT = ["lint-edited-file.mjs"];
const ALL = [...PER_EDIT, "end-of-turn.mjs"];

describe("agent hooks", { timeout: 60_000 }, () => {
  it("per-edit lint blocks a broken file and names it on stderr (exit 2)", () => {
    const root = makeRepo();
    const bad = path.join(root, "src", "bad.ts");
    writeFileSync(bad, "const unused = 1; // LINT_ERROR\n");
    const r = runHook("lint-edited-file.mjs", edit(root, bad), root);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("src/bad.ts");
    expect(r.stderr).toContain("LINT_ERROR");
  });

  it("per edit runs lint only: a failing unit test does not block mid-change", () => {
    const root = makeRepo();
    writeFileSync(path.join(root, "tests", "ok.test.ts"), "// FAIL_TEST\n");
    const r = runHook("lint-edited-file.mjs", edit(root, path.join(root, "src", "ok.ts")), root);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("clean file passes every hook with no blocking output", () => {
    const root = makeRepo();
    const ok = path.join(root, "src", "ok.ts");
    writeFileSync(ok, "export const ok = 2;\n");
    for (const script of PER_EDIT) {
      const r = runHook(script, edit(root, ok), root);
      expect(r.status, script).toBe(0);
      expect(r.stderr, script).toBe("");
    }
    const s = runHook("end-of-turn.mjs", stop(root), root);
    expect(s.status).toBe(0);
    expect(s.stderr).toBe("");
  });

  it("skips uncovered types and nonexistent files", () => {
    const root = makeRepo();
    for (const script of PER_EDIT) {
      expect(runHook(script, edit(root, path.join(root, "README.md")), root).status, script).toBe(0);
      expect(runHook(script, edit(root, path.join(root, "src", "missing.ts")), root).status, script).toBe(0);
    }
  });

  it("treats empty, unparseable and path-less payloads as nothing to check", () => {
    const root = makeRepo();
    const payloads: unknown[] = ["", "not json", {}, { tool_name: "Bash", cwd: root, tool_input: { command: "ls" } }];
    for (const script of ALL) {
      for (const p of payloads) {
        const r = runHook(script, p, root);
        expect(r.status, `${script} ${JSON.stringify(p)}`).toBe(0);
      }
    }
  });

  it("end of turn lets the agent finish on the retry, even with the error present", () => {
    const root = makeRepo();
    writeFileSync(path.join(root, "src", "bad.ts"), "// LINT_ERROR\n");
    expect(runHook("end-of-turn.mjs", stop(root), root).status).toBe(2);
    expect(runHook("end-of-turn.mjs", stop(root, { stop_hook_active: true }), root).status).toBe(0);
    expect(runHook("end-of-turn.mjs", stop(root, { loop_count: 1 }), root).status).toBe(0);
  });

  it("end of turn catches lint, test and type errors written without a per-edit payload", () => {
    const root = makeRepo();
    writeFileSync(path.join(root, "src", "shell.ts"), "// LINT_ERROR TYPE_ERROR\n");
    writeFileSync(path.join(root, "tests", "ok.test.ts"), "// FAIL_TEST\n");
    const r = runHook("end-of-turn.mjs", stop(root), root);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("src/shell.ts");
    expect(r.stderr).toContain("ESLint errors");
    expect(r.stderr).toContain("Unit tests fail");
    expect(r.stderr).toContain("astro check");
    // Output is read by a model: no colour escapes.
    expect(r.stderr).not.toContain("\u001b[");
    expect(r.stderr).not.toContain("");
  });

  it("end of turn runs no check when nothing changed or only docs changed", () => {
    const root = makeRepo();
    // With the tools gone, any check that ran would fail the hook.
    rmSync(path.join(root, "node_modules"), { recursive: true, force: true });
    expect(runHook("end-of-turn.mjs", stop(root), root).status).toBe(0);
    writeFileSync(path.join(root, "README.md"), "# docs only\n");
    expect(runHook("end-of-turn.mjs", stop(root), root).status).toBe(0);
  });

  it("checks the session's checkout, not $CLAUDE_PROJECT_DIR, and resolves relative paths against cwd", () => {
    const root = makeRepo();
    const other = makeRepo();
    writeFileSync(path.join(other, "src", "bad.ts"), "// LINT_ERROR\n");
    writeFileSync(path.join(root, "src", "ok.ts"), "export const ok = 3;\n");
    const env = { CLAUDE_PROJECT_DIR: other };
    expect(runHook("lint-edited-file.mjs", edit(root, path.join(root, "src", "ok.ts")), root, env).status).toBe(0);
    expect(runHook("end-of-turn.mjs", stop(root), root, env).status).toBe(0);

    writeFileSync(path.join(root, "src", "rel.ts"), "// LINT_ERROR\n");
    const rel = runHook("lint-edited-file.mjs", edit(root, "src/rel.ts"), root);
    expect(rel.status).toBe(2);
    expect(rel.stderr).toContain("src/rel.ts");
  });

  it("skips a broken file that belongs to another repository", () => {
    const root = makeRepo();
    const other = makeRepo();
    const foreign = path.join(other, "src", "bad.ts");
    writeFileSync(foreign, "// LINT_ERROR\n");
    expect(runHook("lint-edited-file.mjs", edit(root, foreign), root).status).toBe(0);
  });

  it("lints an edit in a sibling worktree and sweeps it at end of turn", () => {
    const root = makeRepo();
    const wt = path.join(path.dirname(root), "wt");
    sh(root, ["worktree", "add", "-q", "-b", "wt", wt]);
    installStubs(wt);
    const bad = path.join(wt, "src", "w.ts");
    writeFileSync(bad, "// LINT_ERROR\n");
    const session = sid();
    const per = runHook("lint-edited-file.mjs", edit(root, bad, session), root);
    expect(per.status).toBe(2);
    expect(per.stderr).toContain("src/w.ts");
    const s = runHook("end-of-turn.mjs", { ...stop(root), session_id: session }, root);
    expect(s.status).toBe(2);
    expect(s.stderr).toContain("src/w.ts");
  });

  it("every command in settings.json reaches its script from a worktree with a stale $CLAUDE_PROJECT_DIR", () => {
    const root = makeRepo();
    const wt = path.join(path.dirname(root), "wt-clean");
    sh(root, ["worktree", "add", "-q", "-b", "wt-clean", wt]);
    const settings = JSON.parse(readFileSync(path.join(root, ".claude", "settings.json"), "utf8")) as {
      hooks: Record<string, { hooks: { command: string }[] }[]>;
    };
    const commands = Object.values(settings.hooks).flatMap((groups) =>
      groups.flatMap((g) => g.hooks.map((h) => h.command)),
    );
    expect(commands).toHaveLength(2);
    const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
    const bash = process.platform === "win32" && existsSync(gitBash) ? gitBash : "bash";
    for (const command of commands) {
      const r = spawnSync(bash, ["-c", command], {
        cwd: wt,
        input: "{}",
        encoding: "utf8",
        env: { ...CLEAN_ENV, CLAUDE_PROJECT_DIR: path.join(os.tmpdir(), "does-not-exist") },
      });
      expect(r.status, `${command}\n${r.stderr}`).toBe(0);
    }
  });

  it("fails visibly when a tool is not installed", () => {
    const root = makeRepo();
    rmSync(path.join(root, "node_modules", "eslint"), { recursive: true, force: true });
    const ok = path.join(root, "src", "ok.ts");
    const r = runHook("lint-edited-file.mjs", edit(root, ok), root);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("eslint is not installed");

    rmSync(path.join(root, "node_modules", "astro"), { recursive: true, force: true });
    writeFileSync(ok, "export const ok = 4;\n");
    const s = runHook("end-of-turn.mjs", stop(root), root);
    expect(s.status).toBe(2);
    expect(s.stderr).toContain("astro is not installed");
  });

  it.skipIf(process.platform !== "win32")("accepts Windows backslash paths in tool_input.file_path", () => {
    const root = makeRepo();
    const bad = path.join(root, "src", "bad.ts");
    writeFileSync(bad, "// LINT_ERROR\n");
    const r = runHook("lint-edited-file.mjs", edit(root, bad.split("/").join("\\")), root);
    expect(r.status).toBe(2);
  });
});
