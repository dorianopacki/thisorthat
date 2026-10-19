<!-- PLAN-REVIEW-REPORT -->

# Plan Review: S-08 Image Variants

- **Plan**: context/changes/image-variants/plan.md
- **Mode**: Deep
- **Date**: 2026-10-17
- **Verdict**: REVISE → SOUND (after triage)
- **Findings**: 0 critical, 6 warnings, 1 observation

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

21/21 paths ✓, 5/5 symbols ✓, brief↔plan ✓, contract-surfaces ✓ (get_ballot, get_study_results, create_study, update_study_draft; all flagged breaking with doc updates), Progress↔Phase ✓

## Findings

### F1 — Production breaks between `db push` and deploy

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1, Migration Notes
- **Detail**: Deploys run on push to main after CI (ci.yml:79-102), and prod migrations are run by hand. Dropping the `text[]` signatures breaks the live app's create/edit (study-form.ts:83) until the deploy lands. In the other order, the new code calls a missing jsonb function.
- **Fix A ⭐ Recommended**: Temporary `text[]` wrappers that call the jsonb version; drop them in a follow-up migration once the deploy is live.
  - Strength: No downtime in either order.
  - Tradeoff: One extra migration; the old signature stays briefly in docs and pgTAP.
  - Confidence: HIGH — standard expand/contract.
  - Blind spot: The wrappers need revoke-anon and a test.
- **Fix B**: Accept a ~2 min window; run db push right after the merge.
  - Strength: Plan unchanged.
  - Tradeoff: Users can hit errors; relies on operator timing.
  - Confidence: MEDIUM.
  - Blind spot: Unknown whether the wizard keeps input on error.
- **Decision**: FIXED (Fix A)

### F2 — Direct SQL DELETE on storage.objects throws an error

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §5 pgTAP
- **Detail**: Supabase storage migration 0055 adds the `protect_objects_delete` trigger, which raises 42501 on any SQL DELETE, even when zero rows match. The test "B's delete removes nothing" would fail for the wrong reason. Not verified on the CLI 2.117 image (Docker down).
- **Fix**: `set local storage.allow_delete_query = 'true'` in the test, then assert 0 rows; object cleanup goes only through the Storage API.
- **Decision**: FIXED

### F3 — Async resize vs. native submit

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §2
- **Detail**: `handleSubmit` (StudyWizard.tsx:160-166) lets the native POST through, so a resize at submit time would race it and send the original file.
- **Fix**: Resize in the file input's onChange; block submit while a resize is pending.
- **Decision**: FIXED

### F4 — Duplicate image_path surfaces as 23505, not 23514

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1, §5
- **Detail**: The unique index raises 23505; no RPC catches exceptions, and study-form.ts:88 maps only 22023/23514.
- **Fix**: Explicit duplicate check in the RPC → 23514; the index stays as a backstop.
- **Decision**: FIXED

### F5 — "Other files calling the old signatures" is vague and incomplete

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §5, Phase 2 §5
- **Detail**: Unlisted: study_deadline.test.sql, edit_and_delete_study.test.sql:133, study_anonymity.test.sql:111-130 (exact results key count), and the HTTP tests posting `variant` (author-isolation, edit-and-delete-study, route-access, study-closing, client.ts:152).
- **Fix**: List the files explicitly.
- **Decision**: FIXED

### F6 — Signing edge cases not decided

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §2–§3
- **Detail**: `createSignedUrls` per-item errors were left undecided; results thumbnails expire after 1 h on an open tab.
- **Fix**: Per-item error on the ballot → 500; the 1 h results TTL is accepted in writing.
- **Decision**: FIXED

### F7 — Authors can upload directly, bypassing the sniff and limits

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 (insert policy)
- **Detail**: Any signed-in user can upload unreferenced objects through supabase-js; with no orphan sweep, quota can fill up. Exposure stays low.
- **Fix**: Accept in Open Risks (plan-brief.md).
- **Decision**: FIXED
