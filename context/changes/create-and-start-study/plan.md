# Create and Start a Text Study Implementation Plan

## Overview

Roadmap item **S-01** (`create-and-start-study`, issue #6). A signed-in author creates a text study in a wizard (title, 2–6 text variants, N between 1 and 100), which is saved as a draft. On the study page they click „Rozpocznij”, confirm, and the database generates exactly N one-time links in one transaction and makes the study `active`. The study page then lists the links with „Kopiuj wszystkie” and per-link copy buttons, and stays reachable from a minimal list on the dashboard. Covers US-01 (author side up to link distribution), FR-003 (text part), FR-004, FR-005, FR-006.

## Current State Analysis

F-01 (`study-data-model`, archived 2026-10-02) shipped the schema, RLS, `cast_vote` and `get_study_results` to production. What S-01 lacks:

- No way to change `studies.status`: it is in no column grant, so only a `security definer` function can move a study `draft → active`. F-01 explicitly left `start_study` and the upper bounds to S-01.
- Authors cannot insert into `study_links` (no grant), so link generation must also live in that definer function.
- Limits are sanity checks only: `participant_target > 0`, `position >= 0`, no cap on variant count.
- App side: `/dashboard` is a placeholder; there are no study pages, no study API endpoints, no React island beyond the auth forms. UI copy today is English.
- `contract-surfaces.md` carries an open note to "revisit in S-01" the fact that authors hold raw tokens.

## Desired End State

- An author opens `/dashboard`, clicks „Nowe badanie”, fills the wizard and lands on `/studies/<id>` showing the draft (title, N, variants in order) and a „Rozpocznij” button.
- Confirming „Rozpocznij” makes the study `active` and creates exactly N links; the page then lists N URLs of the form `<origin>/v/<token>` with „Kopiuj wszystkie” (one URL per line) and per-link copy.
- The author can come back via the dashboard list at any time and copy the links again.
- The database rejects N outside 1–100, creating a study with fewer than 2 or more than 6 variants, and starting a study that is not the caller's draft or does not have 2–6 variants; a failed start creates no links.
- Verified by the pgTAP suite (`npx supabase test db`), the app gate, and the manual checks per phase.

### Key Discoveries:

- `studies.status` has no column grant; status changes are function-only — `supabase/migrations/20261002095727_study_data_model.sql:96-104`.
- `study_links.token` defaults to `encode(extensions.gen_random_bytes(16), 'hex')` — inserting rows with only `study_id` yields 128-bit tokens — `20261002095727_study_data_model.sql:43`.
- `unique (study_id, position)` already exists on `variants` — `20261002095727_study_data_model.sql:36`. Position stays a plain sort key (no upper bound): tying the 6-variant cap to position numbers would break S-06 (delete + re-add leaves a gap; swaps need a free slot). The 2–6 count is enforced in `create_study` and re-checked under lock in `start_study`, the only path to `active`.
- RLS policies for variant insert require the parent study to be the caller's `draft` — `20261002095727_study_data_model.sql:150-159`, so a `security invoker` create function is fully covered by existing policies.
- F-01 deferred `start_study`, link generation and upper bounds to S-01 — `context/archive/2026-10-02-study-data-model/plan.md:37,45`.
- Form endpoints redirect and pass errors via `?error=` — `src/pages/api/auth/signin.ts`; React islands follow `SignInForm`/`FormField` — `src/components/auth/`.
- Protected pages are listed in `PROTECTED_ROUTES` — `src/middleware.ts:4`.
- Migrations are forward-only, both F-01 migrations are in production — `docs/reference/contract-surfaces.md`, `AGENTS.md`.

## What We're NOT Doing

- Editing or deleting drafts/studies (S-06). A draft with a mistake stays until S-06; the author creates a new one.
- The participant voting page at `/v/<token>` (S-02) — S-01 only produces the URLs.
- Results, ranking, progress „X z N” on the study page (S-03), closing rules (S-04), the full dashboard with status and progress (S-05), extra links (S-07), image variants (S-08).
- Hiding tokens from authors or HMAC-derived links — the probe-your-own-links limit is accepted and documented instead.
- Translating the existing English auth pages, topbar and layout.
- App unit/e2e tests (none exist in the repo; DB guarantees are covered by pgTAP).

## Implementation Approach

Mirror F-01: put the guarantees in the database first and prove them with pgTAP, then build the UI on top. Two RPCs carry the writes: `create_study` (security **invoker**, so RLS and grants still apply) creates a study and its variants atomically; `start_study` (security **definer**) does the one privileged transition — lock, verify owner/draft/variant count, insert N links, set `active` — in one transaction. The limits live as check constraints plus RPC checks in SQL and as named constants in `src/lib/study-limits.ts` for client and server validation. Pages follow the existing pattern: Astro pages read through the RLS-scoped server client; mutations are form POSTs to `src/pages/api/` endpoints that redirect; interactive pieces are small React islands. New UI copy is Polish.

## Critical Implementation Details

**Atomic start.** `start_study` must lock the study row (`select … for update`) before checking `status = 'draft'`, so two concurrent clicks cannot both generate links; the second call sees `active` and raises. Any raised error rolls back the inserted links, so a study never ends up with partial links (the S-01 risk in the roadmap).

**Existing constraint names.** The checks to replace were created inline, so Postgres named it `studies_participant_target_check`; confirm with `\d` locally before writing `drop constraint`. Production has no studies yet (no UI existed), so tightening the check cannot fail on existing rows; confirm with a read-only count before the push.

## Phase 1: Database — limits, `create_study`, `start_study`

### Overview

Forward migration with the new limits and both RPCs, a pgTAP suite proving them, regenerated types and an updated contract registry.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_create_and_start_study.sql` (via `npx supabase migration new create_and_start_study`)

**Intent**: Enforce the agreed limits in the schema and add the two write paths S-01 needs, without editing the production migrations.

**Contract**:
- `studies`: replace the `participant_target` check with `participant_target between 1 and 100`.
- `variants`: unchanged (`position >= 0` stays). The variant count is not a table constraint; see the two functions below.
- `public.create_study(p_title text, p_participant_target integer, p_variants text[]) returns uuid` — `language plpgsql`, `security invoker`, `set search_path = ''`. Trims title and each variant; raises SQLSTATE `22023` when the array has fewer than 2 or more than 6 entries or any trimmed variant is empty; inserts the study (author defaults to `auth.uid()`) and the variants with `position` = array index starting at 0; returns the study id. Length and N violations surface as the table check constraints (`23514`). Execute: revoke from `public`, `anon`; grant to `authenticated`.
- `public.start_study(p_study_id uuid) returns void` — `language plpgsql`, `security definer`, `set search_path = ''`. Locks the study row owned by `auth.uid()`; raises `P0002` if none (unknown or someone else's); `55000` if `status <> 'draft'`; `22023` if the variant count is outside 2–6. Otherwise inserts `participant_target` rows into `study_links` (only `study_id`, token from the default) and sets `status = 'active'`. Execute: revoke from `public`, `anon`; grant to `authenticated`.

#### 2. pgTAP suite

**File**: `supabase/tests/create_and_start_study.test.sql`

**Intent**: Prove the limits and the start transition as the real roles, following the fixture/role-switch pattern of the F-01 suites.

**Contract**: Cases, as author A unless noted:
- `create_study` with 2 variants returns an id; the study is `draft`, owned by A, variants at positions 0 and 1 with trimmed content.
- `create_study` with 1 or 7 variants, or a blank variant → `22023`; with N = 0 or N = 101 → `23514`; nothing is inserted in these cases.
- A draft given a 7th variant by direct insert (fixture) → `start_study` raises `22023`, zero links, still `draft`.
- `start_study` on A's 2-variant draft with N = 3 → status `active`, exactly 3 links, all tokens distinct and 32 hex chars.
- Second `start_study` on the same study → `55000`, link count unchanged.
- `start_study` on a draft with 1 variant (fixture) → `22023`, zero links, still `draft`.
- As author B, `start_study` on A's draft → `P0002`, A's study unchanged.
- `anon` gets permission denied executing `create_study` and `start_study`.

#### 3. Types

**File**: `src/lib/database.types.ts`

**Intent**: Expose the new RPCs to the typed client.

**Contract**: Regenerate with `npx supabase gen types typescript --local > src/lib/database.types.ts` from Git Bash, then `npx prettier --write` it.

#### 4. Contract registry

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Record the new load-bearing names and settle the open token note.

**Contract**: Add sections for `create_study` and `start_study` (signature, who may call, error codes); add the limits (N 1–100 total links per study — S-07 must respect it; variants 2–6, enforced by `create_study` and `start_study`, not by a table constraint); add the vote URL path `/v/<token>` that S-02 must serve; rewrite the "Known, accepted limit" paragraph so it no longer says "revisit in S-01" but records the decision: authors read tokens because they distribute the links; the probe is destructive and visible in `responded`, so it is accepted.

### Success Criteria:

#### Automated Verification:

- Migrations apply on a fresh local database: `npx supabase db reset`
- All database tests pass, including the new suite: `npx supabase test db`
- Database lint reports no errors: `npx supabase db lint`
- App gate passes with regenerated types: `npm run lint`, `npx astro check`, `npm run build`

#### Manual Verification:

- `contract-surfaces.md` lists `create_study`, `start_study`, the limits, `/v/<token>`, and the token note as an accepted limit

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Wizard and draft page

### Overview

The author can create a draft through the wizard, see it on its own page, and find it again from the dashboard.

### Changes Required:

#### 1. Limits module

**File**: `src/lib/study-limits.ts`

**Intent**: One place for the numbers the UI and API validate against, mirroring the DB.

**Contract**: Named exports `MIN_VARIANTS = 2`, `MAX_VARIANTS = 6`, `MIN_PARTICIPANTS = 1`, `MAX_PARTICIPANTS = 100`, `MAX_TITLE_LENGTH = 200`, `MAX_VARIANT_LENGTH = 2000`, with a comment pointing at the migration that enforces them.

#### 2. Wizard page and island

**Files**: `src/pages/studies/new.astro`, `src/components/studies/StudyWizard.tsx`

**Intent**: A single-page wizard: title, N, and a variant list starting with 2 empty fields, „Dodaj wariant” (disabled at 6) and remove buttons (disabled at 2). Client-side validation with Polish messages blocks submit; a server error arrives via `?error=`.

**Contract**: `StudyWizard` is a default-export island (`client:load`) posting a form to `POST /api/studies` with fields `title`, `participant_target`, and repeated `variant`. Reuses `FormField`, `SubmitButton`, `ServerError` from `src/components/auth/`. Styling follows the auth cards. `SubmitButton`'s `useFormStatus` does not track a native form POST, so the island keeps its own `submitting` state set in `onSubmit` and disables the button with it — a double click must not create two drafts.

#### 3. Create endpoint

**File**: `src/pages/api/studies/index.ts`

**Intent**: Validate the form on the server with the same limits and call `create_study`.

**Contract**: `POST`; handles the `createClient()` `null` branch; reads `variant` with `getAll`; on success redirects to `/studies/<id>`; on validation or RPC error redirects to `/studies/new?error=<Polish message>`.

#### 4. Study page (draft view)

**File**: `src/pages/studies/[id].astro`

**Intent**: Show the author's study; in `draft` show title, N and variants in `position` order. Unknown or someone else's id (RLS returns nothing) returns `new Response(null, { status: 404 })` (there is no `src/pages/404.astro`; Astro serves its default).

**Contract**: Reads `studies` and `variants` through the RLS-scoped server client. Phase 3 adds the start button and the link list to this page.

#### 5. Dashboard entry and minimal list

**File**: `src/pages/dashboard.astro`

**Intent**: Give the author a way in and a way back: a „Nowe badanie” button to `/studies/new`, and a bare list of their studies (title + status label Szkic/Trwa/Zakończone, newest first) linking to `/studies/<id>`. S-05 replaces this with the full dashboard.

**Contract**: Reads `studies (id, title, status, created_at)` via RLS.

#### 6. Route protection

**File**: `src/middleware.ts`

**Intent**: Keep signed-out users out of the new pages and endpoints.

**Contract**: Add `/studies` and `/api/studies` to `PROTECTED_ROUTES`.

### Success Criteria:

#### Automated Verification:

- App gate passes: `npm run lint`, `npx astro check`, `npm run build`

#### Manual Verification:

- Creating a study with a title, N = 3 and 2 variants lands on `/studies/<id>` showing the draft with variants in order
- The wizard blocks fewer than 2 or more than 6 variants, N outside 1–100 and blank fields, with Polish messages
- The dashboard shows „Nowe badanie” and the author's studies; signed out, `/studies/new` redirects to sign-in
- Opening another author's study id shows 404

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Start the study and copy links

### Overview

„Rozpocznij” with confirmation turns the draft into an active study with N links, and the study page lists the links for copying.

### Changes Required:

#### 1. Start endpoint

**File**: `src/pages/api/studies/[id]/start.ts`

**Intent**: Call `start_study` and send the author back to the study page.

**Contract**: `POST`; handles the `null` client branch; success → redirect `/studies/<id>`. `55000` (already started, e.g. double submit) → redirect to `/studies/<id>` without an error. `P0002` → `new Response(null, { status: 404 })`. `22023` and other errors → `/studies/<id>?error=<Polish message>`.

#### 2. Start button island

**File**: `src/components/studies/StartStudyButton.tsx`

**Intent**: Make the irreversible step explicit. First click shows an inline confirmation („Po rozpoczęciu badania nie można już zmienić. Zostanie wygenerowanych N linków.”) with „Tak, rozpocznij” (submits the form; disabled via local `submitting` state set in `onSubmit`, since `useFormStatus` does not see a native POST) and „Anuluj”. No `window.confirm`.

**Contract**: Default-export island; props `studyId`, `participantTarget`; posts to `/api/studies/<id>/start`.

#### 3. Vote URL helper

**File**: `src/lib/study-links.ts`

**Intent**: One function that builds participant URLs, so S-02's route and S-01's links cannot drift.

**Contract**: `voteUrl(origin: string, token: string): string` → `${origin}/v/${token}`. The page passes `Astro.url.origin`.

#### 4. Link list island

**File**: `src/components/studies/LinkList.tsx`

**Intent**: FR-006 — easy copying. „Kopiuj wszystkie” copies all URLs joined by newlines; each row has its own copy button; a short „Skopiowano” state confirms; if the clipboard API fails, show a message that the link can be selected by hand (the URLs are visible as selectable text).

**Contract**: Default-export island; props `urls: string[]`; uses `navigator.clipboard.writeText`.

#### 5. Study page (active view)

**File**: `src/pages/studies/[id].astro`

**Intent**: In `draft` render `StartStudyButton`; once links exist (status `active` or later), render the variants read-only plus `LinkList` with the N URLs, ordered stably (by link `id`). Show `?error=` via `ServerError`.

**Contract**: Reads `study_links (id, token)` through the RLS-scoped client — never `used`.

### Success Criteria:

#### Automated Verification:

- App gate passes: `npm run lint`, `npx astro check`, `npm run build`
- Database tests still pass: `npx supabase test db`

#### Manual Verification:

- „Rozpocznij” asks for confirmation; after confirming, the study is active and exactly N links are listed as `<origin>/v/<token>`
- „Kopiuj wszystkie” puts N lines in the clipboard, a row's copy button puts one URL, and „Skopiowano” appears
- Returning to the study via the dashboard shows the same links; the start button is gone and no extra links appear after a double click

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Production rollout

### Overview

Apply the migration to the production Supabase project, then ship the app by merging to `main`.

### Changes Required:

#### 1. Database push

**Intent**: Make the new constraints and RPCs available before the app code that calls them is deployed.

**Contract**: 👤 user, after explicit approval: read-only check that production has no rows violating the new checks, then `npx supabase db push` (project already linked in F-01) and `npx supabase migration list` showing local = remote. Do not apply via MCP `apply_migration` (it records a different version). Then check security advisors (MCP `get_advisors`, type `security`, read-only).

#### 2. App deploy

**Intent**: Ship the UI.

**Contract**: Open a PR to `main`; CI (`ci.yml`, `deploy.yml` verify job) must be green; merging deploys to Cloudflare Workers.

### Success Criteria:

#### Automated Verification:

- CI is green on the PR, including `supabase test db`

#### Manual Verification:

- Migration pushed after approval; `npx supabase migration list` shows local and remote in sync
- Security advisors show no new ERROR (expected WARN for definer `start_study`)
- In production, an author creates a study, starts it and copies the links

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- None for app code (no unit suite in the repo). Validation logic in the endpoint and wizard shares `study-limits.ts`.

### Integration Tests:

- pgTAP `create_and_start_study.test.sql`: limits, atomic start, ownership, double start, role permissions (Phase 1).
- Existing F-01 suites keep passing (fixtures use N = 3 and positions 0–2, inside the new limits).

### Manual Testing Steps:

1. Sign in, „Nowe badanie”, create „Test CTA” with N = 3 and variants „Kup teraz” / „Sprawdź ofertę”.
2. Try 1 and 7 variants, N = 0 and 101, blank title — wizard refuses with Polish messages.
3. On the draft page click „Rozpocznij”, cancel, click again, confirm — 3 links appear.
4. „Kopiuj wszystkie” and paste — 3 lines; copy a single link — 1 URL.
5. Reload, return via dashboard — same 3 links, no start button.
6. As a second account, open the first study's URL — 404.

## Performance Considerations

N ≤ 100 means `start_study` inserts at most 100 rows in one statement; the study page reads at most 6 variants and 100 links — one round trip each, well within the Workers CPU budget.

## Migration Notes

Forward-only migration; F-01 migrations stay untouched. Tightened checks are safe because production has no studies; this is verified read-only before the push.

## References

- Roadmap: `context/foundation/roadmap.md` (S-01, limits resolved 2026-10-05)
- PRD: `context/foundation/prd.md` (US-01, FR-003–FR-006, Access Control)
- F-01 plan: `context/archive/2026-10-02-study-data-model/plan.md`
- Schema: `supabase/migrations/20261002095727_study_data_model.sql`
- Contracts: `docs/reference/contract-surfaces.md`
- Patterns: `src/pages/api/auth/signin.ts`, `src/components/auth/SignInForm.tsx`, `src/middleware.ts:4`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database — limits, `create_study`, `start_study`

#### Automated

- [x] 1.1 Migrations apply on a fresh local database: `npx supabase db reset` — 4fec0a8
- [x] 1.2 All database tests pass, including the new suite: `npx supabase test db` — 4fec0a8
- [x] 1.3 Database lint reports no errors: `npx supabase db lint` — 4fec0a8
- [x] 1.4 App gate passes with regenerated types: `npm run lint`, `npx astro check`, `npm run build` — 4fec0a8

#### Manual

- [x] 1.5 `contract-surfaces.md` lists `create_study`, `start_study`, the limits, `/v/<token>`, and the token note as an accepted limit — 4fec0a8

### Phase 2: Wizard and draft page

#### Automated

- [x] 2.1 App gate passes: `npm run lint`, `npx astro check`, `npm run build`

#### Manual

- [x] 2.2 Creating a study with a title, N = 3 and 2 variants lands on `/studies/<id>` showing the draft with variants in order
- [x] 2.3 The wizard blocks fewer than 2 or more than 6 variants, N outside 1–100 and blank fields, with Polish messages
- [x] 2.4 The dashboard shows „Nowe badanie” and the author's studies; signed out, `/studies/new` redirects to sign-in
- [x] 2.5 Opening another author's study id shows 404

### Phase 3: Start the study and copy links

#### Automated

- [ ] 3.1 App gate passes: `npm run lint`, `npx astro check`, `npm run build`
- [ ] 3.2 Database tests still pass: `npx supabase test db`

#### Manual

- [ ] 3.3 „Rozpocznij” asks for confirmation; after confirming, the study is active and exactly N links are listed as `<origin>/v/<token>`
- [ ] 3.4 „Kopiuj wszystkie” puts N lines in the clipboard, a row's copy button puts one URL, and „Skopiowano” appears
- [ ] 3.5 Returning to the study via the dashboard shows the same links; the start button is gone and no extra links appear after a double click

### Phase 4: Production rollout

#### Automated

- [ ] 4.1 CI is green on the PR, including `supabase test db`

#### Manual

- [ ] 4.2 Migration pushed after approval; `npx supabase migration list` shows local and remote in sync
- [ ] 4.3 Security advisors show no new ERROR (expected WARN for definer `start_study`)
- [ ] 4.4 In production, an author creates a study, starts it and copies the links
