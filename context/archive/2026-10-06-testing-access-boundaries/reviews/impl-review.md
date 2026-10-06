<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Test Rollout Phase 1 — Access Boundaries

- **Plan**: context/changes/testing-access-boundaries/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-10-06
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Success criteria were re-run on 2026-10-06 and all pass:
- `test:unit`: 35/35.
- `test:http` against a fresh preview: 87/87.
- `supabase test db`: 136 tests in 6 files.
- `smoke`: 8/8.
- `lint`: 0 errors; the 2 warnings are in the generated `worker-configuration.d.ts`.
- `astro check` and `build` both pass.
- PR #23: CI `smoke` and `verify` are green.

## Findings

### F1 — The route classification guard does not block a production deploy

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/deploy.yml:13-27; src/lib/route-access.ts:29
- **Detail**: `requiresAuthor` treats unknown patterns as public, as decided in the plan (no default-deny). The only guard against an unclassified author page is `tests/unit/route-access.test.ts`, and only `ci.yml` runs it. `deploy-production` depends only on `deploy.yml` → `verify`, which runs lint, check and build but not `test:unit`. A push to `main` can therefore ship an unclassified author page unprotected, unless branch protection requires the `ci.yml` `smoke` job.
- **Fix**: Add `- run: npm run test:unit` to the `verify` job in `deploy.yml`, after `astro check`.
  - Strength: The unit suite needs no server and runs in about 1 s. It blocks the deploy itself, not just the PR, without reopening the default-deny decision.
  - Tradeoff: The unit suite runs twice per PR (in `verify` and in `smoke`), which costs about a second.
  - Confidence: HIGH — `deploy-production` has `needs: verify` (deploy.yml:30).
  - Blind spot: Branch protection on `main` is unverified. If the `smoke` job is already required, this is defence in depth.
- **Decision**: SKIPPED

### F2 — The classification guard only sees `.astro` and `.ts` files

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/unit/route-access.test.ts:7
- **Detail**: `ROUTE_FILE = /\.(astro|ts)$/`. Astro also routes `.js`, `.mjs`, `.md`, `.mdx` and `.html` files in `src/pages`. A `src/pages/api/studies/[id]/export.js` would escape the "every file is classified" test and be served publicly (see F1).
- **Fix**: Widen the regex to `/\.(astro|ts|js|mjs|md|mdx|html)$/`, and skip `_`-prefixed files and directories, which Astro does not route.
- **Decision**: FIXED

### F3 — The HTTP test client has no request timeout

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/http/client.ts:66-88
- **Detail**: `send()` never sets a socket timeout. A stalled server fails the test only at the 30 s `testTimeout`, the request stays pending in the worker, and the error doesn't say which path hung.
- **Fix**: Add `req.setTimeout(10_000, () => req.destroy(new Error(\`timeout ${method} ${path}\`)))` in `send()`.
- **Decision**: FIXED

### F4 — CI: a smoke failure hides the new suites, and the readiness wait never fails

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/ci.yml:37-44
- **Detail**: Three related problems in the `smoke` job:
  - `test:unit` runs after smoke, so a smoke failure skips it, even though it needs no server.
  - The readiness loop (`for i in $(seq 1 60) … && break`) falls through silently when the preview never comes up.
  - The preview is started with `&` inside the smoke step and is implicitly reused by the `test:http` step.
- **Fix**: Move `npm run test:unit` before `npm run build`, and make the readiness loop exit 1 after 60 tries.
- **Decision**: FIXED

### F5 — The local auth rate limit makes repeated HTTP runs fail with a misleading error

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/config.toml:190; tests/http/client.ts (signUpAndSignIn)
- **Detail**: The local auth limit is `sign_in_sign_ups = 30` per 5 min per IP, and one full run makes about 11 auth calls (smoke plus both HTTP suites). About three local runs within 5 minutes trip the limit. `beforeAll` then throws "signup: expected 302 …", which looks like a regression.
- **Fix**: Add one line to test-plan §6.2 "Gotchas" naming the rate limit. The thrown message already includes the status code, so a 429 is visible.
- **Decision**: FIXED (Gotchas line added to test-plan §6.2)

### F6 — Server islands would bypass the route map

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/route-access.ts:1-4
- **Detail**: Astro adds `/_server-islands/[name]` only once a component uses `server:defer`. An author-only island would be served under that non-author pattern, and the file-based guard can't see it. This is not exploitable today, because there are no server islands.
- **Fix**: Add one line to the `route-access.ts` header comment: "`server:defer` components bypass this map (`/_server-islands/[name]`); they must check `Astro.locals.user` themselves."
- **Decision**: FIXED

### F7 — `describeResponse` is duplicated in both HTTP suites

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/http/route-access.test.ts:66; tests/http/author-isolation.test.ts:40
- **Detail**: The helper is identical in both files, while `tests/http/client.ts` already exports the sibling helper `redirectTarget`.
- **Fix**: Export `describeResponse` from `tests/http/client.ts` and import it in both suites.
- **Decision**: FIXED

### F8 — The plan's shared Phase 2/3 fixture was implemented as two separate fixtures

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: tests/http/route-access.test.ts:173-177; tests/http/author-isolation.test.ts:20-38
- **Detail**: Phase 2 said the started-study fixture would be "shared with phase 3". Each suite instead builds its own fixture from the shared helpers in `client.ts`. That is reasonable, since Vitest isolates files, but the deviation is undocumented.
- **Fix**: No code change. Accept as is; this report documents it.
- **Decision**: ACCEPTED — per-suite fixtures from shared client.ts helpers; Vitest isolates files
