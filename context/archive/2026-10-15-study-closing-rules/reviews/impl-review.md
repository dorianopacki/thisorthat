<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Study Closing Rules (S-04)

- **Plan**: context/changes/study-closing-rules/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-15
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

## Evidence

- Commits 5ed05a9..ab506d7 (32 files).
- **Automated criteria all pass:**
  - `npx supabase test db`: 9 files, 194 tests
  - `npm run test:unit`: 54
  - `npm run test:http`: 109
  - `npx playwright test`: 5/5
  - `npx astro check`: 0 errors
  - `npm run lint`: 0 errors (2 pre-existing warnings in worker-configuration.d.ts)
  - `npm run build`: OK
- **cast_vote validation** is byte-identical to 20261002124043:43-97.
- **Lock order** is study → link in every writer (start_study, cast_vote, close_study, the delete cascade). No new anonymity oracle was found.
- **Extras outside the plan, all justified:**
  - src/lib/study-status.ts (deduplicated STATUS_LABELS)
  - tests/e2e/support/cleanup.ts (extracted helper)
  - src/lib/study-deadline.ts with a unit test
  - roadmap.md table realigned by prettier (cosmetic)

## Findings

### F1 — The pgTAP deadline suite goes red on 2027-03-28

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/study_deadline.test.sql:101-161
- **Detail**: The DST and conversion cases call `create_study` with fixed 2027 local times (2027-03-28, 2027-06-15, 2027-10-31). `create_study` rejects any deadline that is not in the future, so the suite, and CI with it, starts failing in about 5 months. The plan-review fix F3 picked "future" dates that are only barely in the future. tests/http/study-closing.test.ts:89 and tests/unit (2030) have the same problem, later.
- **Fix**: Move the dates to 2099, using that year's last Sunday of March and of October for the gap and the doubled hour, with the same expected offsets. In the HTTP test, use 2099 as well.
- **Decision**: FIXED — dates moved to 2099 (2099-03-29 gap, 2099-10-25 doubled hour) in pgTAP and HTTP

### F2 — A time zone that Intl rejects crashes the study page (500)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261015130000_study_closing_rules.sql:39-40,214; src/lib/study-deadline.ts:10; src/pages/studies/[id].astro:90
- **Detail**: Verified locally that `closes_tz` can hold a name `Intl.DateTimeFormat` rejects, which makes `formatDeadline` throw RangeError and `/studies/[id]` answer 500. It can get there two ways:
  - **Through `create_study`:** it validates against `pg_timezone_names`, which lists 599 names that Intl rejects (`posix/…`, `right/…`, `Factory`). The wizard always sends a valid browser zone, so only a crafted request reaches this path.
  - **Directly through PostgREST:** `authenticated` holds INSERT and UPDATE column grants on `closes_at` / `closes_tz`, and the draft-only policy does not check the zone. A direct insert or patch skips `create_study`'s validation altogether.

  Only the owner's own page breaks. It is not XSS, because the value is escaped. Related: when the DB rejects the zone, the author sees „Termin musi być w przyszłości.”, because every 22023 on a request with a deadline maps to that message.

- **Fix A ⭐ Recommended**: Make `formatDeadline` fail soft and narrow the database write paths.
  - Wrap the `Intl` call in try/catch and fall back to an ISO UTC string with the raw zone.
  - Revoke `update (closes_at, closes_tz)`. Nothing edits the deadline after creation; S-06 can grant it back with validation.
  - In `create_study`, also exclude `posix/%`, `right/%`, `Factory`, `localtime` and `posixrules`.
  - Add one unit test for the fallback and one pgTAP test for the revoke.
  - Strength: The page can never 500 on stored data, and the remaining write path (`create_study`) validates.
  - Tradeoff: A direct INSERT with a bad zone is still possible: the insert grant is needed because `create_study` is security invoker. The fallback covers it.
  - Confidence: HIGH — RangeError reproduced in Node for `posix/Europe/Warsaw` and `Factory`; the 599 names counted in the local DB.
  - Blind spot: Whether the Workers runtime's ICU accepts exactly the same set as Node's.
- **Fix B**: Validate on every write with a BEFORE INSERT/UPDATE trigger on `studies` that rejects zones outside a canonical IANA set.
  - Strength: Covers every write path, now and in the future (S-06 edits).
  - Tradeoff: A new trigger plus its own tests. The "valid for Intl" set has to be approximated in SQL. Without a fallback, the page still 500s if the approximation lets a bad name through.
  - Confidence: MED — the exclusion list is a heuristic.
  - Blind spot: The full list of Intl-incompatible names in `pg_timezone_names`.
- **Decision**: FIXED via Fix A — migration 20261015170000 (revoke update on closes_*, Intl-incompatible zones excluded in create_study), formatDeadline falls back to UTC; pgTAP +3, unit +1

### F3 — The E2E spec waits on a transient state before the close is committed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: tests/e2e/close-study.spec.ts:58
- **Detail**: The spec waits with `expect(button "Tak, zakończ").toBeHidden()`. That passes as soon as `SubmitButton` switches to „Zamykanie...” on submit, which can happen before the POST commits `close_study`. The participant's „Wyślij głos” can then reach `cast_vote` first. The vote is accepted, the thank-you screen appears, and the test fails intermittently (a flaky red, not a false green). Both reviewers flagged it independently.
- **Fix**: Before the participant sends, wait for the reloaded result: `await expect(page.getByText("Status: Zakończone")).toBeVisible()`. Keep the end-of-test checks.
- **Decision**: FIXED — waits for „Status: Zakończone” before the participant sends; 3/3 repeat runs green

### F4 — The race test has hard-coded connection details and no lock timeout

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/tests/study_closing_race.test.sql:19,104
- **Detail**: The port 5432 and the password are hard-coded. `conn_vote` has no `lock_timeout`, so a regression that never releases the lock would block `dblink_get_result` until the session dies.
- **Fix**: Use `inet_server_port()`, and run `set lock_timeout = '10s'` on `conn_vote` before the async vote.
- **Decision**: FIXED — inet_server_port(), lock_timeout 10s on conn_vote

### F5 — The server delegates the past-deadline check to the database

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/api/studies/index.ts:60-79
- **Detail**: The plan said the server `validate()` rejects a past deadline, and listed src/lib/study-limits.ts. The implementation relies on create_study's `22023`, mapped through `closesLocal ? DEADLINE_MESSAGE : …`. The user-visible behaviour is the same and is tested (tests/http/study-closing.test.ts:82), and study-limits.ts is untouched. This is benign drift, but the plan doesn't record it.
- **Fix**: Add a one-line implementation note to plan Phase 3 §1.
- **Decision**: FIXED — implementation note added to plan Phase 3 §1

### F6 — The roadmap still shows S-04 as `planning`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/foundation/roadmap.md:52,150
- **Detail**: /10x-tdd and /10x-e2e do not advance the roadmap item, so S-04 never went to `in-progress`. /10x-archive sets it to `done`.
- **Fix**: None needed; /10x-archive closes it.
- **Decision**: SKIPPED — /10x-archive sets S-04 to done
