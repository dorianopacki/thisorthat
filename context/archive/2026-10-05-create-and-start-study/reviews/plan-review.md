<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Create and Start a Text Study

- **Plan**: context/changes/create-and-start-study/plan.md
- **Mode**: Deep
- **Date**: 2026-10-05
- **Verdict**: SOUND (after fixes; REVISE-level warning resolved)
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
7/7 paths ✓, 4/4 symbols ✓, brief↔plan ✓, Progress↔Phase 19/19 ✓, contract surfaces ✓

## Findings

### F1 — The 6-variant cap is tied to position numbers

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 — Migration (variants check)
- **Detail**: `position between 0 and 5` + unique `(study_id, position)` holds only while positions stay 0..n-1 with no gaps. S-06 breaks that: deleting a variant and adding a new one fails at 5 variants (new position 6), and swapping variants has no free slot under the non-deferrable unique constraint. create_study and start_study already count 2–6.
- **Fix A ⭐ Recommended**: Drop the position change and count only in the RPCs
  - Strength: Count enforced where it matters; start_study re-checks under lock; position stays a free sort key for S-06.
  - Tradeoff: A direct API insert can push a draft above 6; it just can't start.
  - Confidence: HIGH — start_study is the only path to `active`.
  - Blind spot: S-06 edit UI must mirror 2–6.
- **Fix B**: Count with a BEFORE INSERT trigger on variants
  - Strength: Max 6 always holds, on every write path.
  - Tradeoff: New pattern; needs a row lock to be race-safe.
  - Confidence: MED — unlocked count trigger races at 5.
  - Blind spot: Interaction with S-06 bulk edits.
- **Decision**: FIXED (Fix A)

### F2 — Double-submit protection doesn't work for a plain form POST

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §2 (StudyWizard), Phase 3 §2 (StartStudyButton)
- **Detail**: SubmitButton uses `useFormStatus` (SubmitButton.tsx:12), which never sees a native form POST, so a double click in the wizard creates two drafts (which can't be deleted until S-06).
- **Fix**: Local `submitting` state set in `onSubmit` disables the button in both islands.
- **Decision**: FIXED

### F3 — "Renders a 404" has no target page

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §4, Phase 3 §1
- **Detail**: No `src/pages/404.astro` exists; the 404 mechanism was unspecified.
- **Fix**: `return new Response(null, { status: 404 })` in the study page and for P0002 in the start endpoint.
- **Decision**: FIXED
