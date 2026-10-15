<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Study Closing Rules (S-04)

- **Plan**: context/changes/study-closing-rules/plan.md
- **Mode**: Deep
- **Date**: 2026-10-15
- **Verdict**: REVISE → SOUND (after triage)
- **Findings**: 1 critical, 3 warnings, 0 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | WARNING |
| Blind Spots           | FAIL    |
| Plan Completeness     | PASS    |

## Grounding

11/11 paths ✓, 6/6 contract surfaces ✓, brief↔plan ✓, Progress↔Phase 24/24 ✓.

Auto-close breaks none of the existing tests. Every fixture keeps at least one unused link:

| Test            | Links | Links used |
| --------------- | ----- | ---------- |
| cast_vote       | 3     | 2          |
| study_anonymity | 4     | 3          |
| get_ballot      | 2     | 1          |
| e2e             | 2     | 1          |

The lock order studies → links matches `start_study` and the cascade on delete.

## Findings

### F1 — The dblink race test cannot work as described

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 — §4 pgTAP study_closing.test.sql (Race)
- **Detail**: Two problems make the test unworkable as written:
  - Every pgTAP suite runs inside `begin…rollback` (cast_vote.test.sql:3,256). Fixtures created in the test session are therefore invisible to a dblink session.
  - The plan makes the test session the one that blocks, so the test would hang because nothing commits session B.

  It is also unverified whether local `postgres` can open a dblink connection (pg_hba trust vs password). Docker was not running during the review.

- **Fix A ⭐ Recommended**: Run both sessions over dblink, with committed fixtures and explicit cleanup.
  - Steps:
    1. conn1 seeds committed fixtures with unique ids.
    2. conn2 runs `begin; close_study` and holds the lock.
    3. conn3 sends the vote with `dblink_send_query`.
    4. Assert `dblink_is_busy = 1`.
    5. Commit conn2.
    6. Expect `dblink_get_result = study_ended` and 0 votes.
    7. Clean up.
  - Strength: Deterministic proof of the serialization.
  - Tradeoff: It breaks the rollback convention: fixtures persist and need cleanup, even when the test fails.
  - Confidence: MED — the mechanics are standard, but authentication inside the container is unverified.
  - Blind spot: Setting `request.jwt.claims` inside the dblink session; the local and CI connection string.
- **Fix B**: An HTTP-level race (parallel close + vote through the `tests/http` helpers).
  - Strength: No dependency on dblink or pg_hba.
  - Tradeoff: Not deterministic: the requests may never actually overlap, so a green test does not prove the lock.
  - Confidence: HIGH — feasible.
  - Blind spot: Proves only an invariant, not the serialization.
- **Decision**: Fixed via Fix A

### F2 — anon can call the new functions (Supabase default privileges)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 §1 (effective_status), §3 (create_study)
- **Detail**:
  - Every existing function explicitly revokes `from public, anon` (create_and_start_study.sql:123,184). The plan says this only for close_study.
  - The scalar overload of effective_status has no grants specified, so anon would see it at `/rpc/effective_status`.
  - Two overloads with the same name are unverified for PostgREST and for type generation.
  - The recreated create_study must revoke again, otherwise create_and_start_study.test.sql:316-320 (anon → 42501) fails.
- **Fix**:
  1. Rename the scalar version to `study_status_effective(status, closes_at)`.
  2. Keep `effective_status(studies)` only as the computed field.
  3. For every new or recreated function, write `revoke … from public, anon` plus a grant to authenticated.
  4. Add pgTAP checks that anon cannot execute them.
- **Decision**: Fixed

### F3 — The DST test example is in the past

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §5 — study_deadline.test.sql
- **Detail**:
  - The plan tests conversion on `2026-03-29 02:30` Europe/Warsaw, but that date has already passed. create_study will reject it as a past deadline, so the test fails.
  - The plan does not decide what happens to a local time that does not exist (spring gap) or exists twice (autumn).
- **Fix**:
  - Use future dates: 2027-03-28 02:30 (gap) and 2027-10-31 02:30 (doubled hour).
  - Write down Postgres's actual behaviour as the expected result in the test and in contract-surfaces.md.
- **Decision**: Fixed

### F4 — A vote racing a study deletion; lock strength

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §1 — cast_vote; Critical Implementation Details
- **Detail**:
  - If a study is deleted between the token lookup and the locking select, that select returns no row. The plan does not specify the result, and it must be study_ended rather than an error.
  - `FOR NO KEY UPDATE` is enough, and unlike FOR UPDATE it does not block FK KEY SHARE checks.
- **Fix**: In cast_vote, lock with `for no key update`, and return 'study_ended' if no row is found. Use the same lock strength in close_study.
- **Decision**: Fixed
