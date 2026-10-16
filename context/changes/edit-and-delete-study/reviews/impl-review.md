<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Edit Draft and Delete Study (S-06)

- **Plan**: context/changes/edit-and-delete-study/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-16
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

## Success criteria evidence

These were re-run at fbf0d15 during the review:

- unit tests: 71/71
- pgTAP: 262, PASS
- `supabase db lint`: no results
- regenerated types match `src/lib/database.types.ts`
- `astro check`: 0 errors
- lint: 0 errors (2 warnings, both in the generated `worker-configuration.d.ts`, which was already that way)

Phase 1's `db reset` step was not repeated, because it wipes the local E2E user; it was run during Phase 1.

HTTP (166/166) and Playwright (5/5) were not re-run. Both passed at bd0cd6a, and the only later commit (fbf0d15) touches nothing but files under `context/`.

Manual checks 2.5–2.8, 3.6 and 3.7 were confirmed by the user. 3.8 (`npx supabase db push` to production) is pending and has to be done before merge.

## Findings

### F1 — Post-delete vote test cannot tell whether the delete happened

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: tests/http/edit-and-delete-study.test.ts:236
- **Detail**:
  - The test „a vote on that link is not accepted” posts a random `variant_id`.
  - That vote would be refused even if the study still existed, so the test passes whether or not the delete worked. It does not cover the plan's „POST /api/v/<token> does not accept a vote”.
  - The neighbouring `/v/<token>` „Badanie jest zakończone” test and pgTAP's `cast_vote` → `study_ended` do cover the guarantee, so this is a weak test, not a gap in the behaviour.
- **Fix**: Before the delete, read a real variant id from the study's ballot page and capture it. After the delete, vote with that id and assert that the result is not accepted.
- **Decision**: DISMISSED — the finding was wrong, and only a comment was added.
  - `redirectTarget` keeps the query string.
  - `cast_vote` (20261015150000) returns `study_ended` before it validates the variant.
  - A random id on a study that still exists therefore gets `?error=`, and the exact bare `/v/<token>` assertion already proves the delete happened.
  - A comment in the test now says this.

### F2 — Unplanned shared form module

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/lib/study-form.ts
- **Detail**:
  - The plan asked to move only `validate()` into a shared module.
  - The module also reads the form, builds the RPC arguments and maps errors to messages, for both create and update.
  - It's harmless: messages are identical by construction, create behaves as before, and the extension was reported as a Phase 2 adaptation. But the plan doesn't record it.
- **Fix**: Add a one-line addendum to plan.md Phase 2 recording the broader module.
- **Decision**: FIXED — added an addendum to the Phase 2 update-endpoint contract in plan.md.

### F3 — Fallback zone on edit prefill does not match the zone sent back

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/studies/[id]/edit.astro:51-52
- **Detail**:
  - When the stored `closes_tz` is a zone Intl cannot format, `toLocalInputValue` falls back to UTC, but `initial.closesTz` still holds the stored zone.
  - The wizard then submits a UTC time labelled with that invalid zone. The RPC rejects it with 22023, and the author sees „Termin musi być w przyszłości.” until they clear the deadline.
  - This only happens if the author inserts their own row directly through PostgREST, because the insert grant on `closes_at`/`closes_tz` is still in place.
  - The `docs/reference/contract-surfaces.md` sentence claiming the zone is always validated ignores that path.
- **Fix**: In edit.astro, pass `closesTz: "UTC"` when the stored zone isn't formattable, so the time and zone match, and reword the contract-surfaces sentence to mention direct inserts.
- **Decision**: FIXED — new `inputZone` helper in `study-deadline.ts`: `toLocalInputValue` formats in it, and `edit.astro` sends it back as `closesTz`. Added unit tests and reworded the contract-surfaces sentence.

### F4 — Edit-mode UX trade-offs (stored-zone deadline, input lost on server error)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/studies/StudyWizard.tsx:75,123; src/pages/api/studies/[id]/update.ts:14,31
- **Detail**:
  - **Stored zone.** In edit mode, a deadline the author types is read in the draft's stored zone, as the plan decided. The client-side future check is skipped when that zone differs from the browser's, so the database decides.
  - **Lost input.** After a server-side error, the edit page reloads from the database, so unsaved changes are lost. The create flow behaves the same way.
- **Fix**: None now. Revisit if authors across time zones or keeping form state become requirements.
- **Decision**: ACCEPTED — trade-offs the plan made on purpose; no change.
