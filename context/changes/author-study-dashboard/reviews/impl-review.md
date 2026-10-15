<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Author Study Dashboard (S-05)

- **Plan**: context/changes/author-study-dashboard/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-10-15
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

Evidence:

- Re-run during the review: pgTAP 208/208 (10 files), unit 59/59, `astro check` 0 errors, lint 0 errors. The 2 warnings in the generated `worker-configuration.d.ts` are already on `main`.
- Run on the same code earlier in this session: HTTP 110/110 on a fresh build, `npm run build`, Playwright 5/5.
- Deliberate breaks:
  - removing `author_id = auth.uid()` turns 4 of 11 pgTAP assertions red;
  - a wrong draft value in `progressLabel` turns the unit test and the HTTP test red.
- Manual 2.10 (prod `db push`) is pending by design until the merge.

## Findings

### F1 — Topbar puts English „Sign out” / „Dashboard” on the page, while 2.9 is ticked

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/components/Topbar.astro:9-15 (rendered by src/pages/dashboard.astro)
- **Detail**: Criterion 2.9 says „No English template text … remains”. The page's own English texts are gone, but the shared `Topbar` the plan chose renders „Dashboard” and „Sign out” in English, and it now appears on the main author page. The Polish UI of S-01–S-04 makes this stand out. The auth pages are English too, but that is outside this slice.
- **Fix**: Translate the Topbar's signed-in labels („Dashboard” → „Twoje badania”, „Sign out” → „Wyloguj”). No test locates these labels; `seed.spec.ts` only mentions sign-out in a comment.
- **Decision**: FIXED — Topbar labels translated („Twoje badania”, „Wyloguj”); e2e 5/5

### F2 — The draft wording differs from the plan text and the change is not recorded

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/study-progress.ts:17
- **Detail**: The plan (Phase 2 §1, criterion 2.7) says „Planowane: N uczestników”. The implementation shows „Planowana liczba uczestników: N”, because the plan's form is ungrammatical for N = 2–4. The adaptation was announced during implementation, and the intent (planned `participant_target` for drafts) is intact, but the plan does not mention it.
- **Fix**: Add a one-line implementation note to plan Phase 2 §1.
- **Decision**: FIXED — implementation note added to plan Phase 2 §1

### F3 — `supabase db reset` wipes the local E2E user, and re-creating it is undocumented

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/foundation/test-stack.md:14
- **Detail**: Gate 1.1 (`db reset`) deleted the `E2E_USERNAME` user, so gate 2.6 first failed with „Invalid login credentials”. The user was re-created through the local auth admin API. `test-stack.md` names the credentials but not how to provision them, so every plan that resets the database hits this.
- **Fix**: Document in test-stack.md `## E2E` the one-line admin-API (or Studio) step that re-creates the E2E user after a reset.
- **Decision**: FIXED — E2E user provisioning (and the Windows preview/EPERM note) documented in test-stack.md
