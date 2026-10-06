# Consolidated PR Validation and Gated Deploy Implementation Plan

## Overview

Merge the two GitHub Actions workflows (`ci.yml`, `deploy.yml`) into one workflow. In it, a single aggregate `ci-passed` job depends on every validation job, and both deploy jobs depend on `ci-passed`. Add cancellation of superseded PR runs, pin Node and the Supabase CLI to the versions the repo already declares, and update the docs that name the old jobs. The goal: a failing test can no longer reach production, and "is this PR green?" has one answer.

## Current State Analysis

From `context/changes/new-pr-ci-cd-workflow/research.md`:

- `ci.yml` (job `smoke`) runs unit tests, local Supabase + pgTAP, build, HTTP smoke and HTTP integration on PR and push to `main` (`.github/workflows/ci.yml:3-48`).
- `deploy.yml` (job `verify`) runs `astro sync`, lint, `astro check` and build. `deploy-production` (push to main) and `preview-upload` (same-repo PRs) have `needs: verify` only (`.github/workflows/deploy.yml:13-75`).
- `needs:` cannot cross workflow files, so a push to `main` can deploy while `smoke` fails (`deploy.yml:29-31`).
- Branch protection and rulesets return HTTP 403 on this private free-plan repo. Merge discipline is by convention.
- Supabase CLI is `version: latest` in CI (`ci.yml:22-24`). The lockfile resolves the `supabase` devDependency to `2.117.0` (`package-lock.json`, `package.json:57`), and `npm ci` puts it at `node_modules/.bin/supabase`. Node is `22` in all 4 jobs while `.nvmrc` is `22.14.0`.
- The only `concurrency` block is on `deploy-production` (`deploy.yml:32-35`).
- Docs naming the old layout: `context/foundation/test-plan.md:106-108` (§5), `AGENTS.md:42`, `README.md:185-190`. The README section is already stale: it says `master`, describes a `ci` job and says secrets are needed for the build.

## Desired End State

- One workflow file, `.github/workflows/ci.yml` (name `CI`), with jobs `static`, `tests`, `ci-passed`, `deploy-production`, `preview-upload`. `deploy.yml` no longer exists.
- `ci-passed` succeeds only when `static` and `tests` both succeeded. Both deploy jobs have `needs: ci-passed`, so any failed or cancelled validation job skips deploys.
- A new push to a PR branch cancels that PR's in-flight run. Runs on `main` are never cancelled mid-flight.
- CI reads Node from `.nvmrc` and runs the Supabase CLI from the lockfile (`npx supabase`). No `latest` floats remain.
- test-plan §5, AGENTS.md and README describe the new layout. AGENTS.md states the merge convention: merge only when `gh pr checks` shows `ci-passed` green.

Verify: actionlint and a YAML parse pass locally. On the PR for this change, `ci-passed` is green, `preview-upload` ran after it and `deploy-production` was skipped. After merge, the `main` run deploys only after `ci-passed`.

### Key Discoveries:

- `ci.yml:12` documents the split. The new file replaces that comment.
- `deploy.yml:25-26`: the production build needs no Supabase values (runtime `astro:env` secrets). The deploy jobs must keep building in a clean checkout, not reuse the `tests` job's build, which writes `.env`/`.dev.vars` from the local stack (`ci.yml:33-37`).
- `deploy.yml:55-56`: fork PRs get no secrets, so the `preview-upload` same-repo guard must be kept.
- `deploy.yml:74`: no `#` in the wrangler-action command. Keep the `PR-<n>` message format.
- AGENTS.md already tells developers to use `npx supabase test db`, so CI using `npx supabase` matches local practice.

## What We're NOT Doing

- Migration-safety gate (fresh reset, `supabase db lint`, type drift). Owned by test-plan §3 Phase 2.
- e2e on the critical loop. Owned by test-plan §3 Phase 4.
- Making the repo public or upgrading the plan to get required status checks. Enforcement stays convention-based. `ci-passed` is the single check name to require if that changes.
- Sharing build artifacts between jobs to remove the duplicate `npm ci`/build. Deploy jobs keep a clean build on purpose (see Key Discoveries).
- Changing wrangler version, Cloudflare environments, secrets, or `wrangler.jsonc`.
- Editing historical references in `context/foundation/roadmap.md` or archived plans.

## Implementation Approach

Rewrite `ci.yml` in place and delete `deploy.yml` in the same commit, so there is never a moment with two deploy paths or none. Job bodies move over mostly verbatim. The only behavioural changes are the gate job, the `needs:` edges, concurrency and the version sources. Docs follow in a second phase once the PR run proves the new graph.

## Critical Implementation Details

- **Gate job must not be skippable into "success".** If `ci-passed` has no `if: always()`, a failed `needs` job makes it *skipped*, and a skipped check counts as passing for humans reading `gh pr checks`. The gate must run always and fail explicitly unless every needed result is `success`.
- **Concurrency scope.** Use a workflow-level group keyed on the ref and set `cancel-in-progress` only for `pull_request` events. On `main`, a newer push may still replace a *pending* (not yet started) run in the same group. That is acceptable, because the newest commit deploys and includes the skipped one. Keep the existing job-level `deploy-production` concurrency (`cancel-in-progress: false`).
- **Supabase CLI via npm.** `npx supabase` must come after `npm ci` in `tests`. If the npm package's binary download fails on the runner, the fallback is `supabase/setup-cli@v1` with `version: 2.117.0`, plus a comment to bump it with `package.json`.

## Phase 1: Consolidated workflow

### Overview

One workflow with validation → gate → deploy, PR concurrency, and repo-sourced versions. `deploy.yml` removed.

### Changes Required:

#### 1. Unified workflow

**File**: `.github/workflows/ci.yml`

**Intent**: Replace the single `smoke` job with the full validation and deploy graph, so a deploy depends on every check.

**Contract**:
- `name: CI`. Triggers unchanged (`push` and `pull_request` on `main`). Workflow `permissions: contents: read`.
- Workflow `concurrency`: group `${{ github.workflow }}-${{ github.ref }}`, `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`.
- Every `actions/setup-node@v4` step uses `node-version-file: .nvmrc` and `cache: npm`, with no `node-version: 22`.
- Job `static` = current `deploy.yml` `verify` steps (checkout, setup-node, `npm ci`, `npx astro sync`, `npm run lint`, `npx astro check`, `npm run build`).
- Job `tests` = current `ci.yml` `smoke` steps in the same order. The `supabase/setup-cli` step is removed, and every `supabase …` invocation becomes `npx supabase …` (start, status, test db, stop). The `if: always()` stop step is kept.
- Job `ci-passed`: `needs: [static, tests]`, runs always, fails unless both results are `success`.
- Job `deploy-production` = current one, with `needs: ci-passed` and the same `if`, `concurrency`, `environment` and steps.
- Job `preview-upload` = current one, with `needs: ci-passed` and the same same-repo `if` and steps.

```yaml
  ci-passed:
    if: always()
    needs: [static, tests]
    runs-on: ubuntu-latest
    steps:
      - name: All validation jobs succeeded
        run: |
          [ "${{ needs.static.result }}" = success ] && [ "${{ needs.tests.result }}" = success ] \
            || { echo "static=${{ needs.static.result }} tests=${{ needs.tests.result }}"; exit 1; }
```

Deploy jobs that `need` an always-run gate are still skipped when the gate fails, because a failed need short-circuits jobs without `always()`. Do not add `always()` to the deploy jobs.

#### 2. Remove the second workflow

**File**: `.github/workflows/deploy.yml`

**Intent**: Delete it. Its jobs now live in `ci.yml`, and keeping it would trigger a second, ungated production deploy.

**Contract**: The file no longer exists. `.github/workflows/` contains only `ci.yml`.

### Success Criteria:

#### Automated Verification:

- Workflow parses as YAML: `npx js-yaml .github/workflows/ci.yml > /dev/null`
- actionlint reports no errors: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color`
- Only one workflow file remains: `ls .github/workflows` prints `ci.yml` only
- No floating versions remain: `grep -nE "version: latest|node-version: 22" .github/workflows/ci.yml` returns nothing
- Local gates still pass: `npm run lint && npx astro check && npm run build`

#### Manual Verification:

- On the PR for this change, `gh pr checks` lists `static`, `tests`, `ci-passed`, `preview-upload` as pass and `deploy-production` as skipped. No separate `Deploy` workflow run appears.
- Pushing a second commit to the PR while a run is in progress cancels the earlier run.
- Gate negative check: in a throwaway commit on the PR, make one test fail (e.g. a deliberately failing assertion). `ci-passed` fails and `preview-upload` is skipped. Then revert the commit.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Docs and merge convention

### Overview

Make the quality contract and contributor docs describe the consolidated workflow and the `ci-passed` merge convention. Confirm the first `main` deploy runs through the gate.

### Changes Required:

#### 1. Quality gates table

**File**: `context/foundation/test-plan.md`

**Intent**: §5 rows must point to the CI steps that actually exist (test-plan rule: required gates map to actual CI steps).

**Contract**: In §5 (lines 106-108), the Where column becomes `local + CI (ci.yml static)` for lint/typecheck/build, `local + CI (ci.yml tests)` for pgTAP, and `CI (ci.yml tests)` for HTTP smoke. Do not touch other rows or sections. If there is a dated "last updated" marker in the frontmatter, bump it.

#### 2. Agent onboarding

**File**: `AGENTS.md`

**Intent**: Keep the CI pointer accurate and state the merge rule that replaces server-side branch protection.

**Contract**: In the Testing paragraph (line 42), keep the `@.github/workflows/ci.yml` reference and add one sentence: CI's `ci-passed` job aggregates all checks and gates deploys; merge a PR only when `gh pr checks` shows `ci-passed` passing (branch protection is unavailable on this plan).

#### 3. README CI section

**File**: `README.md`

**Intent**: Replace the stale starter text (`master`, `ci` job, build secrets) with the real layout.

**Contract**: `## CI` section (lines 185-190). One workflow on push/PR to `main`. Jobs `static` (lint, `astro check`, build without secrets), `tests` (local Supabase via `npx supabase`, pgTAP, unit, build, smoke and HTTP integration against the preview), `ci-passed` (gate), `preview-upload` (same-repo PRs) and `deploy-production` (push to `main`, needs `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`).

### Success Criteria:

#### Automated Verification:

- No live doc references the removed workflow or old job names: `grep -nE "deploy\.yml|ci\.yml smoke|verify\)" AGENTS.md README.md context/foundation/test-plan.md` returns nothing
- README no longer mentions `master`: `grep -n "master" README.md` returns nothing
- Formatting is clean: `npx prettier --check AGENTS.md README.md context/foundation/test-plan.md`

#### Manual Verification:

- After the PR is merged, the `main` run in the Actions tab shows `deploy-production` starting only after `ci-passed` succeeded, and the production URL serves the new version.
- §5 of test-plan.md reads correctly alongside §3 (Phase 2/4 rows still say "required after §3 Phase N").

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- None added. This change touches CI configuration and docs only. Existing unit, HTTP and pgTAP suites run unchanged inside `tests`.

### Integration Tests:

- The PR run of this change is the integration test. The full graph runs, the gate passes, the preview uploads and production deploy is skipped.

### Manual Testing Steps:

1. Open the PR and confirm the check list and skipped `deploy-production` with `gh pr checks`.
2. Push a deliberately failing test commit and confirm `ci-passed` fails and `preview-upload` is skipped. Revert it.
3. Push two commits quickly and confirm the first run is cancelled.
4. Merge and watch the `main` run deploy after `ci-passed`.

## Performance Considerations

`static` and `tests` run in parallel as before, so wall-clock time stays at roughly the slower `tests` job (about 2.5–3 min in recent runs) plus a few seconds for `ci-passed`. PR concurrency reduces wasted runner minutes on rapid pushes.

## Migration Notes

The check names in the GitHub UI change from `CI / smoke` and `Deploy / verify` to `CI / static`, `CI / tests` and `CI / ci-passed`. Nothing requires the old names, since there is no branch protection. Rollback means reverting the Phase 1 commit, which restores both files.

## References

- Related research: `context/changes/new-pr-ci-cd-workflow/research.md`
- Current workflows: `.github/workflows/ci.yml:1-48`, `.github/workflows/deploy.yml:1-75`
- Quality gates: `context/foundation/test-plan.md:102-111`
- Prior CI wiring: `context/archive/2026-10-06-testing-access-boundaries/plan.md:297`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Consolidated workflow

#### Automated

- [x] 1.1 Workflow parses as YAML
- [x] 1.2 actionlint reports no errors
- [x] 1.3 Only one workflow file remains
- [x] 1.4 No floating versions remain
- [x] 1.5 Local gates still pass

#### Manual

- [ ] 1.6 PR checks show static, tests, ci-passed, preview-upload pass and deploy-production skipped
- [ ] 1.7 A second push cancels the in-progress PR run
- [ ] 1.8 Gate negative check: failing test makes ci-passed fail and skips preview-upload

### Phase 2: Docs and merge convention

#### Automated

- [ ] 2.1 No live doc references the removed workflow or old job names
- [ ] 2.2 README no longer mentions master
- [ ] 2.3 Formatting is clean

#### Manual

- [ ] 2.4 Main run deploys only after ci-passed and production serves the new version
- [ ] 2.5 test-plan §5 reads correctly alongside §3
