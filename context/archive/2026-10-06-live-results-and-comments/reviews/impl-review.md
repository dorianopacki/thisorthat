<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Live Results and Comments

- **Plan**: context/changes/live-results-and-comments/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-06
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Notes: no DRIFT or MISSING items. Benign extras: `parseStudyResults` (runtime narrowing of the RPC JSON, shared by the page and the island), a 404 notice string, and a „Wyniki” heading. Nothing from "What We're NOT Doing" was built. Automated criteria re-run on 2026-10-06 against a clean local DB: lint 0 errors, astro check 0 errors, build OK, `supabase test db` 113/113 PASS. All manual rows were confirmed by the user during implementation; PR #20 CI was green.

## Findings

### F1 — Study page with results is not marked no-store

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/studies/[id].astro (frontmatter, no header set)
- **Detail**: The page now server-renders vote counts and comment bodies, but sends no `Cache-Control: no-store`, while the JSON endpoint and the `/v/[token]` pages do. On a shared computer the back/forward or browser cache could show the last results after sign-out. No cross-author leak (no CDN caching of SSR, per-browser cache only).
- **Fix**: `Astro.response.headers.set("Cache-Control", "no-store")` in the page frontmatter.
- **Decision**: FIXED — `Cache-Control: no-store` set in the page frontmatter.

### F2 — Status label stays „Trwa” after live polling sees the study closed

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/studies/[id].astro:98 vs src/components/studies/StudyResults.tsx:85-86
- **Detail**: When a poll returns `closed`, the island shows „Badanie jest zakończone — wyniki są ostateczne.”, while the server-rendered status label above still reads „Trwa” until reload. Cosmetic; becomes reachable in practice once S-04 adds closing.
- **Fix**: Leave as is for now and let S-04 (which introduces closing) decide where the status label lives.
- **Decision**: ACCEPTED — deferred to S-04 (`study-closing-rules`), which introduces closing and decides where the status label lives.

### F3 — pgTAP gate fails on a local DB holding manual-test data

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: supabase/tests/cast_vote.test.sql (test 22), supabase/tests/study_anonymity.test.sql (tests 18-19)
- **Detail**: These assertions count rows across the whole `votes`/`comments` tables, so `npx supabase test db` failed twice during this change after manual testing left votes in the local DB, and needed `npx supabase db reset` (which wipes the manual-test account and studies). Not caused by S-03 (no DB change), but it slows every slice that mixes manual checks with the gate. CI is unaffected (fresh DB).
- **Fix A ⭐ Recommended**: Scope those counts to the fixture study ids (`where study_id = …`) in a small follow-up change.
  - Strength: The gate becomes independent of local data; no more resets between manual rounds.
  - Tradeoff: Touches existing F-01/S-02 test files outside this slice.
  - Confidence: HIGH — the fixtures already use fixed study ids (e.g. `a0000000-…-0001`).
  - Blind spot: Haven't checked whether other assertions also count table-wide.
- **Fix B**: Record a lesson: "reset the local DB before running `supabase test db` after manual testing".
  - Strength: Zero code change.
  - Tradeoff: Keeps the destructive reset in the loop and relies on remembering it.
  - Confidence: MED — works, but is a workaround.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A) — counts scoped to fixture study ids in `study_anonymity.test.sql:192-193` and `cast_vote.test.sql:250`; verified with a stray local study/vote/comment present: `supabase test db` PASS. Other table-wide counts (`study_isolation.test.sql`) run under RLS as fixture authors and are unaffected.
