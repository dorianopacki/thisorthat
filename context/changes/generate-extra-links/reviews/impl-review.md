<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Generate Extra Links (S-07)

- **Plan**: context/changes/generate-extra-links/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-10-16
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Success criteria, re-run during the review: pgTAP 315/315, HTTP 190/190, unit 97/97, lint 0 errors, build OK. All 8 manual rows were confirmed by the user during `/10x-implement`.

## Findings

### F1 — Production needs the migration before the Worker deploy

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/studies/[id].astro:76-78
- **Detail**: The study page now selects `position` and orders by it. CI does not apply migrations, and production is pushed by hand. If the Worker ships before `20261016181615_generate_extra_links.sql` is applied, PostgREST rejects the unknown column, and every started study's page throws "Nie udało się wczytać linków badania."
- **Fix**: Add a "run `db push` before deploying" step to the PR description and apply it at release time.
- **Decision**: FIXED — deploy-order step queued in follow-ups/review-fixes.md for the PR description

### F2 — Over-cap request gets a fixed "max 100" message

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/studies/[id]/links.ts:44
- **Detail**: On `23514`, the endpoint answers "Badanie może mieć najwyżej 100 linków." For example, a study with 2 links and a request for 99 does not learn that 1–98 is allowed. The `countMessage()` helper already builds "Podaj liczbę linków od 1 do X." and falls back to the limit message when nothing is left.
- **Fix**: On `23514`, return `fail(await countMessage())`.
- **Decision**: FIXED — 23514 now answers countMessage(); HTTP cap test updated, plus a new 'at 100 links → limit message' test

### F3 — Endpoint validates `count` before ownership and status

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/api/studies/[id]/links.ts:32-34
- **Detail**: The database checks in the order P0002 → 55000 → 22023, but the endpoint rejects a bad `count` before calling the RPC. With bad input:
  - a closed study gets the count message instead of the closed message;
  - a non-owner gets `?error=` instead of the plan's plain redirect.

  Nothing leaks, because RLS hides the count and the page is a 404. Only hand-crafted requests are affected.

- **Fix**: On a parse failure, call the RPC with `p_count: 0`, so the database's order decides the answer. `22023` then maps to `countMessage()`.
- **Decision**: FIXED — an unusable count goes to the RPC as 0, so the database's P0002 → 55000 → 22023 order decides; HTTP tests for a bad count on a closed and on a foreign study

### F4 — No HTTP test that `?added` is ignored on a closed study

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: tests/http/generate-extra-links.test.ts
- **Detail**: The page shows the "Nowe linki" block only while the study is active (`[id].astro:100`), but no test proves it.
- **Fix**: In the closed-study describe, add a check that `GET /studies/<id>?added=1` shows no "Nowe linki".
- **Decision**: FIXED — HTTP test: a closed study ignores ?added=

### F5 — Backfill is not covered by pgTAP

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/migrations/20261016181615_generate_extra_links.sql:40-48
- **Detail**: The table is empty when the migration runs in tests, so the "contiguous positions" assertion only covers rows numbered by the trigger. The backfill was checked by hand during Phase 1: two studies were seeded at the previous migration, `migration up` gave {1..5} and {1..3} in id order.
- **Fix**: Accept. After `db push`, spot-check production with `select study_id, min(position), max(position), count(*) from study_links group by 1`.
- **Decision**: ACCEPTED — production spot-check query queued in follow-ups/review-fixes.md

### F6 — Adding links is not idempotent

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/studies/AddLinksForm.tsx
- **Detail**: Only the client-side `submitting` guard stops a double submit. Two tabs, or a retry after a network error, add the links twice. The cap still holds, and links cannot be removed, which the plan accepted.
- **Fix**: Accept as designed.
- **Decision**: ACCEPTED — by design (plan: links are permanent; the cap still holds)

### F7 — `study_links_study_id_idx` is now redundant

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: supabase/migrations/20261016181615_generate_extra_links.sql:50
- **Detail**: `unique (study_id, position)` creates an index that starts with `study_id`, which also covers the older single-column index. With at most 100 links per study, the impact is negligible.
- **Fix**: Leave it; it can be dropped in a later migration if it ever matters.
- **Decision**: ACCEPTED — left as is; negligible at ≤100 links per study
