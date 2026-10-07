# Consolidated PR Validation and Gated Deploy — Plan Brief

> Full plan: `context/changes/new-pr-ci-cd-workflow/plan.md`
> Research: `context/changes/new-pr-ci-cd-workflow/research.md`

## What & Why

PRs are already validated by two GitHub Actions workflows. But the production deploy waits only for lint/typecheck/build, not for the database, smoke or HTTP tests. That is because `needs:` cannot cross workflow files. This change merges the validation and deploy into one workflow behind a single `ci-passed` gate, so a failing test can never reach production and "is this PR green?" has one answer.

## Starting Point

`ci.yml` (`smoke`: unit, pgTAP, build, smoke, HTTP integration) and `deploy.yml` (`verify`, `deploy-production`, `preview-upload`) both run on PR and on push to `main`. Branch protection returns 403 on this private free-plan repo. The Supabase CLI floats on `latest` and Node on `22`.

## Desired End State

One `CI` workflow runs `static` and `tests` in parallel. They feed `ci-passed`, and both deploy jobs depend on it. Superseded PR runs are cancelled. Node comes from `.nvmrc` and the Supabase CLI from the lockfile. Docs name the new jobs, and AGENTS.md says to merge only when `gh pr checks` shows `ci-passed` green.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Premise | Harden existing CI, not a "first" workflow | Two workflows already validate every PR | Research |
| Scope | Consolidate + harden | Fixes the deploy-without-tests gap structurally | Plan |
| Deploy gating | Same workflow, `needs: ci-passed` | Native and visible in one run graph | Plan |
| Merge enforcement | Convention + aggregate `ci-passed` job | Branch protection is 403 on this plan; one check name to require later | Plan |
| Pins | Node from `.nvmrc`, Supabase CLI via `npx supabase` (lockfile 2.117.0) | CI matches local; no surprise breakage | Plan |
| Migration-safety / e2e gates | Excluded | Owned by test-plan §3 Phases 2 and 4 | Research |
| Duplicate builds | Kept | Deploy must build clean, without the test job's local `.env` | Plan |

## Scope

**In scope:**
- Rewrite `.github/workflows/ci.yml` with the five jobs, workflow concurrency and pins, and delete `deploy.yml`
- Update test-plan §5 rows, the AGENTS.md CI sentence and merge rule, and the README `## CI` section

**Out of scope:**
- Migration-safety and e2e gates
- Repo visibility or plan changes, and branch protection
- Artifact sharing between jobs, and wrangler/Cloudflare config changes

## Architecture / Approach

```
static ─┐
        ├─► ci-passed (always; fails unless both success) ─┬─► deploy-production (push to main)
tests ──┘                                                  └─► preview-upload (same-repo PR)
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Consolidated workflow | One gated CI/deploy workflow; `deploy.yml` removed | A gate written without `always()` turns failures into "skipped"; the `npx supabase` binary download fails on the runner (fallback: pinned setup-cli) |
| 2. Docs and merge convention | §5, AGENTS.md and README match reality; first gated `main` deploy observed | Missing a stale reference |

**Prerequisites:** Docker for local actionlint; push access to open a PR. **Estimated effort:** ~1–2 hours including PR round-trips.
