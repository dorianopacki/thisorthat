# Edit Draft and Delete Study (S-06) Implementation Plan

## Overview

FR-017: the author can edit a study before it starts. Editable fields are title, N, variants and the optional deadline.

FR-018: the author can delete a study at any stage.

FR-010: a participant holding a link to a deleted study sees „Badanie jest zakończone”.

Editing must be hard-blocked outside `draft`, so variants can never change under cast votes. Deleting a running study breaks links already handed out. The PRD accepts this, and FR-010 covers what the participant sees.

## Current State Analysis

**Delete already works in the database.**

- Policy „authors delete own” allows deleting the author's own study in any status (`supabase/migrations/20261002095727_study_data_model.sql:137-139`).
- Links, votes and comments cascade with the study (votes and comments through `variants`).
- `get_ballot` returns `null` for a missing token, so `/v/<token>` already renders „Badanie jest zakończone” (`src/pages/v/[token].astro:52-56`).
- `cast_vote` returns `study_ended` for a token whose study is gone (`20261015150000_study_closing_vote_path.sql:67-69`).
- The app has no delete route; the e2e cleanup deletes through supabase-js (`tests/e2e/support/cleanup.ts:4-5`).

**Draft editing is only partly possible through RLS.** Studies can update `title`/`participant_target` only while `draft`, and variants can be inserted, updated or deleted only in own drafts (`study_data_model.sql:132-135, 152-191`). Row-by-row editing is unsafe for three reasons:

- Nothing enforces 2–6 variants during an edit. Only `create_study` and `start_study` check the count (`contract-surfaces.md#limits`).
- `unique(study_id, position)` is not deferrable, so reordering row by row collides.
- A variant write that passed the `draft` check can race `start_study` and land on an active study. Only a writer that locks the study row first closes this.

**The deadline is not editable.** The update grant on `closes_at, closes_tz` was revoked on purpose: „S-06 (draft editing) must add a validated path instead” (`20261015170000_study_deadline_zone_hardening.sql:6-16`).

**UI:**

- `StudyWizard.tsx` is a native `<form method="POST" action="/api/studies">`. Its state starts empty, and the action and labels are hard-coded.
- `/studies/[id].astro` shows the draft view with `StartStudyButton`, or results plus `CloseStudyButton` once started.
- Each dashboard row is a single `<a>`.
- No dialog component exists. `CloseStudyButton.tsx` is the inline two-step confirmation pattern.

## Desired End State

- On `/studies/<id>` of a draft, the author sees „Edytuj”, which opens `/studies/<id>/edit`. That page shows the creation form prefilled with the current title, N, variants and deadline.
  - Saving replaces the draft atomically and returns to `/studies/<id>` showing the new values.
  - Removing the deadline value clears it.
  - Editing an `active` or `closed` study is impossible at both layers. The edit page redirects to the study page. A direct POST is refused by the database (55000) and redirects with an error.
- On `/studies/<id>`, in any state, the author sees „Usuń badanie”. A second step shows a warning that depends on the state, then „Tak, usuń”.
  - After deleting, the author lands on `/dashboard?deleted=1`, which shows „Badanie zostało usunięte.” The study is no longer in the list.
  - Any of its participant links shows „Badanie jest zakończone”.
- Author B cannot view, edit or delete A's studies. Every new route answers like the existing ones: 404 page, or a redirect to it. A signed-out user is redirected to sign-in.

Verify with `npx supabase test db`, `npm run test:unit` and `npm run test:http` (against a built preview), plus the manual steps per phase.

### Key Discoveries:

- `start_study` is the template for the new writer: definer, `FOR UPDATE` filtered by `auth.uid()`, P0002 then 55000 (`20261015130000_study_closing_rules.sql:247-304`).
- The validation to mirror is `create_study`'s 2–6 non-blank variants and deadline rules (both or neither, Intl-safe zone, future → 22023) (`20261015170000_study_deadline_zone_hardening.sql:22-92`). Title, N and content limits come from table checks (23514).
- Lock order is study → link in every writer (`contract-surfaces.md:30`). A `DELETE` on `studies` takes the study row lock before cascading, so it serializes with `cast_vote`'s `FOR NO KEY UPDATE`.
- Error mapping and redirects follow `src/pages/api/studies/index.ts:48-85` (create) and `src/pages/api/studies/[id]/close.ts` (P0002/22P02 → study page 404, 55000 → study page).
- Every new route needs a `ROUTE_AUDIENCE` entry (`src/lib/route-access.ts:10-29`) and a `PROBES` row (`tests/http/route-access.test.ts:25-45`); unit and HTTP tests fail otherwise.
- The isolation tests follow `tests/http/author-isolation.test.ts`: targets A-active, A-draft, unknown uuid and non-uuid; B acts, then A's data is checked unchanged. The pgTAP pattern is `supabase/tests/author_isolation_gaps.test.sql`.

## What We're NOT Doing

- Edit or delete actions on dashboard rows. The study page is the only entry point; the dashboard only gains the „deleted” notice.
- Editing a started or closed study, for any field (including extending the deadline after start).
- Soft delete, undo, or a „type the title to confirm” barrier.
- Changing the `create_study` contract. The deadline validation is duplicated with a keep-in-sync comment instead of extracted.
- A new e2e spec. Moving `tests/e2e/support/cleanup.ts` onto the new route (only its stale comment is updated).
- A concurrency (two-session) pgTAP test for delete vs `cast_vote`. Row-lock semantics cover it; the sequential post-delete behaviour is tested.
- A CI migration step. Prod migrations stay manual (`npx supabase db push`).

## Implementation Approach

The database contract lands first: one `security definer` RPC, `update_study_draft`, which locks, checks owner and draft, validates, and replaces the whole draft. Two vertical app slices follow on top of it:

- **Edit.** The wizard gains an edit mode, plus an edit page and an update endpoint.
- **Delete.** A two-step button, a delete endpoint using the existing RLS policy, and a dashboard notice.

Each slice brings its own HTTP isolation tests and route-access entries.

## Critical Implementation Details

**Deadline zone on edit.** The form prefills the stored instant as local time in the stored `closes_tz`, not the browser zone. On save it sends that stored zone, so an unchanged deadline round-trips exactly. A deadline added to a draft that had none uses the browser zone, as in creation.

The wizard's client-side „future” check reads `datetime-local` in the browser zone. Run it only when the submitted zone equals the browser zone; otherwise rely on the RPC's 22023.

A draft whose deadline has already passed cannot be saved until the author moves or clears it. This is the same rule and message as at creation.

**Variant replacement.** `update_study_draft` deletes all of the draft's variants, then inserts the new list at positions `0..n-1`. Do this inside the function, after the row lock. A draft has no votes or comments, so the cascade from deleting variants removes nothing.

## Phase 1: Database — `update_study_draft`

### Overview

Add the only write path for editing a draft, with pgTAP proving ownership, the draft-only rule, limits, the deadline rules and isolation. Also prove the participant-side effects of deleting an active study.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_edit_and_delete_study.sql` (via `npx supabase migration new edit_and_delete_study`)

**Intent**: A validated, atomic draft edit, including the deadline. It fulfils the „validated path” promised in `study_deadline_zone_hardening.sql`. Header comment: forward-only, and the lock order is study → link.

**Contract**:

- Signature: `public.update_study_draft(p_study_id uuid, p_title text, p_participant_target integer, p_variants text[], p_closes_local timestamp default null, p_closes_tz text default null) returns void`.
- Function settings: `security definer`, `set search_path = ''`. `revoke execute … from public, anon`, `grant execute … to authenticated`.
- Order of operations:
  1. Lock the study with `select … where id = p_study_id and author_id = auth.uid() for update`. Not found → `P0002`.
  2. `status <> 'draft'` → `55000`.
  3. Validate variants exactly as `create_study` (count 2–6, none null or blank) → `22023`.
  4. Validate the deadline exactly as `create_study` (both or neither, zone in `pg_timezone_names` minus `posix/%`, `right/%`, `Factory`, `localtime`, `posixrules`, and `closes_at > now()`) → `22023`. Add a comment pointing to `create_study` to keep in sync.
  5. Update `title = btrim(p_title)`, `participant_target`, `closes_at`, `closes_tz`. Null/null clears the deadline.
  6. Delete the variants and insert `btrim`'d contents at positions `0..n-1` in array order.
- Table checks raise `23514` for title, N and content limits. On any error nothing changes.

#### 2. pgTAP suite

**File**: `supabase/tests/edit_and_delete_study.test.sql`

**Intent**: Prove the new contract and the delete guarantees where they are enforced.

**Contract**: fixtures inserted as superuser with fixed uuids, then `set local role authenticated` plus JWT claims (pattern of `author_isolation_gaps.test.sql`). Cases:

- **Owner edits a draft:**
  - title, N, variant contents and order are replaced (positions 0..n-1);
  - variant count can go 2 → 6 → 2;
  - a deadline can be set, changed (stored as `p_closes_local at time zone p_closes_tz`) and cleared (both null);
  - `updated_at` advances.
- **Draft-only:** on an own `active` study and an own `closed` study → `55000`, and nothing changes (title, variants, deadline checked as superuser).
- **Validation, each `throws_ok` with nothing changed:**
  - 1 or 7 variants, or a blank variant → `22023`;
  - deadline with only one of the two values, unknown zone, `posix/Europe/Warsaw`, or a time in the past → `22023`;
  - N of 0 or 101, blank title, title of 201 characters, variant of 2001 characters → `23514`.
- **Isolation:**
  - B on A's draft, active and closed studies, and on an unknown uuid → `P0002`, and A's rows are unchanged;
  - `anon` has no execute (`42501`);
  - no `auth.uid()` → `P0002`.
- **Delete of an own active study with a cast vote:**
  - `get_ballot(<its token>)` is `null`;
  - `cast_vote(<its token>, …)` returns `study_ended`;
  - no rows remain in `study_links`, `votes` or `comments` for it.
- **B deletes A's study:** zero rows affected.

#### 3. Types and contract registry

**File**: `src/lib/database.types.ts`, `docs/reference/contract-surfaces.md`

**Intent**: Keep the generated types and the contract registry in step with the migration.

**Contract**:

- Regenerate the types with `npx supabase gen types typescript --local > src/lib/database.types.ts`.
- In contract-surfaces:
  - add the new migration to „Source of truth”;
  - add a `## public.update_study_draft(...)` section with its errors and replace semantics;
  - in the Tables paragraph, the deadline columns are now written by `create_study` and `update_study_draft` (still no column update grant);
  - in Limits, the 2–6 count is also enforced by `update_study_draft`;
  - in the lock-order line, add `update_study_draft`;
  - add a short note that deleting an active study makes its links answer „Badanie jest zakończone” (`get_ballot` → `null`, `cast_vote` → `study_ended`).

### Success Criteria:

#### Automated Verification:

- Fresh database from migrations passes all pgTAP suites: `npx supabase db reset && npx supabase test db`
- Database lint is clean: `npx supabase db lint`
- Generated types match the migrations (regenerate, then `git diff --exit-code src/lib/database.types.ts`)
- Type check passes: `npx astro check`
- Lint passes: `npm run lint`

#### Manual Verification:

- `contract-surfaces.md` reads correctly: new function section, updated Tables, Limits and lock-order lines

**Implementation Note**: After this phase passes automated verification, pause for the human's manual confirmation before Phase 2.

---

## Phase 2: Draft editing

### Overview

The author edits a draft from its study page through the creation form in edit mode, saved via `update_study_draft`.

### Changes Required:

#### 1. Deadline → `datetime-local` helper

**File**: `src/lib/study-deadline.ts`, `tests/unit/study-deadline.test.ts`

**Intent**: Turn the stored instant plus zone into the `YYYY-MM-DDTHH:mm` value a `datetime-local` input needs, in that zone. Workers run in UTC, so the zone must be explicit.

**Contract**: `toLocalInputValue(closesAt: string, closesTz: string): string`. It uses `Intl.DateTimeFormat(…, { timeZone })` parts, and falls back to UTC for a zone Intl rejects, like `formatDeadline`.

Unit cases:

- `2030-06-15T16:00:00Z` with `Europe/Warsaw` → `2030-06-15T18:00`.
- A winter instant → +01.
- An instant in the doubled autumn hour round-trips to the local time Postgres would store.
- An Intl-invalid zone → the UTC value.

#### 2. Wizard edit mode

**File**: `src/components/studies/StudyWizard.tsx`

**Intent**: Reuse the creation form for editing without changing creation behaviour.

**Contract**: optional props:

- `action` (default `/api/studies`), `submitLabel` (default „Utwórz szkic”), `pendingText` (default „Tworzenie badania...”);
- `initial?: { title: string; participantTarget: number; variants: string[]; closesLocal: string; closesTz: string | null }`.

Behaviour:

- Initial state comes from `initial`; the variant keys stay unique for later additions.
- The hidden `closes_tz` sends `initial.closesTz` when present, otherwise the browser zone (see Critical Implementation Details).
- The deadline hint names the zone that will be sent.
- Creation (no `initial`) renders exactly as today.

#### 3. Edit page

**File**: `src/pages/studies/[id]/edit.astro`

**Intent**: Load the owner's draft and render the wizard in edit mode.

**Contract**:

- Read `studies` (`id, title, participant_target, status, closes_at, closes_tz`) and `variants` ordered by `position` through RLS, like `[id].astro`.
- RLS miss or `22P02` → status 404 with „Nie znaleziono badania” and a link back to the dashboard.
- Status other than `draft` → redirect to `/studies/<id>`.
- Otherwise render `<StudyWizard client:load action="/api/studies/<id>/update" submitLabel="Zapisz zmiany" pendingText="Zapisywanie..." initial={…} serverError={?error} />` with `closesLocal` from `toLocalInputValue`.
- `Cache-Control: no-store`. Title „Edytuj badanie”, plus a link back to `/studies/<id>`.

#### 4. Update endpoint

**File**: `src/pages/api/studies/[id]/update.ts`

**Intent**: Validate the form like the create endpoint and call `update_study_draft`.

**Contract**: `POST`, with form fields identical to create (`title`, `participant_target`, `variant[]`, `closes_local`, `closes_tz`). The same CRLF normalization and server `validate()` apply; move that function into a shared module under `src/lib/` rather than copying it.

Calls `rpc("update_study_draft", { p_study_id, …, p_closes_local/p_closes_tz only when closes_local is set })`, then maps:

- Validation failure or RPC `22023`/`23514` → `/studies/<id>/edit?error=<the same messages as create>`;
- `55000` → `/studies/<id>?error=Badanie już wystartowało — szkicu nie można edytować.`;
- `P0002`/`22P02` → `/studies/<id>` (renders the 404);
- Other error → edit page with a generic „Nie udało się zapisać zmian. Spróbuj ponownie.”;
- Success → `/studies/<id>`.

#### 5. Entry point and route access

**File**: `src/pages/studies/[id].astro`, `src/lib/route-access.ts`, `tests/unit/route-access.test.ts` (if it lists patterns), `tests/http/route-access.test.ts`

**Intent**: Make edit reachable from a draft and classify the new routes.

**Contract**:

- Draft view: an „Edytuj” link to `/studies/<id>/edit` above `StartStudyButton`.
- `ROUTE_AUDIENCE` gains `"/studies/[id]/edit": "author"` and `"/api/studies/[id]/update": "author"`.
- `PROBES` gains `GET` for the page and `POST` with a realistic form for the endpoint.

#### 6. HTTP tests

**File**: `tests/http/author-isolation.test.ts`, new `tests/http/edit-and-delete-study.test.ts`

**Intent**: Prove isolation and the edit behaviour through the app.

**Contract**:

- **Isolation (B against A's targets):**
  - `GET /studies/<target>/edit` → 404;
  - `POST /api/studies/<target>/update` → 302 to `/studies/<target>`;
  - afterwards, A's draft page still shows the original title.
- **Owner:**
  - Editing a draft (new title, three variants, a deadline) → 302 to `/studies/<id>`, and the page shows the new title, the three variants and the deadline.
  - Clearing the deadline removes the „Zakończy się automatycznie” line.
  - `GET /studies/<active>/edit` → 302 to `/studies/<active>`.
  - `POST …/update` on an active study → 302 with `?error=` and the study unchanged.
  - Invalid form (one variant) → 302 to `/studies/<id>/edit?error=…`.
- Add an `editStudy` helper to `tests/http/client.ts` only if two or more tests need it.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including `toLocalInputValue` and route-access classification: `npm run test:unit`
- HTTP tests pass against a fresh build, including the edit isolation and owner cases: `npm run build && npm run test:http` (with preview running)
- pgTAP still green: `npx supabase test db`
- Type check, lint and build pass: `npx astro check && npm run lint && npm run build`

#### Manual Verification:

- Creating a study still works exactly as before (empty form, „Utwórz szkic”)
- Editing a draft at phone width: prefilled values are correct, including the deadline in its stored zone; add/remove variant works; saving shows the new values
- A draft with a past deadline shows „Termin musi być w przyszłości.” on save until the deadline is moved or cleared
- An active study's page shows no „Edytuj”, and `/studies/<id>/edit` redirects to the study page

**Implementation Note**: After this phase passes automated verification, pause for the human's manual confirmation before Phase 3.

---

## Phase 3: Deleting a study

### Overview

The author deletes a study from its page with a two-step confirmation in any state, then sees a confirmation notice on the dashboard.

### Changes Required:

#### 1. Delete button

**File**: `src/components/studies/DeleteStudyButton.tsx`

**Intent**: An irreversible action guarded like `CloseStudyButton`, with a warning that names the consequence for the current state.

**Contract**: props `{ studyId: string; started: boolean }`.

- First step: „Usuń badanie”.
- Second step: a `<form method="POST" action="/api/studies/<id>/delete">` containing:
  - a `role="alert"` warning:
    - draft → „Szkic zostanie trwale usunięty.”;
    - started → „Badanie zostanie trwale usunięte razem z wynikami i komentarzami. Linki przestaną działać — uczestnicy zobaczą „Badanie jest zakończone”.”;
  - „Tak, usuń” (`SubmitButton`, pending text „Usuwanie...”);
  - „Anuluj”.
- The `pageshow` reset is copied from `CloseStudyButton`.

#### 2. Delete endpoint

**File**: `src/pages/api/studies/[id]/delete.ts`

**Intent**: Delete through the existing RLS policy and tell a real deletion apart from „not yours / not found” without revealing which.

**Contract**:

- `POST`, `supabase.from("studies").delete().eq("id", id).select("id")`.
- One row → `/dashboard?deleted=1`.
- Zero rows or `22P02` → `/studies/<id>` (404 page; also covers a double submit).
- Other error → `/studies/<id>?error=Nie udało się usunąć badania. Spróbuj ponownie.`

#### 3. Study page and dashboard

**File**: `src/pages/studies/[id].astro`, `src/pages/dashboard.astro`

**Intent**: Offer delete in every state and confirm it afterwards.

**Contract**:

- Study page: render `<DeleteStudyButton client:load studyId started={shown.status !== "draft"} />` last in the actions area, for draft, active and closed studies.
- Dashboard: when `?deleted=1`, show „Badanie zostało usunięte.” above the list with `role="status"`. Static text only; nothing from the URL is echoed.

#### 4. Route access, tests and cleanup comment

**File**: `src/lib/route-access.ts`, `tests/http/route-access.test.ts`, `tests/http/author-isolation.test.ts`, `tests/http/edit-and-delete-study.test.ts`, `tests/e2e/support/cleanup.ts`

**Intent**: Classify the endpoint and prove delete isolation and its participant-facing outcome.

**Contract**:

- `ROUTE_AUDIENCE` gains `"/api/studies/[id]/delete": "author"`, and `PROBES` a `POST` row.
- **Isolation:** B's `POST /api/studies/<target>/delete` → 302 to `/studies/<target>`, and A's draft and active studies still render for A. Run this before A's own controls.
- **Owner:**
  - Deleting a draft → 302 to `/dashboard?deleted=1`. The dashboard shows the notice and no longer lists the title. `/studies/<id>` → 404.
  - Deleting a started study (`createStartedStudy`) → `GET /v/<one of its tokens>` renders „Badanie jest zakończone”, and `POST /api/v/<token>` does not accept a vote.
- Cleanup comment: drop „no delete route yet”. Cleanup keeps using supabase-js, because it deletes by title.

### Success Criteria:

#### Automated Verification:

- HTTP tests pass against a fresh build, including delete isolation and the participant „ended” screen: `npm run build && npm run test:http` (with preview running)
- Unit tests pass (route-access classification): `npm run test:unit`
- pgTAP still green: `npx supabase test db`
- Type check, lint and build pass: `npx astro check && npm run lint && npm run build`
- Existing e2e specs still pass: `npx playwright test`

#### Manual Verification:

- At phone width, „Usuń badanie” on a draft, an active and a closed study shows the matching warning; „Anuluj” returns to the first step
- Deleting an active study lands on the dashboard with „Badanie zostało usunięte.”, and one of its links opened in another browser shows „Badanie jest zakończone”
- Before merge, the migration is pushed to production (`npx supabase db push`), because CI does not apply migrations

**Implementation Note**: After this phase passes automated verification, pause for the human's manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `toLocalInputValue`: summer/winter offset, doubled autumn hour, Intl-invalid zone → UTC (oracle: the stored instant and the zone rules, not the implementation).
- Route-access classification of the three new patterns.

### Integration Tests:

- **pgTAP** (`edit_and_delete_study.test.sql`): owner edit and replace semantics; draft-only (55000); 22023/23514 validation with nothing changed; B against A, anon and no-uid; post-delete `get_ballot` null and `cast_vote` `study_ended` with no child rows left.
- **HTTP**: B against A for the edit page, update and delete; the owner's edit, refusal and delete flows; the signed-out redirect via the `PROBES` matrix; `/v/<token>` after delete.

### Manual Testing Steps:

1. Create a draft with a deadline, edit it (change title, add a variant, move the deadline), and check the study page.
2. Edit again and clear the deadline; the study page no longer shows it.
3. Start the study and confirm „Edytuj” is gone and `/studies/<id>/edit` redirects.
4. Delete the active study, check the dashboard notice, and open one of its links: „Badanie jest zakończone”.

## Performance Considerations

None: single-row operations on an author's own study (at most 6 variants and 100 links in the cascade).

## Migration Notes

A forward-only migration that adds a function and touches no data. Push to production with `npx supabase db push` before the app deploy that uses `update_study_draft` (CI does not apply migrations). Rollback: the app can revert independently; the unused function is harmless.

## References

- Roadmap: `context/foundation/roadmap.md` (S-06)
- PRD: `context/foundation/prd.md` (FR-010, FR-017, FR-018)
- Contracts: `docs/reference/contract-surfaces.md`
- Writer to mirror: `supabase/migrations/20261015130000_study_closing_rules.sql:247-304` (`start_study`), `supabase/migrations/20261015170000_study_deadline_zone_hardening.sql:22-92` (`create_study`)
- Isolation matrix: `context/archive/2026-10-06-testing-access-boundaries/research.md:114-139`
- Patterns: `src/pages/api/studies/index.ts`, `src/pages/api/studies/[id]/close.ts`, `src/components/studies/CloseStudyButton.tsx`, `tests/http/author-isolation.test.ts`
- Previous slice: `context/changes/author-study-dashboard/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database — update_study_draft

#### Automated

- [x] 1.1 Fresh database from migrations passes all pgTAP suites: `npx supabase db reset && npx supabase test db` — 8a31499
- [x] 1.2 Database lint is clean: `npx supabase db lint` — 8a31499
- [x] 1.3 Generated types match the migrations (regenerate, then `git diff --exit-code src/lib/database.types.ts`) — 8a31499
- [x] 1.4 Type check passes: `npx astro check` — 8a31499
- [x] 1.5 Lint passes: `npm run lint` — 8a31499

#### Manual

- [x] 1.6 `contract-surfaces.md` reads correctly: new function section, updated Tables, Limits and lock-order lines — 8a31499

### Phase 2: Draft editing

#### Automated

- [x] 2.1 Unit tests pass, including `toLocalInputValue` and route-access classification: `npm run test:unit` — d694e1d
- [x] 2.2 HTTP tests pass against a fresh build, including the edit isolation and owner cases: `npm run build && npm run test:http` (with preview running) — d694e1d
- [x] 2.3 pgTAP still green: `npx supabase test db` — d694e1d
- [x] 2.4 Type check, lint and build pass: `npx astro check && npm run lint && npm run build` — d694e1d

#### Manual

- [x] 2.5 Creating a study still works exactly as before (empty form, „Utwórz szkic”) — d694e1d
- [x] 2.6 Editing a draft at phone width: prefilled values are correct, including the deadline in its stored zone; add/remove variant works; saving shows the new values — d694e1d
- [x] 2.7 A draft with a past deadline shows „Termin musi być w przyszłości.” on save until the deadline is moved or cleared — d694e1d
- [x] 2.8 An active study's page shows no „Edytuj”, and `/studies/<id>/edit` redirects to the study page — d694e1d

### Phase 3: Deleting a study

#### Automated

- [x] 3.1 HTTP tests pass against a fresh build, including delete isolation and the participant „ended” screen: `npm run build && npm run test:http` (with preview running)
- [x] 3.2 Unit tests pass (route-access classification): `npm run test:unit`
- [x] 3.3 pgTAP still green: `npx supabase test db`
- [x] 3.4 Type check, lint and build pass: `npx astro check && npm run lint && npm run build`
- [x] 3.5 Existing e2e specs still pass: `npx playwright test`

#### Manual

- [x] 3.6 At phone width, „Usuń badanie” on a draft, an active and a closed study shows the matching warning; „Anuluj” returns to the first step
- [x] 3.7 Deleting an active study lands on the dashboard with „Badanie zostało usunięte.”, and one of its links opened in another browser shows „Badanie jest zakończone”
- [ ] 3.8 Before merge, the migration is pushed to production (`npx supabase db push`), because CI does not apply migrations
