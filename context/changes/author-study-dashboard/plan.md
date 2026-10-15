# Author Study Dashboard (S-05) Implementation Plan

## Overview

Replace the template stub on `/dashboard` with the author's study list required by FR-002. Each row shows the title, the effective status (Szkic / Trwa / Zakończone) and progress: „Odpowiedziało X z N” for started studies, and „Planowane: N uczestników” for drafts. A new `security definer` RPC, `list_author_studies()`, supplies the counts in one call, because authors may not read `study_links.used`.

## Current State Analysis

- `src/pages/dashboard.astro:15-24` already lists the author's studies. It uses `.from("studies").select("id, title, effective_status, created_at")` under RLS, newest first, with `overrideTypes` because the generated types cannot see the computed field. It labels the status through `STATUS_LABELS` (`src/lib/study-status.ts:10-14`) and has empty and error states.
- Progress is missing. Under the anonymity rule (`docs/reference/contract-surfaces.md#anonymity-rule`), `authenticated` can select only `study_links (id, study_id, token)`, never `used`. The only path to `responded`/`total` today is `get_study_results(p_study_id)`, a per-study definer function that also aggregates votes and comments (`supabase/migrations/20261015130000_study_closing_rules.sql:123-168`).
- The page is still template chrome: English „Welcome, {email}”, „This page is only for authenticated users.”, an h1 „Dashboard”, and its own „Sign out” form. `Topbar` (`src/components/Topbar.astro`) already renders the email, a Dashboard link and Sign out, but only `Welcome.astro` uses it.
- Tests that touch the page:
  - `tests/e2e/auth.setup.ts:26-27` asserts `Welcome, ${username}`.
  - `tests/e2e/seed.spec.ts:12-13` asserts the h1 „Dashboard” and the same greeting.
  - `tests/http/author-isolation.test.ts:86-92` asserts that B's dashboard lists only B's study.

## Desired End State

A signed-in author opens `/dashboard` and sees „Twoje badania”, a „Nowe badanie” button and a list of only their own studies, newest first. Each row links to `/studies/<id>` and shows:

- the effective status label (a study past its deadline reads „Zakończone”);
- for `active`/`closed`: „Odpowiedziało X z N”, where X = used links and N = the live link count;
- for `draft`: „Planowane: N uczestników”, where N = `participant_target`.

Verify with pgTAP (`npx supabase test db`), `npm run test:http`, the e2e suite, and a manual look at a draft, an active study with votes, and a closed study.

### Key Discoveries:

- Template for the RPC: `get_study_results` has `security definer`, `set search_path = ''`, `s.author_id = auth.uid()` in the body, `revoke execute … from public, anon` and `grant … to authenticated` (`…study_closing_rules.sql:123-168`).
- Every new function needs an explicit revoke, because Supabase's default privileges grant `anon` EXECUTE on new functions in `public` (`context/archive/2026-10-15-study-closing-rules/plan.md:97`).
- Every reader must use the effective status: `study_status_effective(s.status, s.closes_at)` (`contract-surfaces.md#closing-rule`).
- „X z N” uses N = `total` (live link count), not `participant_target`, because S-07 adds links mid-study (`contract-surfaces.md#results-view`).
- Prod migrations are not applied by CI. `.github/workflows/ci.yml` deploys only the app, so the migration has to be pushed to the prod database with `npx supabase db push` at merge time.

## What We're NOT Doing

- No change to `get_study_results`, `effective_status` or the results page. `effective_status` stays a contract surface, even though the dashboard stops selecting it.
- No pagination, filtering, sorting controls or search. The PRD keeps the dashboard to a plain list (Socrates round at FR-002).
- No close, edit or delete actions on the list (S-06 and the study page own those).
- No live polling on the dashboard. Progress is as of page load.
- No full visual restyle or design tokens (a separate `/10x-ui` change if wanted).
- No e2e spec for the dashboard. The test plan reserves e2e for the full study loop; only the existing setup/seed locators are updated.
- No CI migration step (a separate follow-up change).

## Implementation Approach

Phase 1 adds the read model in the database: one owner-scoped definer RPC that returns a typed row set. Owner filtering and the anonymity boundary therefore live where the existing ones do, and pgTAP proves them. Phase 2 points the page at the RPC, removes the stub chrome, and updates the tests whose locators referenced the stub.

## Critical Implementation Details

- **Return a row set, not jsonb.** `returns table (…)` makes `supabase gen types` emit typed `Returns` rows, so the dashboard can drop `overrideTypes`. It also lets PostgREST apply `.order()` if ever needed. Ordering is fixed in the function (`created_at desc, id`) so the page does not depend on the client.
- **Stage the prod deploy.** Merging Phase 2 without pushing the migration breaks the production dashboard: the RPC returns 404 (the S-04 incident). Push the migration before or together with the merge.

## Phase 1: RPC listy badań autora

### Overview

Add `public.list_author_studies()` with pgTAP coverage, regenerate types and document the contract.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_author_study_dashboard.sql` (new, forward-only)

**Intent**: Return the caller's studies, each with its effective status and its link counts, so the dashboard needs a single call and never touches `study_links.used`.

**Contract**:

- `public.list_author_studies() returns table (id uuid, title text, status public.study_status, participant_target integer, responded integer, total integer, created_at timestamptz)`
- `language sql`, `stable`, `security definer`, `set search_path = ''`.
- Rows: `studies where author_id = auth.uid()`, so no `auth.uid()` returns zero rows. Ordered by `created_at desc, id`.
- `status` = `study_status_effective(s.status, s.closes_at)`.
- `responded` = count of `study_links` with `used` for the study. `total` = count of all its `study_links`. Both are `0` for a draft.
- `revoke execute … from public, anon`; `grant execute … to authenticated`.

#### 2. pgTAP suite

**File**: `supabase/tests/author_study_dashboard.test.sql` (new)

**Intent**: Prove counts, status, isolation and the anonymity boundary, following the `study_isolation` / `study_anonymity` fixtures style.

**Contract**: the suite asserts that:

- author A gets exactly A's studies (draft, active with some used links, closed, active past deadline) and none of B's;
- `responded`/`total` match the used/all link counts, and a draft returns `0`/`0` with its `participant_target`;
- a study past its deadline returns `status = 'closed'`;
- rows come newest first;
- the result columns are exactly `id, title, status, participant_target, responded, total, created_at`;
- with no `auth.uid()` the call returns zero rows;
- `anon` gets `42501` on execute.

#### 3. Types

**File**: `src/lib/database.types.ts`

**Intent**: Regenerate so `list_author_studies` appears under `Functions` with typed rows.

**Contract**: `npx supabase gen types typescript --local > src/lib/database.types.ts`.

#### 4. Contract surfaces

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Record the new load-bearing read path and its rules.

**Contract**:

- Add the migration to the source-of-truth list.
- Add a `## public.list_author_studies()` section: signature, callers, owner scoping, column set, ordering, the effective status, `responded`/`total` semantics, and that N for started studies is `total`, not `participant_target`.
- Under the anonymity rule, note that it exposes only per-study aggregates already available through `get_study_results`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly on a fresh local database: `npx supabase db reset`
- All pgTAP suites pass, including author_study_dashboard.test.sql: `npx supabase test db`
- Regenerated types compile: `npx astro check`

#### Manual Verification:

- contract-surfaces.md documents list_author_studies, its column set and the N = total rule

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 2: Docelowa strona /dashboard

### Overview

Point the page at the RPC, render progress per status, remove the template chrome, and update the tests that referenced it.

### Changes Required:

#### 1. Progress label helper

**File**: `src/lib/study-status.ts` (or a new `src/lib/study-progress.ts` beside it), with `tests/unit/study-progress.test.ts`

**Intent**: Keep the per-status progress wording in one tested, pure function, not inline in the template.

**Contract**:

- `progressLabel({ status, responded, total, participant_target }): string` returns `Planowane: ${participant_target} uczestników` for `draft`, otherwise `Odpowiedziało ${responded} z ${total}`.
- Unit tests cover draft, active and closed.

#### 2. Dashboard page

**File**: `src/pages/dashboard.astro`

**Intent**: Render the target list from `list_author_studies()` and drop the template stub.

**Contract**:

- Data: `supabase.rpc("list_author_studies")`; remove the `.from("studies")` query and `overrideTypes`.
- Layout:
  - `Topbar` provides the email and Sign out (remove the page's own form and the „Welcome…” / „This page is only for authenticated users” texts);
  - h1 „Twoje badania”;
  - a „Nowe badanie” link.
- Each row: link to `/studies/<id>`, title, `STATUS_LABELS[status]` and `progressLabel(row)`.
- Keep the error („Nie udało się wczytać badań.”) and empty („Nie masz jeszcze żadnych badań.”) states.
- The status and progress for a started study read e.g. „Trwa · Odpowiedziało 3 z 10”.

#### 3. HTTP isolation test

**File**: `tests/http/author-isolation.test.ts`

**Intent**: Prove that the page renders progress from the owner-scoped data, not only the titles.

**Contract**: extend the `B: GET /dashboard …` case, or add one, to assert that B's draft row shows „Planowane: N uczestników” with B's N, and that A's titles stay absent.

#### 4. E2E locators

**Files**: `tests/e2e/auth.setup.ts`, `tests/e2e/seed.spec.ts`

**Intent**: The greeting text is gone, so the signed-in check moves to the new page structure. This is a locator update in a reviewed diff; the protected behavior (a signed-in author stays on `/dashboard`) is unchanged.

**Contract**: assert `getByRole("heading", { name: "Twoje badania", level: 1 })` and `getByText(<E2E_USERNAME>)` (rendered by `Topbar`) instead of `Welcome, …` and the „Dashboard” h1.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the progress label cases: `npm run test:unit`
- HTTP tests pass, including the dashboard progress assertion: `npm run test:http`
- Type check passes: `npx astro check`
- Lint passes: `npm run lint`
- Build passes: `npm run build`
- The whole E2E suite stays green with the updated locators: `npx playwright test`

#### Manual Verification:

- Dashboard shows a draft as Szkic with Planowane N uczestników, an active study as Trwa with Odpowiedziało X z N, and a closed or past-deadline study as Zakończone
- Progress on the dashboard matches Odpowiedziało X z N on the study page after a vote
- No English template text or duplicate Sign out remains; the page works at phone width
- Migration pushed to the production database with npx supabase db push before or with the merge

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before closing the plan.

---

## Testing Strategy

### Unit Tests:

- `progressLabel` for draft (participant_target), active and closed (responded/total), including `0 z N`.

### Integration Tests:

- pgTAP `author_study_dashboard.test.sql`: owner scoping, counts, effective status (deadline), ordering, exact column set, no `auth.uid()` → zero rows, `anon` → `42501`.
- HTTP `author-isolation.test.ts`: B's dashboard renders B's progress and none of A's studies.

### Manual Testing Steps:

1. Create a draft with N = 5: the dashboard shows „Szkic · Planowane: 5 uczestników”.
2. Start a study with N = 3 and vote with one link: the dashboard shows „Trwa · Odpowiedziało 1 z 3”.
3. Vote with the remaining links: the dashboard shows „Zakończone · Odpowiedziało 3 z 3”.
4. Create a study with a deadline a few minutes ahead, start it and wait: it shows „Zakończone”.

## Performance Considerations

Two correlated counts per study over `study_links`. With N ≤ 100 links per study and a handful of studies per author, the cost is negligible, and the `study_links.study_id` foreign key is already used by `get_study_results` the same way.

## Migration Notes

Forward-only new function, with no data changes. Rollback = a forward migration that drops it, after reverting the page. Apply to prod with `npx supabase db push`; CI does not run migrations.

## References

- Roadmap: `context/foundation/roadmap.md` S-05; PRD FR-002
- Pattern: `supabase/migrations/20261015130000_study_closing_rules.sql:123-168` (`get_study_results`)
- Rules: `docs/reference/contract-surfaces.md` (anonymity rule, closing rule, results view)
- Isolation matrix precedent: `context/archive/2026-10-06-testing-access-boundaries/research.md:139`
- Current page: `src/pages/dashboard.astro`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: RPC listy badań autora

#### Automated

- [x] 1.1 Migration applies cleanly on a fresh local database
- [x] 1.2 All pgTAP suites pass, including author_study_dashboard.test.sql
- [x] 1.3 Regenerated types compile

#### Manual

- [x] 1.4 contract-surfaces.md documents list_author_studies, its column set and the N = total rule

### Phase 2: Docelowa strona /dashboard

#### Automated

- [ ] 2.1 Unit tests pass, including the progress label cases
- [ ] 2.2 HTTP tests pass, including the dashboard progress assertion
- [ ] 2.3 Type check passes
- [ ] 2.4 Lint passes
- [ ] 2.5 Build passes
- [ ] 2.6 The whole E2E suite stays green with the updated locators

#### Manual

- [ ] 2.7 Dashboard shows a draft as Szkic with Planowane N uczestników, an active study as Trwa with Odpowiedziało X z N, and a closed or past-deadline study as Zakończone
- [ ] 2.8 Progress on the dashboard matches Odpowiedziało X z N on the study page after a vote
- [ ] 2.9 No English template text or duplicate Sign out remains; the page works at phone width
- [ ] 2.10 Migration pushed to the production database with npx supabase db push before or with the merge
