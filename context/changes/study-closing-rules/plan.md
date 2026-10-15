# Study Closing Rules (S-04) Implementation Plan

## Overview

A study can close in three ways: automatically after its last link is used (FR-014), manually by the author (FR-015, irreversible), or at an author-set deadline in the author's time zone (FR-016). All three must lead to one rule. A closed study accepts no votes, the participant sees „Badanie jest zakończone” (FR-010), and the author still sees the results.

Manual close and auto-close write `status = 'closed'` while holding a lock on the study row. The deadline is never written. Every read and `cast_vote` evaluate it through one SQL function, `effective_status`, so no page can show „Trwa” after the deadline.

## Current State Analysis

From `context/changes/study-closing-rules/research.md`:

- **The `closed` state is handled end to end, but nothing sets it.**
  - The enum already has it (`supabase/migrations/20261002095727_study_data_model.sql:13`).
  - `cast_vote` returns `study_ended` for a non-active study (`supabase/migrations/20261002124043_cast_vote_comment_uuid_errcode.sql:102-124`).
  - `get_ballot` returns null for a non-active study (`supabase/migrations/20261005132123_one_time_link_voting.sql:20-48`), and the participant page renders „Badanie jest zakończone” on that null (`src/pages/v/[token].astro:55-56`).
  - `StudyResults` stops polling when a poll returns non-active (`src/components/studies/StudyResults.tsx:85-87`).
- **Only definer functions can change `status`.** There is no column grant on it and the update policy is draft-only (`…study_data_model.sql:101-103,132-135`).
- **The vote path does not lock the study row.** `cast_vote` consumes a link with one conditional `UPDATE study_links … FROM studies` (`…cast_vote_comment_uuid_errcode.sql:102-109`), which locks only the link row. A concurrent close is therefore not serialized against a vote.
- **There are no deadline or time-zone columns, and no date handling in `src/`.**
- **The dashboard can show stale status.** It reads `studies.status` directly (`src/pages/dashboard.astro:9-11`).
- **The study page label can be stale (F2, deferred to S-04 in `context/archive/2026-10-06-live-results-and-comments/reviews/impl-review.md:36-44`).** It renders the status label from the stored status on the server (`src/pages/studies/[id].astro:84,101`), so it shows „Trwa” after polling sees `closed`.

## Desired End State

**Participant side:**

- A link of a study that the author closed, that reached its deadline, or whose links are all used shows „Badanie jest zakończone”.
- Sending a vote to such a study records nothing and lands on that screen.
- The last voter still sees „Dziękujemy za udział w badaniu”.

**Study page (author):**

- A two-step „Zakończ badanie” button, shown only while the study is effectively active.
- The deadline is shown in the author's own time zone.
- The status label updates when live polling sees the study close.
- Results stay visible after closing.

**Wizard (author):**

- An optional deadline field (date + time). The browser's IANA zone is stored with it.

**Dashboard:** shows „Zakończone” for a study past its deadline.

**Verification:** run `npx supabase test db`, `npm run test:unit`, `npm run test:http`, `npx astro check`, `npm run lint`, and the new Playwright spec.

### Key Discoveries:

- `start_study` is the lock-then-check template for status writers: `FOR UPDATE`, then `P0002` (not found / not owned) and `55000` (wrong state) (`supabase/migrations/20261005075735_create_and_start_study.sql:97-114`).
- `StartStudyButton.tsx:26-81` and `src/pages/api/studies/[id]/start.ts:16-25` are the templates for the confirm-then-POST UI and its error mapping.
- Screen order on `/v/<token>` must stay as is: thank-you first (`docs/reference/contract-surfaces.md:50`). „Ended” stays at 200 and indistinguishable from an unknown token (`src/pages/v/[token].astro:71-72`).
- N is the live link count, not `participant_target` (`contract-surfaces.md:132`), so S-07 can add links.
- Every new route needs a `ROUTE_AUDIENCE` entry (`src/lib/route-access.ts:10-28`) and an HTTP `PROBES` row (`tests/http/route-access.test.ts:25-43`).
- `AGENTS.md:42` requires a forward-only migration, regenerated `src/lib/database.types.ts`, pgTAP tests, and a `docs/reference/contract-surfaces.md` update for every schema change.

## What We're NOT Doing

- Setting, changing or removing the deadline on an active study. The deadline is set only when the draft is created (S-06 may later add draft editing; it gets the column grants for free).
- A close action on the dashboard. The dashboard is replaced in S-05; it only shows the correct status here.
- Writing `closed` when the deadline passes. The deadline stays computed, so the stored `status` may read `active` after it. Every reader goes through `effective_status`.
- A `closed_at` timestamp or a „closed because…” reason. The participant never learns why a study ended.
- Reopening a closed study. Manual close is irreversible, as accepted in the PRD FR-015 Socrates round.
- Background jobs or Cloudflare Cron Triggers (`tech-stack.md:24`).
- Extra links (S-07). This plan only keeps auto-close based on the live link count, so S-07 stays correct.

## Implementation Approach

**The one rule.** A study is effectively closed if any of these holds:

- `status = 'closed'`, which is written by `close_study` or by auto-close in `cast_vote`;
- `status = 'active'` and `closes_at is not null` and `now() >= closes_at`.

`study_status_effective` encodes this rule (with `effective_status(studies)` as its computed-field wrapper). Every other reader uses it: `get_ballot`, `get_study_results`, the open check inside `cast_vote`, `close_study`, and the dashboard (as a PostgREST computed field).

**Serialization.** `cast_vote` locks the study row `FOR NO KEY UPDATE` before consuming a link, and `close_study` does the same. This is enough to conflict between writers, and unlike `FOR UPDATE` it does not block FK `KEY SHARE` checks. As a result:

- votes on one study run one after another (≤ 100 links, negligible);
- a vote either commits before a close, or sees `closed` and returns `study_ended`;
- the voter who uses the last link sees that no unused link remains and writes `closed` in the same transaction.

`FOR SHARE` is deliberately not used. Two concurrent "last" voters would each hold a share lock, and both could then fail to see the study as complete or deadlock when upgrading to write `closed`.

**Time zone.** The client sends the local date and time plus `Intl.DateTimeFormat().resolvedOptions().timeZone`. Postgres converts it with `p_closes_local::timestamp at time zone p_closes_tz`, which handles DST and needs no JS date library on Workers. The author page formats `closes_at` with `Intl.DateTimeFormat('pl-PL', { timeZone: closes_tz })`.

## Critical Implementation Details

- **Lock ordering in `cast_vote`.**
  - The study row must be locked (`select … from studies where id = v_study_id for no key update`) after the token lookup and before input validation and the link consume. This keeps the lock order study → link the same for every writer, including `start_study` and the cascade on delete.
  - If the study was deleted between the token lookup and the lock, the locking select returns no row. `cast_vote` then returns `'study_ended'` and does not raise.
  - The anonymity order must not change: input validation still raises `22023` before anything reveals or consumes `used` (`…cast_vote_comment_uuid_errcode.sql:43-97`).
  - Validation running after the lock is fine. It leaks nothing, because the lock is taken for every known token whatever its `used` state.
- **Boundary:** at exactly `now() = closes_at` the study is closed (`>=`). `now()` is the transaction start time, so one vote transaction sees one consistent answer.
- **The rule lives in one body, under two names, never as an overload.**
  - The scalar `study_status_effective(status, closes_at)` holds the rule and serves the definer functions.
  - `effective_status(s public.studies)` is only a PostgREST computed field (`select("…, effective_status")`) that delegates to the scalar function.
  - Both are `stable` and not security definer. Avoiding a same-name overload keeps PostgREST resolution and type generation unambiguous.
- **Grants on every new or recreated function.** Supabase's default privileges give `anon` EXECUTE on new functions in `public`, and `public` is exposed through PostgREST. Every function this change creates or recreates therefore gets `revoke execute … from public, anon` and an explicit grant. The applicable functions are `study_status_effective`, `effective_status`, `create_study`, `close_study`, `get_ballot`, `cast_vote` and `get_study_results`. `get_ballot` and `cast_vote` grant anon again on purpose, as they do today. Without this, `create_and_start_study.test.sql:316-320` (anon → `42501` on `create_study`) fails.

## Phase 1: Deadline in the schema and one status rule

### Overview

Add the deadline columns and the `effective_status` rule. Apply the rule to the read paths (`get_ballot`, `get_study_results`). Let `create_study` accept a deadline, and let `start_study` refuse to start a study whose deadline has passed. Prove it all in pgTAP.

### Changes Required:

#### 1. Migration `supabase/migrations/<timestamp>_study_closing_rules.sql` (forward-only)

**Intent**: Store an optional deadline as an absolute instant plus the author's IANA zone for display, and define the single closing rule.

**Contract**:

- `studies.closes_at timestamptz null` and `studies.closes_tz text null`.
- Check: both null or both not null.
- Column grants for `insert, update (closes_at, closes_tz)` to `authenticated`, the same as `title` and `participant_target`. The draft-only update policy still applies.
- `public.study_status_effective(p_status study_status, p_closes_at timestamptz) returns study_status`
  - `language sql stable`.
  - Returns `'closed'` when `p_status = 'active' and p_closes_at is not null and now() >= p_closes_at`; otherwise returns `p_status`.
  - Grants: revoke from `public, anon`; grant to `authenticated`, which the invoker computed field needs.
- `public.effective_status(s public.studies) returns study_status`
  - Computed field that delegates to `study_status_effective`.
  - Grants: revoke from `public, anon`; grant to `authenticated`.
- Header comment explaining: the deadline is computed and never written; why `cast_vote` locks the study row (lock ordering and the anonymity order).

#### 2. `get_ballot` and `get_study_results` (same migration, `create or replace`)

**Intent**: A study past its deadline reads as closed on both the participant and the author side, with no write on the read path.

**Contract**:

- `get_ballot` filters on `study_status_effective(s.status, s.closes_at) = 'active'` instead of `s.status = 'active'`.
- The output shape and the anonymity invariants are unchanged (`…one_time_link_voting.sql:5-13`).
- `get_study_results` returns `study_status_effective(…)` in its `status` field. The shape and the `stable` volatility are unchanged.
- Do not add keys to `get_study_results`, such as `closes_at`. `study_anonymity.test.sql:111-116` and `parseStudyResults` (`src/lib/study-results.ts:32`) fix the key set to exactly `responded, status, total, variants`.
- Both functions keep their existing grants after `create or replace`. Restate them explicitly.

#### 3. `create_study` and `start_study` (same migration)

**Intent**: Accept an optional deadline when the draft is created. Refuse to start a study whose deadline has already passed.

**Contract**:

- `create_study(p_title, p_participant_target, p_variants, p_closes_local timestamp default null, p_closes_tz text default null)`. Defaults keep existing callers valid, and the old 3-argument signature is dropped.
- If exactly one of the two deadline parameters is given, raise `22023`.
- An unknown zone (not in `pg_timezone_names`) raises `22023`.
- A deadline that is not in the future (`<= now()`) raises `22023`.
- The stored instant is `p_closes_local at time zone p_closes_tz`.
- The recreated `create_study` keeps `security invoker` and gets `revoke … from public, anon` and a grant to `authenticated` again (see Critical Implementation Details).
- `start_study`: after the existing checks, raise a new SQLSTATE **`22008`** if `closes_at is not null and closes_at <= now()`. The code must be distinct from the `22023` variant-count error, which the endpoint already maps to its own message.

#### 4. Types and contracts

**File**: `src/lib/database.types.ts`, `docs/reference/contract-surfaces.md`

**Intent**: Keep the registry and generated types in step with the schema (`AGENTS.md:42`).

**Contract**:

- Regenerate types with `npx supabase gen types typescript --local > src/lib/database.types.ts`.
- In `contract-surfaces.md`, document:
  - the closing rule;
  - the new `create_study` parameters and errors;
  - `start_study` `22008`;
  - `effective_status`;
  - that `get_study_results.status` is now effective.

#### 5. pgTAP `supabase/tests/study_deadline.test.sql`

**Intent**: Prove the deadline rule at its boundaries without the wall clock (risk #6, `context/foundation/test-plan.md:63`).

**Contract**: The fixtures follow the existing suites (fixed uuids, `set local role`, `request.jwt.claims`). They set `closes_at` to `now() - 1 minute`, `now()` and `now() + 1 minute`. `now()` is fixed within the test transaction. Cases:

- `study_status_effective` and the `effective_status` computed field for each status × deadline combination;
- `get_ballot` returns null at `now()` and at `-1 min`, and returns the ballot at `+1 min`;
- `get_study_results.status` follows the same rule;
- `create_study` time conversion in `Europe/Warsaw` (all dates must be in the future, because `create_study` rejects past deadlines):
  - an ordinary local time converts to the expected UTC instant;
  - the spring gap `2027-03-28 02:30`, a local time that does not exist;
  - the autumn doubled hour `2027-10-31 02:30`, a local time that exists twice.
  - Before writing the test, observe what Postgres actually returns for the gap and the doubled hour. Record that as the expected value in the test and in `contract-surfaces.md`.
- `create_study` rejects an unknown zone, a half-given deadline and a past deadline with `22023`;
- anon cannot execute `create_study`, `study_status_effective` or `effective_status` (`42501`);
- `start_study` past the deadline raises `22008`;
- a direct `UPDATE … SET closes_at` on an active study changes 0 rows (draft-only policy).

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly on a fresh local database: `npx supabase db reset`
- All pgTAP suites pass, including the new `study_deadline.test.sql`: `npx supabase test db`
- Regenerated types compile: `npx astro check`
- Existing callers of `create_study` still work: `npm run test:http`

#### Manual Verification:

- `docs/reference/contract-surfaces.md` describes the closing rule, the new parameters and the error codes

**Implementation Note**: Pause after automated verification passes and wait for manual confirmation before Phase 2.

---

## Phase 2: Vote path and manual close

### Overview

Serialize votes and closes on the study row. Make `cast_vote` respect the deadline and auto-close on the last link. Add the `close_study` RPC. Prove the status matrix, isolation and the race.

### Changes Required:

#### 1. `cast_vote` (new migration, `create or replace`)

**Intent**: No vote is ever recorded for an effectively closed study, and the vote that uses the last link closes the study.

**Contract**:

- The signature and return values are unchanged (`'accepted' | 'link_used' | 'study_ended'`).
- After the token lookup, lock the study row `FOR NO KEY UPDATE`. If no row is found (the study was deleted meanwhile), return `'study_ended'`.
- The consume condition becomes `study_status_effective(s.status, s.closes_at) = 'active'`.
- The fallback returns `link_used` only when the link is used and the study is effectively active; otherwise it returns `study_ended`.
- After inserting the vote and comments: if no unused link remains for the study, run `update studies set status = 'closed' where id = v_study_id and status = 'active'`.
- It still returns `accepted` for that last vote, so the voter sees the thank-you screen.

#### 2. `close_study(p_study_id uuid) returns void` (same migration)

**Intent**: Irreversible manual close by the owner, built on the `start_study` pattern.

**Contract**:

- `security definer`, `search_path = ''`. Execute is revoked from `public` and `anon` and granted to `authenticated`.
- Locks the study with `select … where id = p_study_id and author_id = auth.uid() for no key update`.
- Not found or not owned → `P0002`.
- `study_status_effective(…) ≠ 'active'` → `55000`. This covers draft, already closed, and past the deadline.
- Otherwise sets `status = 'closed'`.

#### 3. Types and contracts

**Intent**: Register `close_study` and the new `cast_vote` behaviour.

**Contract**:

- Regenerate `database.types.ts`.
- In `contract-surfaces.md`, document `close_study` (codes `P0002` and `55000`), the auto-close rule (live link count) and the lock ordering.

#### 4. pgTAP `supabase/tests/study_closing.test.sql`

**Intent**: Prove the three paths share one rule (risks #3 and #6), asserting recorded row counts and not only return codes (`test-plan.md:60`).

**Contract**: Cases:

- **Auto-close:** a 2-link study. The first vote leaves the study `active`. The second returns `accepted`, and then `status = 'closed'`, `get_ballot` is null and a third call returns `study_ended`. `votes` count = 2.
- **Deadline:** `cast_vote` on an unused link with `closes_at = now()` returns `study_ended`, and the `votes` count and link `used` are unchanged.
- **Manual close:**
  - the owner closes an active study → `closed`;
  - a second close → `55000`;
  - close on a draft → `55000`;
  - close on a study past its deadline → `55000`;
  - a foreign author → `P0002`;
  - anon has no execute permission.
- **After a manual close:** `cast_vote` on a used and on an unused link both return `study_ended`, and `get_study_results` still returns the votes.
- **Race** goes in its own suite, `supabase/tests/study_closing_race.test.sql`. The pgTAP session's own fixtures sit in its uncommitted `begin…rollback`, where no other session can see them. So every actor is a separate `dblink` connection, and the pgTAP session only orchestrates:
  1. **Fixtures:** `conn_seed` commits fixtures with unique ids (`dblink_exec`): an author, an active 3-link study and its variants.
  2. **Close holds the lock:** `conn_close` runs `begin`, sets `request.jwt.claims` for the author and `set local role authenticated`, and calls `close_study` without committing. It now holds the study row lock.
  3. **Vote in flight:** `conn_vote` sends `cast_vote` on an unused link with `dblink_send_query` (asynchronously, as anon).
  4. Assert `dblink_is_busy('conn_vote') = 1`, which shows the vote is blocked on the lock.
  5. `conn_close` commits.
  6. Assert `dblink_get_result('conn_vote')` = `study_ended`, the vote count = 0 and the link is still unused.
  7. **Cleanup:** `conn_seed` deletes the fixtures. Cleanup also runs as the first step, keyed by a fixed test-id prefix, so a run that failed earlier does not leave data behind.
  - **Connection:** `dblink` is created with `create extension if not exists dblink with schema extensions`. The connection string is `host=127.0.0.1 port=5432 dbname=postgres user=postgres password=postgres`. Verify that it connects locally before writing the suite.
  - **Fallback**, only if `dblink` cannot connect locally or in CI: a `tests/http` test fires a vote and a close concurrently and asserts that recorded votes equal used links and that no vote exists past the close. Record in the plan that the fallback was used, because it does not prove serialization.
- Extend `study_isolation.test.sql` / `author_isolation_gaps.test.sql` with `close_study` on a foreign study (`P0002`, the row is unchanged).

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- All pgTAP suites pass, including `study_closing.test.sql`, `study_closing_race.test.sql` and the extended isolation suites: `npx supabase test db`
- The race test passes (pgTAP via `dblink`, or its `tests/http` fallback): `npx supabase test db` / `npm run test:http`
- Existing vote suites (`cast_vote.test.sql`, `study_anonymity.test.sql`) still pass unchanged: `npx supabase test db`
- Types compile: `npx astro check`

#### Manual Verification:

- `docs/reference/contract-surfaces.md` documents `close_study`, the auto-close rule and the lock ordering

**Implementation Note**: Pause after automated verification passes and wait for manual confirmation before Phase 3.

---

## Phase 3: Author UI

### Overview

Add a deadline field to the wizard, a close endpoint and button, a status label that follows live polling (F2), the deadline shown on the study page, and correct dashboard statuses.

### Changes Required:

#### 1. Wizard and create endpoint

**File**: `src/components/studies/StudyWizard.tsx`, `src/pages/api/studies/index.ts`, `src/lib/study-limits.ts`

**Intent**: Let the author set an optional deadline in their own time zone.

**Contract**:

- Add an optional `<input type="datetime-local" name="closes_local">` labelled „Termin zakończenia (opcjonalnie)”.
- Add a hidden `closes_tz`, filled from `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- Client `validate()` and server `validate()` reject a past deadline with „Termin musi być w przyszłości.”.
- The server passes `p_closes_local` / `p_closes_tz` to `create_study` only when the field is filled.
- A `22023` caused by the deadline maps to the same message. Branch on the parameters present (only a request carrying a deadline can hit the deadline errors) and keep the variant message otherwise.

#### 2. Start endpoint

**File**: `src/pages/api/studies/[id]/start.ts`

**Intent**: Explain why a draft whose deadline has passed cannot start.

**Contract**: Map `22008` to `?error=` with „Termin zakończenia już minął. Utwórz badanie z nowym terminem.”.

#### 3. Close endpoint and route access

**File**: `src/pages/api/studies/[id]/close.ts`, `src/lib/route-access.ts`, `tests/http/route-access.test.ts`

**Intent**: POST endpoint for manual close that mirrors `start.ts`.

**Contract**:

- `POST /api/studies/[id]/close` calls `close_study`.
- Success and `55000` both redirect to `/studies/<id>`.
- `P0002` / `22P02` redirect to the study page, which renders the 404.
- Any other error → `?error=` with the generic message.
- Add `"/api/studies/[id]/close": "author"` to `ROUTE_AUDIENCE` and a `PROBES` row `[{ method: "POST" }]`.

#### 4. Close button

**File**: `src/components/studies/CloseStudyButton.tsx` (new), `src/pages/studies/[id].astro`

**Intent**: Irreversible action behind a two-step confirmation, shown only while the study is effectively active.

**Contract**:

- Same structure as `StartStudyButton`: first button „Zakończ badanie”, then a form posting to `/api/studies/<id>/close`.
- The form shows a `role="alert"` warning: „Zakończonego badania nie da się wznowić. Linki przestaną przyjmować głosy.”
- Buttons „Tak, zakończ” (pending text „Zamykanie...”) and „Anuluj”, with the double-submit guard and the bfcache reset.
- Rendered when the effective status from `get_study_results` is `active`.

#### 5. Status label in the results island (F2) and deadline display

**File**: `src/pages/studies/[id].astro`, `src/components/studies/StudyResults.tsx`

**Intent**: The label shown to the author always matches the effective status, including after a poll sees the study close. The deadline is visible.

**Contract**:

- For non-draft studies, the page takes the status from `get_study_results` (effective), not from `studies.status`.
- `StudyResults` renders the status label from `results.status`, so it switches to „Zakończone” when polling sees `closed`.
- A study loaded already closed shows „Badanie jest zakończone — wyniki są ostateczne.” from the first render.
- The page selects `closes_at, closes_tz`. When set, it shows „Zakończy się automatycznie: <date, time> (<zone>)” for an active study, and „Termin: …” for a closed one. Format with `Intl.DateTimeFormat('pl-PL', { dateStyle: 'long', timeStyle: 'short', timeZone: closes_tz })`.

#### 6. Dashboard

**File**: `src/pages/dashboard.astro`

**Intent**: The list shows the effective status, so a study past its deadline reads „Zakończone”.

**Contract**: Select the `effective_status` computed field and label from it. If the generated types do not infer the computed field, narrow it once at the query boundary rather than duplicating the rule in TS.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the route-access map completeness check: `npm run test:unit`
- HTTP tests pass, including the new `POST /api/studies/[id]/close` probe (unauthenticated → redirect to sign-in) and a foreign-author close → 404: `npm run test:http`
- Type check passes: `npx astro check`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Creating a study with a deadline 2 minutes ahead, starting it, waiting past the deadline and reloading: the study page shows „Zakończone” and the link shows „Badanie jest zakończone”
- The deadline is displayed in the author's zone (compare with the value entered in the wizard)
- Manual close: „Zakończ badanie” → warning → „Tak, zakończ” → the page shows „Zakończone” and results remain visible; „Anuluj” leaves the study active
- With the study page open while the last participant votes, the label switches from „Trwa” to „Zakończone” within one poll (~10 s)
- The dashboard lists the closed and past-deadline studies as „Zakończone”

**Implementation Note**: Pause after automated verification passes and wait for manual confirmation before Phase 4.

---

## Phase 4: E2E — manual close ends voting

### Overview

Drive one browser-level risk with `/10x-e2e`: after the author closes a study, a participant link shows „Badanie jest zakończone” and the author still sees the results (risks #3 and #6, app side). Deadline boundaries stay in pgTAP. A Playwright clock does not move the database's `now()`.

### Changes Required:

#### 1. Playwright spec

**File**: `tests/e2e/close-study.spec.ts` (new)

**Intent**: Cover the full close flow in a real browser, following the `one-link-one-vote.spec.ts` template.

**Contract**:

- Header comment with risk, facet and seed.
- Unique title `E2E … ${Date.now()}-<random>`, cleanup in `afterEach` as the author.
- Flow: wizard → start → copy link 1 → „Zakończ badanie” → „Tak, zakończ” → assert the „Zakończone” label.
- A fresh anonymous context opens link 1 → heading „Badanie jest zakończone”.
- The author page still shows „Odpowiedziało 0 z 2”.
- Use role/label/text locators only and no `waitForTimeout`. Call `waitForIslands()` before interacting with islands.
- Update the `one-link-one-vote.spec.ts:3-4` header. It says closed-study votes „wait for S-04”, and that concurrency is proven in pgTAP, which until this change was untrue. After this change both are covered: point to `study_closing.test.sql` and `study_closing_race.test.sql`.

### Success Criteria:

#### Automated Verification:

- The new spec passes: `npx playwright test tests/e2e/close-study.spec.ts`
- The whole E2E suite stays green: `npx playwright test`

#### Manual Verification:

- Deliberate break: with the close button's POST pointed at a no-op (temporarily), the spec fails on the „Badanie jest zakończone” assertion; restore afterwards

---

## Testing Strategy

### Unit Tests:

- Route-access map completeness picks up `/api/studies/[id]/close` (`tests/unit/route-access.test.ts`).

### Integration Tests:

- **pgTAP:**
  - `study_deadline.test.sql`: deadline rule ±1 min and at `now()`, zone conversion including DST, create/start errors;
  - `study_closing.test.sql`: auto-close, deadline in `cast_vote`, manual close matrix, race;
  - isolation suites: foreign close → `P0002`.
- **HTTP:** close route probe, foreign-author close → 404, and the race fallback if `dblink` is unavailable.
- **E2E:** manual close → participant sees „Badanie jest zakończone”.

### Manual Testing Steps:

1. Create a study with a deadline ~2 minutes ahead, start it, vote once, wait past the deadline, reload the link and the study page.
2. Start a 2-link study, vote with both links, and confirm the last voter sees the thank-you screen and the study shows „Zakończone”.
3. Close an active study manually and confirm the participant screen and that the results are still visible.

## Performance Considerations

`cast_vote` now locks the study row, so votes on one study run one after another. With at most 100 links per study (`create_and_start_study.sql:21-26`), contention is negligible. `effective_status` is a trivial `stable` expression.

## Migration Notes

The migrations are forward-only, and earlier migrations are applied in production. Existing studies get `closes_at = null`, so behaviour is unchanged until an author sets a deadline. Dropping and recreating `create_study` with optional parameters keeps existing callers valid. Regenerated types must be committed in the same phase as each migration.

## References

- Related research: `context/changes/study-closing-rules/research.md`
- Roadmap: `context/foundation/roadmap.md` S-04; test plan risks #3 and #6 (`context/foundation/test-plan.md:46,49,60,63`)
- Lock-then-check pattern: `supabase/migrations/20261005075735_create_and_start_study.sql:97-132`
- Confirm button / endpoint: `src/components/studies/StartStudyButton.tsx:26-81`, `src/pages/api/studies/[id]/start.ts:16-25`
- E2E template: `tests/e2e/one-link-one-vote.spec.ts`
- Deferred finding F2: `context/archive/2026-10-06-live-results-and-comments/reviews/impl-review.md:36-44`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Deadline in the schema and one status rule

#### Automated

- [x] 1.1 Migration applies cleanly on a fresh local database
- [x] 1.2 All pgTAP suites pass, including the new study_deadline.test.sql
- [x] 1.3 Regenerated types compile
- [x] 1.4 Existing callers of create_study still work

#### Manual

- [x] 1.5 contract-surfaces.md describes the closing rule, the new parameters and the error codes

### Phase 2: Vote path and manual close

#### Automated

- [ ] 2.1 Migration applies cleanly
- [ ] 2.2 All pgTAP suites pass, including study_closing.test.sql and the extended isolation suites
- [ ] 2.3 The race test passes (pgTAP via dblink, or its tests/http fallback)
- [ ] 2.4 Existing vote suites still pass unchanged
- [ ] 2.5 Types compile

#### Manual

- [ ] 2.6 contract-surfaces.md documents close_study, the auto-close rule and the lock ordering

### Phase 3: Author UI

#### Automated

- [ ] 3.1 Unit tests pass, including the route-access map completeness check
- [ ] 3.2 HTTP tests pass, including the close route probe and foreign-author close → 404
- [ ] 3.3 Type check passes
- [ ] 3.4 Lint passes
- [ ] 3.5 Build passes

#### Manual

- [ ] 3.6 Study past its deadline shows Zakończone on the page and Badanie jest zakończone on the link
- [ ] 3.7 Deadline is displayed in the author's zone
- [ ] 3.8 Manual close with confirmation works and Anuluj leaves the study active
- [ ] 3.9 Label switches from Trwa to Zakończone within one poll after the last vote
- [ ] 3.10 Dashboard lists closed and past-deadline studies as Zakończone

### Phase 4: E2E — manual close ends voting

#### Automated

- [ ] 4.1 The new spec passes
- [ ] 4.2 The whole E2E suite stays green

#### Manual

- [ ] 4.3 Deliberate break makes the spec fail on the Badanie jest zakończone assertion
