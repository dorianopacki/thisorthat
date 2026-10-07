---
date: 2026-10-06T14:45:08+02:00
researcher: Claude (Opus 5.5) for dorian.opacki
git_commit: c1488b4602a7fd6e8f8d389ce738ad297399daed
branch: chore/test-plan-and-s03-archive
repository: dorianopacki/thisorthat
topic: "Introduce first GitHub Actions CI/CD workflow to validate new PRs"
tags: [research, ci, github-actions, quality-gates, deploy]
status: complete
last_updated: 2026-10-06
last_updated_by: Claude (Opus 5.5)
---

# Research: Introduce first GitHub Actions CI/CD workflow to validate new PRs

**Date**: 2026-10-06T14:45:08+02:00
**Researcher**: Claude (Opus 5.5) for dorian.opacki
**Git Commit**: c1488b4602a7fd6e8f8d389ce738ad297399daed
**Branch**: chore/test-plan-and-s03-archive
**Repository**: dorianopacki/thisorthat

## Research Question

Introduce the first CI/CD workflow in GitHub Actions to validate new PRs. Before planning:
what PR validation already exists, what it covers, and what gaps remain against
`context/foundation/test-plan.md` §5 Quality Gates?

## Summary

**The premise "first workflow" does not hold.** The repo has two workflows. Both
trigger on `pull_request` to `main` and on `push` to `main`:

- `.github/workflows/ci.yml` (job `smoke`): unit tests, local Supabase + pgTAP, build, HTTP smoke and HTTP integration tests against the built preview.
- `.github/workflows/deploy.yml` (job `verify`): `astro sync`, lint, `astro check`, build. It also runs `deploy-production` (push to main) and `preview-upload` (same-repo PRs).

Both workflows ran green on PR #22, #23 and #24 (`gh run list`, 2026-10-06). So PR
validation exists and works. The useful scope for this change is **hardening and
consolidating** that validation. Greenfield authoring is not needed. The gaps below
are the candidates for that work.

1. **Production deploy is not gated on the test job.** `deploy-production` has `needs: verify` only (`deploy.yml:29-31`). `verify` lives in a different workflow from `smoke`, so a push to `main` can deploy while `ci.yml` smoke is failing.
2. **The required-check setup cannot be enforced server-side on this plan.** The GitHub API returns HTTP 403 "Upgrade to GitHub Pro or make this repository public" for both branch protection and rulesets on `main`. Today a PR with red CI can still be merged. This is a convention, not a guard.
3. **Gate split across two workflows with duplicated setup.** Each of the 4 jobs (`smoke`, `verify`, `deploy-production`, `preview-upload`) runs its own checkout + `setup-node` + `npm ci`, and each runs `npm run build` (`ci.yml:25,38`; `deploy.yml:21,27,45-46,65-66`). A comment documents the split (`ci.yml:12`).
4. **Missing gates that test-plan §5 schedules for later phases.** Migration safety (fresh reset, `supabase db lint`, type drift against `src/lib/database.types.ts`) is "required after §3 Phase 2". e2e on the critical loop is "required after §3 Phase 4" (`test-plan.md:110-111`). Neither appears in the workflows inspected.
5. **Version-pinning drift.** The Supabase CLI is pinned to `latest` in CI (`ci.yml:22-24`) but to `^2.23.4` in `package.json:57`. Node is `22` in all 4 jobs, while `.nvmrc` pins `22.14.0`.
6. **No `concurrency` cancellation for PR runs.** The only `concurrency` block is on `deploy-production` (`deploy.yml:32-35`). A fresh push to a PR does not cancel its superseded CI runs.

## Detailed Findings

### Existing PR validation — `ci.yml`

- Triggers: `push` and `pull_request` on `main` (`.github/workflows/ci.yml:3-7`). Permissions: `contents: read` (`ci.yml:9-10`).
- One job, `smoke` (`ci.yml:14`). Step order:
  - `npm ci` (`:25`).
  - `npm run test:unit` (`:27`). It runs first so a later failure can't hide it (`:26`).
  - `supabase start` with 10 services excluded, then API_URL and ANON_KEY written to `supabase.env` (`:28-31`).
  - `supabase test db` (pgTAP) (`:32`).
  - `.env` and `.dev.vars` written from the local stack (`:33-37`).
  - `npm run build` (`:38`).
  - `npm run preview` on :4321 with a 60-second readiness loop, then `npm run smoke` (`:39-44`).
  - `npm run test:http` (`:45-46`).
  - `supabase stop` under `if: always()` (`:47-48`).
- Scripts invoked: `test:unit` = `vitest run --project unit`, `test:http` = `vitest run --project http`, `smoke` = `node scripts/smoke.mjs` (`package.json:13-15`).

### Existing PR validation and deploy — `deploy.yml`

- Same triggers and permissions (`deploy.yml:3-10`).
- `verify` (`:13-27`): `npm ci`, `npx astro sync`, `npm run lint` (`eslint .`, `package.json:10`), `npx astro check`, `npm run build`. Lint includes formatting, because `eslint-plugin-prettier/recommended` is in the ESLint config (`eslint.config.js:4,92`). There is no separate `prettier --check` step.
- `deploy-production` (`:29-52`): runs only on push to `refs/heads/main`, `needs: verify`, uses the `production` environment, and deploys with `cloudflare/wrangler-action@v3` and wrangler `4.131.1`. It runs `npm ci` and `npm run build` again.
- `preview-upload` (`:54-75`): runs only for same-repo PRs, since fork PRs get no secrets (`:55-56`). It does `versions upload` with no traffic routing (`:67-68`).

### Observed run history (GitHub, read-only)

- `gh run list --limit 12` showed 12 runs, all `success`. They cover PRs #22, #23 and #24 and their merge pushes. Each PR event produced both a `CI` run and a `Deploy` run. Durations: 2m26s–2m53s for CI and 1m45s–2m14s for Deploy.
- Branch protection (`GET /repos/.../branches/main/protection`) and rulesets (`GET /repos/.../rulesets`) both returned 403. The message was "Upgrade to GitHub Pro or make this repository public to enable this feature." The repo is private on a free plan.

### Local-only gates

- `.husky/pre-commit` runs `npx lint-staged`. That runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}` (`package.json:63-70`). This is a local convenience, not a CI substitute (CLAUDE.md, quality gates rules).

### Gate mapping against test-plan §5 (`context/foundation/test-plan.md:102-111`)

| §5 gate | Required? | Current CI step | Status |
| --- | --- | --- | --- |
| lint + typecheck + build | required | `deploy.yml` verify `:23-27` | wired |
| database tests (pgTAP) | required | `ci.yml:32` | wired |
| HTTP smoke against preview | required | `ci.yml:39-44` | wired |
| unit + HTTP integration | required after Phase 1 | `ci.yml:27`, `:45-46` | wired (Phase 1 archived as complete) |
| migration safety (reset, db lint, type drift) | required after Phase 2 | — | not wired; Phase 2 is `not started` (`test-plan.md:75`) |
| e2e on critical loop | required after Phase 4 | — | not wired; Phase 4 is `not started` (`test-plan.md:77`) |

Note: §5 names `deploy.yml verify` as the home of lint/typecheck/build (`test-plan.md:106`). If this change moves or renames that job, it must update §5.

## Code References

- `.github/workflows/ci.yml:3-7` — triggers (PR + push to main)
- `.github/workflows/ci.yml:12` — comment documenting the lint/typecheck/build split into `deploy.yml`
- `.github/workflows/ci.yml:22-24` — Supabase CLI `version: latest`
- `.github/workflows/ci.yml:27-46` — unit, pgTAP, build, smoke, HTTP integration
- `.github/workflows/deploy.yml:13-27` — `verify` job (lint, `astro check`, build)
- `.github/workflows/deploy.yml:29-31` — `deploy-production` `if:` + `needs: verify` (no dependency on `ci.yml`)
- `.github/workflows/deploy.yml:54-56` — `preview-upload` same-repo guard
- `package.json:10,13-15` — lint/smoke/test scripts; there is no `typecheck` script, so CI calls `npx astro check` directly
- `package.json:57` — `supabase` devDependency `^2.23.4`
- `.nvmrc` — `22.14.0`
- `context/foundation/test-plan.md:102-111` — §5 Quality Gates

## Architecture Insights

- Validation is split by concern, not by trigger. `ci.yml` holds everything that needs a running Supabase stack. `deploy.yml` holds static checks and the deploy jobs. GitHub Actions `needs:` cannot cross workflow files. That is the mechanism behind gap 1.
- The CI `.env` is built from the local stack (`ci.yml:33-37`). `verify` builds without any Supabase values, because the app reads them as `astro:env` server secrets at runtime (`deploy.yml:25-26`).
- Server-side merge enforcement is unavailable on the current plan (403). The options are: make the repo public, upgrade the plan, or accept convention-only enforcement. If the latter, a single aggregate check job makes "is the PR green?" a one-line answer for humans and agents (e.g. `gh pr checks`).

## Historical Context (from prior changes)

- `context/archive/2026-10-02-study-data-model/plan.md:12,30,173,306` added `supabase test db` to `ci.yml`, reusing the stack the smoke job already started. Supported by current `ci.yml:32`.
- `context/archive/2026-10-05-create-and-start-study/plan.md:282`, `.../2026-10-05-one-time-link-voting/plan.md:226` and `.../2026-10-06-live-results-and-comments/plan.md:171` say: "CI (`ci.yml`, `deploy.yml` verify job) must be green; merging deploys to Cloudflare Workers." Partially supported. Green CI is the convention. Nothing on GitHub enforces it (403 above), and the merge deploy depends only on `verify`.
- `context/archive/2026-10-06-testing-access-boundaries/plan.md:14,297,441` (commit `e5c9ff0`) wired `test:unit` and `test:http` into `ci.yml`. Its line 14 says "`package.json` has no vitest". That is stale today (`package.json:60` has `vitest`), but it was true before that change.
- `git log -- .github`: the workflows date from `8983d62` (initial commit). The deploy workflow was added in `bf2b76b` and adjusted in `137f5e6`.

## Related Research

- `context/archive/2026-10-06-testing-access-boundaries/research.md` — Phase 1 test-rollout research (CI host for HTTP tests).

## Open Questions (product choices for /10x-plan)

1. **Scope.** Pick one: (a) harden what exists (gate the deploy on all checks, add concurrency, align pins), (b) consolidate into one PR-validation workflow plus a deploy workflow, or (c) also pull test-plan Phase 2's migration-safety gate forward. Option (c) overlaps the §3 Phase 2 rollout row and should go through `/10x-test-plan` rather than this change.
2. **Merge enforcement.** Pick one: go public or upgrade to Pro to get required checks, or keep enforcement by convention. Only the first gives server-side blocking.
3. **Deploy gating mechanism.** Pick one: merge the jobs into one workflow so `needs:` covers tests, or trigger the deploy with `workflow_run` on CI success. These trade off differently on visibility and on re-run behavior.
4. **Pin policy.** Pick one: pin the Supabase CLI to a fixed version and match `package.json`, and read Node from `.nvmrc` (`node-version-file`), or keep floating versions.
