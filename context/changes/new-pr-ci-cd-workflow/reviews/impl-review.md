<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Consolidated PR Validation and Gated Deploy

- **Plan**: context/changes/new-pr-ci-cd-workflow/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-10-07
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS (1 observation) |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS (1 observation) |
| Success Criteria | PASS (1 observation) |

## Evidence

- `.github/workflows/ci.yml` matches the Phase 1 contract: jobs `static`, `tests`, `ci-passed` (`if: always()`, explicit result check), `deploy-production` and `preview-upload` both `needs: ci-passed`; PR-only `cancel-in-progress`; `node-version-file: .nvmrc` everywhere; `npx supabase` for start/status/test db/stop; `deploy.yml` deleted. Job bodies moved verbatim (only `for i` → `for _`).
- GitHub runs: PR #26 throwaway, commit 737f721 → `tests` failure, `ci-passed` failure, `preview-upload` and `deploy-production` skipped; cce5fbc cancelled by the next push; 38b8e24 green. Main run 37876b0 (PR #25 merge) → `ci-passed` success at 13:04:59, `deploy-production` started 13:05:08.
- Local re-run 2026-10-07: YAML parse OK, only `ci.yml` present, no floating versions, no old-name refs, no `master` in README, prettier clean, `npm run lint && npx astro check && npm run build` exit 0. actionlint not re-run locally (Docker daemon not running); the Phase 1 CI runs were green.

## Findings

### F1 — Phase 2 edits beyond the planned rows and paragraphs

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/foundation/test-plan.md (whole file), AGENTS.md:46
- **Detail**: The plan said "Do not touch other rows or sections" of test-plan.md, but commit 4471239 reformats the whole file with prettier (~90 lines: `*x*` → `_x_`, table padding in §2 and others). It also rewrites the AGENTS.md "Commits & Pull Requests" line (drops "not yet a git repository", `master` → `main`), which the plan did not list. Both are benign, the commit message mentions them, and the reformat was needed to pass the plan's own criterion 2.3 (`prettier --check` on test-plan.md). The plan was internally inconsistent; the change itself is not.
- **Fix**: Add a one-line addendum under Phase 2 in plan.md recording the prettier reformat (required by 2.3) and the AGENTS.md Commits & PRs fix.
- **Decision**: FIXED — addendum added under Phase 2 in plan.md

### F2 — Manual item 2.4 carries the wrong SHA as evidence

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/new-pr-ci-cd-workflow/plan.md (Progress 2.4)
- **Detail**: 2.4 ("Main run deploys only after ci-passed…") is stamped `— 4471239`, but that docs commit is on the local branch `ci/new-pr-ci-cd-workflow-docs` and has no `main` run. The real evidence is the `main` run for 37876b0 (PR #25 merge), where `deploy-production` started after `ci-passed` succeeded. The check passed; the annotation points at the wrong commit.
- **Fix**: Change the 2.4 suffix to `— verified on main run for 37876b0`.
- **Decision**: FIXED — 2.4 suffix now cites main run for 37876b0

### F3 — Comment says the Supabase CLI is pinned in package.json

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: .github/workflows/ci.yml:43
- **Detail**: The comment reads "Also installs the Supabase CLI pinned in package.json". `package.json` declares the range `^2.23.4`; the actual pin (2.117.0) comes from `package-lock.json` through `npm ci`. Someone bumping the CLI could edit `package.json` and expect CI to follow without regenerating the lockfile.
- **Fix**: Reword to "pinned by package-lock.json".
- **Decision**: FIXED — comment now says "pinned by package-lock.json"

### F4 — §5 unit + HTTP integration row still reads "required after §3 Phase 1"

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md §5 (unit + HTTP integration row), §3 row 1
- **Detail**: Rollout Phase 1 (testing-access-boundaries) is archived and its suites already run in `ci.yml` `tests` (`npm run test:unit`, `npm run test:http`). The §5 row still says `local + CI` / `required after §3 Phase 1`, and the §3 row 1 status still says `researched`. The plan deliberately limited §5 edits to three rows, so this is a plan gap, not drift. It leaves the quality contract slightly behind CI.
- **Fix**: Re-run `/10x-test-plan` so it marks §3 Phase 1 `complete`; in the same pass set the §5 row to `local + CI (ci.yml tests)` / `required`.
- **Decision**: FIXED — §5 row now "local + CI (ci.yml tests) / required"; §3 row 1 status left for /10x-test-plan
