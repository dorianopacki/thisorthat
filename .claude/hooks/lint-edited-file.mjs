#!/usr/bin/env node
// PostToolUse (Write|Edit): lint only the file the agent just edited, in its own checkout.
// No --fix: rewriting the file would make the agent's next Edit fail with "modified since read".
import { LINT_EXTS, block, editedFile, readPayload, registerRoot, runBin } from "./lib.mjs";

const payload = readPayload();
const target = editedFile(payload, LINT_EXTS);
if (!target) process.exit(0);
registerRoot(payload, target.root);

const res = runBin(target.root, "eslint", "bin/eslint.js", ["--quiet", "--no-warn-ignored", target.file]);
if (!res.ok) block(`ESLint reported errors in ${target.rel}:\n${res.output}`);
process.exit(0);
