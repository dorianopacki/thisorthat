// Shared helpers for the Claude Code hooks in this directory.
// Node instead of bash + jq: jq is not installed on the Windows dev machine.
// Signal protocol (Claude Code): exit 2 + stderr reaches the agent; exit 0 = clean or
// nothing to check; any other exit only shows "hook error" to the user.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Extensions ESLint covers in this repo (eslint.config.js: JS defaults, typescript-eslint,
// react on js/jsx/ts/tsx, eslint-plugin-astro on .astro).
export const LINT_EXTS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts", ".astro"]);

// Output is read by a model, not a terminal.
const PLAIN_ENV = { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" };
const MAX_OUTPUT = 6000;

export function readPayload() {
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function git(cwd, args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function toplevel(dir) {
  return git(dir, ["rev-parse", "--show-toplevel"]);
}

export function commonDir(dir) {
  return git(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
}

// Run a package's own bin with this node, from the checkout's node_modules. No npx: a tool
// that is not installed must fail visibly, never resolve to a download or a silent pass.
export function runBin(root, pkg, binRel, args) {
  const bin = path.join(root, "node_modules", pkg, binRel);
  if (!existsSync(bin)) {
    return { ok: false, output: `${pkg} is not installed in ${root} (missing ${bin}). Run npm ci.` };
  }
  const r = spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    encoding: "utf8",
    env: PLAIN_ENV,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
  // astro check colours its diagnostics even with NO_COLOR set; strip ANSI escapes.
  // eslint-disable-next-line no-control-regex
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`.replace(/\x1b\[[0-9;]*m/g, "").trim();
  if (r.error) return { ok: false, output: `${pkg} did not run: ${r.error.message}` };
  return { ok: r.status === 0, output };
}

export function clip(text) {
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n… (output truncated)` : text;
}

// Report to the agent: stderr + exit 2 is the only channel Claude reads for these events.
export function block(message) {
  process.stderr.write(`${clip(message)}\n`);
  process.exit(2);
}

// Resolve the edited file and its checkout. Returns null when there is nothing to check:
// no path, uncovered type, deleted file, or a file of another repository (~/.claude, …).
export function editedFile(payload, exts) {
  const input = payload.tool_input && typeof payload.tool_input === "object" ? payload.tool_input : {};
  const raw = input.file_path ?? input.notebook_path;
  if (typeof raw !== "string" || raw === "") return null;
  const cwd = typeof payload.cwd === "string" && payload.cwd !== "" ? payload.cwd : process.cwd();
  const file = path.resolve(cwd, raw);
  if (!exts.has(path.extname(file).toLowerCase()) || !existsSync(file)) return null;

  // Checkout of the edited file, not $CLAUDE_PROJECT_DIR (stale after EnterWorktree).
  const root = toplevel(path.dirname(file));
  if (!root) return null;
  const repo = commonDir(root);
  if (!repo || repo !== commonDir(cwd)) return null;
  return { file, root, rel: path.relative(root, file).split(path.sep).join("/") };
}

function registryPath(payload) {
  const sid = typeof payload.session_id === "string" ? payload.session_id.replace(/[^A-Za-z0-9_-]/g, "") : "";
  return sid ? path.join(os.tmpdir(), "claude-hooks", `${sid}.roots`) : null;
}

// Remember the checkout so the Stop hook sweeps it even when it is not the session cwd.
export function registerRoot(payload, root) {
  const reg = registryPath(payload);
  if (!reg) return;
  try {
    mkdirSync(path.dirname(reg), { recursive: true });
    appendFileSync(reg, `${root}\n`);
  } catch {
    // Registry is an optimisation for sibling worktrees; the session cwd is always swept.
  }
}

export function registeredRoots(payload) {
  const reg = registryPath(payload);
  if (!reg || !existsSync(reg)) return [];
  return readFileSync(reg, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export function clearRegistry(payload) {
  const reg = registryPath(payload);
  if (!reg) return;
  try {
    writeFileSync(reg, "");
  } catch {
    // Nothing to clear.
  }
}
