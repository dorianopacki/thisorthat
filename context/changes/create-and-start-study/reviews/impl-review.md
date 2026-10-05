<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Create and Start a Text Study

- **Plan**: context/changes/create-and-start-study/plan.md
- **Scope**: Full plan (completed phases; Phase 4 pending production smoke 4.4)
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-05
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

Evidence: drift check 21 MATCH / 0 DRIFT / 0 MISSING / 5 benign EXTRA (2 extra pgTAP assertions, bfcache reset + wizard counter/hint, 22P02→404 on page and start endpoint, Polish plural in confirmation). Automated: `supabase test db` 94/94, `db lint` clean, `npm run lint` 0 errors, `astro check` 0 errors, `build` OK. Manual rows 1.5, 2.2–2.5, 3.3–3.5 confirmed by the user in session. Security, anonymity (`used` never selected), redirects, CSRF, races and partial writes reviewed clean.

## Findings

### F1 — Line breaks counted differently on client and server

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/studies/index.ts:49 (client: src/components/studies/StudyWizard.tsx:76-80)
- **Detail**: The wizard validates `textarea.value` (LF), but a native form POST sends line breaks as CRLF. A 1990-character variant with 15 line breaks passes the client check and is rejected by the server as over 2000; multi-line variants that pass are stored with `\r\n`.
- **Fix**: Normalize `\r\n?` to `\n` for the title and each variant in the endpoint before trimming and validating.
- **Decision**: FIXED — endpoint normalizes CRLF to LF before trim/validate

### F2 — Start endpoint answers a blank 404 instead of redirecting

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/studies/[id]/start.ts:22
- **Detail**: On P0002/22P02 the endpoint returns `new Response(null, { status: 404 })` — a blank browser page with no way back (e.g. the study was deleted in another tab). AGENTS.md: form endpoints respond with redirects. This follows the plan (a plan-review fix), so the plan was too literal here.
- **Fix**: `return context.redirect(studyUrl)`; `/studies/[id]` already renders a 404 with a body and a link back.
- **Decision**: FIXED — P0002/22P02 now redirect to /studies/<id> (page renders the 404)

### F3 — Whitespace-only variants via direct RPC

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261005075735_create_and_start_study.sql:55-61
- **Detail**: `btrim()` strips spaces only, so a direct PostgREST call with variants like `E'\n'` passes both the blank check and the table check. The web endpoint is unaffected (JS `.trim()` runs first).
- **Fix**: In a later forward migration, check `btrim(content, E' \t\r\n')`; or accept as known limit.
- **Decision**: SKIPPED — reachable only via direct API call; no UI path

### F4 — Some create_study error paths untested

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/create_and_start_study.test.sql
- **Detail**: Tests cover N limits but not a blank title, a title over 200, a variant over 2000 (23514) or a null `p_variants` (22023).
- **Fix**: Add 3–4 `throws_ok` cases and bump `plan(n)`.
- **Decision**: FIXED — 4 throws_ok cases added (blank title, 201-char title, 2001-char variant, null variants); plan(32)

### F5 — Protected-route prefix also matches unrelated paths

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:4,18
- **Detail**: `startsWith("/studies")` also protects e.g. `/studies-public`; today it only over-protects, but could surprise a future public route.
- **Fix**: Match `path === route || path.startsWith(route + "/")`.
- **Decision**: FIXED — exact-or-subpath route matching

### F6 — Dashboard study list is unbounded

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:11
- **Detail**: One RLS-scoped query without `.limit()`; fine at MVP scale, and S-05 replaces this list.
- **Fix**: Leave to S-05 (full dashboard), or add `.limit(50)` now.
- **Decision**: SKIPPED — left to S-05 (full dashboard)
