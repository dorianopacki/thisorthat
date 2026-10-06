# Live Results and Comments Implementation Plan

## Overview

Roadmap item **S-03** (`live-results-and-comments`, issue #8) — the milestone's north star. On `/studies/<id>` of an active or closed study, the author sees „Odpowiedziało X z N”, a ranking of variants by vote count (equal counts share a place) and the anonymous comments grouped under each variant. While the study is active the section refreshes itself every ~10 s. Covers US-01 (author side), FR-011, FR-012, FR-013 and the anonymity NFR for the results view.

## Current State Analysis

- The author read path already exists and is tested: `public.get_study_results(p_study_id) returns jsonb` (`supabase/migrations/20261002095727_study_data_model.sql:345-390`) returns `status, responded, total, variants[{variant_id, position, content, vote_count, comments[]}]`, variants by `position`, comments sorted by body. `authenticated` only; `null` for a study the caller does not own.
- Its anonymity is proven in pgTAP: exact key sets and „comments come back sorted by body, not by insertion order” (`supabase/tests/study_anonymity.test.sql:111-137`). No schema or function change is needed for this slice.
- Supabase Realtime `postgres_changes` cannot drive the page: `authenticated` has no privileges on `votes`, `comments` or `study_links.used` (`docs/reference/contract-surfaces.md` → Anonymity rule), so RLS would filter out every event.
- `src/pages/studies/[id].astro` renders one card: status label, title, N, a plain variant list, then `StartStudyButton` (draft) or `LinkList` (started). It never shows results.
- `/api/studies` is in `PROTECTED_ROUTES` (`src/middleware.ts:4,19`); an unauthenticated request is redirected to `/auth/signin` (a 302, not a 401).
- Endpoint pattern: `src/pages/api/studies/[id]/start.ts` (`createClient` → `rpc` → map error codes). Island pattern: default-export React component, `client:load`, Polish copy (`src/components/studies/LinkList.tsx`).
- No Polish plural helper exists in `src/`. No app unit-test runner exists; `context/foundation/lessons.md` does not exist.

## Desired End State

- An author opening an active or closed study sees, above the link list: „Odpowiedziało X z N” (X = `responded`, N = `total`), the ranking with places, vote counts and comments per variant. A draft study looks exactly as today.
- With the study page open, a participant's vote appears on the author's page within ~10 s without reload, with no highlight of what changed.
- `contract-surfaces.md` records the results endpoint, the ranking rule, the „no new-item cues” UI rule and the accepted live-diff limit.
- Verified by the app gate, the unchanged pgTAP suite, and manual checks locally and in production.

### Key Discoveries:

- `total` is the count of links, `participant_target` is N chosen in the wizard. They are equal today, but S-07 adds links mid-study and the roadmap requires X z N to follow the live link count — so the UI uses `total` (`context/foundation/roadmap.md` S-07 Risk).
- `get_study_results` already sorts comments by body, which is the anonymity-safe order; the UI must render them in the order received and never re-sort by anything else.
- `fetch` follows the middleware's 302 to the sign-in page and gets HTML with `200`, so an expired session is detected by `res.redirected` (or a non-JSON content type), not by status code.

## What We're NOT Doing

- Any migration, change to `get_study_results`, or new DB function — the ranking is computed in the app.
- Supabase Realtime (`postgres_changes` or broadcast triggers).
- Mitigations that delay or hide data (k-vote threshold for comments, results only after closing) — declined in favour of FR-013 as written; the residual live-diff limit is documented instead.
- Highlighting, animating or counting „new” votes/comments.
- Tying comments to the commenter's vote choice (PRD FR-012 Socrates note: kept as written).
- Closing a study (S-04), the dashboard list and its progress (S-05), extra links (S-07), image variants (S-08).
- Charts, percentages, export (PRD: out of scope).
- App unit tests / test runner — `rankVariants` is verified manually; automated coverage arrives with the test-plan rollout.
- Splitting results onto a separate route.

## Implementation Approach

The guarantee already lives in the database (`get_study_results`, pgTAP), so this slice is UI-only. A pure ranking function turns the function's output into places. The study page fetches results once on the server and passes them to a `StudyResults` island, so the first paint already shows results. While `status = 'active'` the island polls a thin JSON endpoint that wraps the same RPC, replacing its state wholesale on each response. Placement: results replace the plain variant list for non-draft studies and sit above the link list.

## Critical Implementation Details

**Ranking rule (exact).** Sort by `vote_count` descending, then `position` ascending. Place = 1 + number of variants with a strictly greater `vote_count` (standard competition ranking). Example: A=5, B=5, C=2, D=0 → places 1, 1, 3, 4. With no votes yet, every variant has place 1. Variants with 0 votes are still ranked.

**No change cues.** Each poll replaces the whole results state; render comments in the order received; no diffing, highlight, animation, „nowe” badge or counter of new items. Keys for comments may be the index (bodies can repeat). This is the UI half of the anonymity rule and goes into `contract-surfaces.md`.

**Polling lifecycle.** Poll only while the last known `status` is `active` and `document.visibilityState === 'visible'`; on becoming visible again, fetch immediately and resume the interval. Stop for good when a response has `status !== 'active'`, on 404, or when the session expired (`res.redirected`). A transient failure keeps the last data, shows a small Polish notice and keeps polling. Clear the interval on unmount; never run two requests concurrently.

## Phase 1: Results on the study page

### Overview

Server-rendered progress, ranking and comments for active/closed studies, built from one `get_study_results` call. No live updates yet.

### Changes Required:

#### 1. Ranking and wording helpers

**File**: `src/lib/study-results.ts`

**Intent**: One pure, tested-by-hand place for the ranking rule and the result types, so the page, the island and later S-05 cannot drift.

**Contract**: Exports the `StudyResults` type (mirroring the `get_study_results` JSON shape in `contract-surfaces.md`), `rankVariants(variants): RankedVariant[]` (adds `place: number`; returns a new array; ranking rule as in Critical Implementation Details), and `formatVotes(n: number): string` returning Polish forms („1 głos”, „2 głosy”, „5 głosów”, „12 głosów”, „22 głosy”, „0 głosów”). No Node-only APIs.

#### 2. Results view component

**File**: `src/components/studies/StudyResults.tsx`

**Intent**: Render progress, ranking and comments from a `StudyResults` value; Phase 2 adds polling to the same component.

**Contract**: Default-export React component with props `studyId: string`, `initial: StudyResults`. Renders:
- „Odpowiedziało X z N” plus a simple progress bar (`responded / total`); „Nikt jeszcze nie zagłosował” when `responded = 0`.
- An ordered list from `rankVariants`: place („1.”), content (`whitespace-pre-wrap break-words`), `formatVotes(vote_count)`; tied variants show the same place number.
- Under each variant: „Komentarze (k)” followed by the comments in received order, or „Brak komentarzy”.
- Existing card styling (white/10 glass, blue-100 text), readable at 360 px.

#### 3. Study page

**File**: `src/pages/studies/[id].astro`

**Intent**: Show results for started studies without changing the draft view.

**Contract**: For `status !== 'draft'`, call `supabase.rpc("get_study_results", { p_study_id: study.id })` and render `<StudyResults studyId initial client:load />` in place of the plain „Warianty” list, above „Linki do głosowania”. An RPC error throws a Polish error like the other loads; a `null` result (should not happen after the RLS-filtered study read) is treated as 404. The draft branch and the variants query for drafts stay as they are; the started branch no longer needs the separate variants query.

### Success Criteria:

#### Automated Verification:

- App gate passes: `npm run lint`, `npx astro check`, `npm run build`
- Database tests still pass: `npx supabase test db`

#### Manual Verification:

- A draft study's page looks unchanged (variant list + start button, no results)
- An active study with no votes shows „Odpowiedziało 0 z N”, „Nikt jeszcze nie zagłosował”, every variant at place 1 with „0 głosów” and „Brak komentarzy”
- After votes A=2, B=2, C=1, D=0 (4 variants, via `/v/<token>` links) the page shows places 1, 1, 3, 4, tied variants in wizard order, „2 głosy”/„1 głos”/„0 głosów”, and comments under the right variants sorted alphabetically
- At 360 px width the results section has no horizontal scroll and long content wraps

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Live updates

### Overview

A JSON endpoint over `get_study_results` and polling in `StudyResults` while the study is active; contract registry updated.

### Changes Required:

#### 1. Results endpoint

**File**: `src/pages/api/studies/[id]/results.ts`

**Intent**: Give the island a fresh copy of the author's results through the same tested RPC, protected by the existing middleware.

**Contract**: `GET` only. Calls `get_study_results` with the route id and returns its JSON unchanged (`200`, `Content-Type: application/json`, `Cache-Control: no-store`). `null` result or `22P02` (non-uuid id) → `404` with an empty/JSON error body; other RPC error or `null` client → `500`. Adds no fields (no server time, no ETag derived from content). Stays under `/api/studies`, so `PROTECTED_ROUTES` covers it unchanged.

#### 2. Polling in the results island

**File**: `src/components/studies/StudyResults.tsx`

**Intent**: FR-013 „wyniki na żywo” — the open page follows votes without reload.

**Contract**: Interval constant `RESULTS_POLL_MS = 10_000` in the component. Lifecycle exactly as in Critical Implementation Details (Polling lifecycle). On `res.redirected` show „Sesja wygasła — odśwież stronę, aby zobaczyć aktualne wyniki.” and stop; on a transient failure show „Nie udało się odświeżyć wyników. Spróbujemy ponownie.” and keep the last data. When polling stops because `status` is no longer `active`, show „Badanie jest zakończone — wyniki są ostateczne.” Each successful response replaces the whole state (no change cues).

#### 3. Contract registry

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Record what S-04/S-05/S-07 must keep about results.

**Contract**: Add a „Results view” section: `GET /api/studies/<id>/results` (returns `get_study_results` JSON unchanged, `no-store`, 404 for not-owned), the ranking rule with the 5,5,2,0 → 1,1,3,4 example, X z N = `responded` of `total` (not `participant_target`), polling every 10 s while `active`. Extend the Anonymity rule with: „The results UI never marks what changed between refreshes (no highlight, animation or new-item count) and renders comments in the order `get_study_results` returns them. Accepted limit: with few votes, comparing two snapshots shows which variant gained a vote and which comments arrived together, and when; this is inherent to live results (FR-013) and to a plain reload, and is accepted for the MVP.”

### Success Criteria:

#### Automated Verification:

- App gate passes: `npm run lint`, `npx astro check`, `npm run build`
- Database tests still pass: `npx supabase test db`

#### Manual Verification:

- With the author's study page open, voting from another browser updates X z N, the ranking and comments within ~10 s with no reload and no highlight of the change
- In DevTools Network, requests to `/api/studies/<id>/results` stop while the tab is hidden and one fires immediately on return; responses carry `Cache-Control: no-store` and only the keys `status, responded, total, variants`
- Setting the study to `closed` in Studio makes the page show the final-results notice and polling stops; a closed study loaded fresh makes no polling requests
- Signed out, `GET /api/studies/<id>/results` redirects to sign-in; as another author it returns 404; after signing out in another tab the open page shows the session-expired notice and stops polling
- `contract-surfaces.md` contains the Results view section and the extended anonymity rule

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Production rollout

### Overview

Ship by merging to `main`; no database push is needed.

### Changes Required:

#### 1. App deploy

**Intent**: Deliver the north-star slice to production.

**Contract**: Open a PR to `main`; CI (`ci.yml`, `deploy.yml` verify job) must be green; merging deploys to Cloudflare Workers. Confirm `npx supabase migration list` shows no pending local migration (this slice adds none).

### Success Criteria:

#### Automated Verification:

- CI is green on the PR, including `supabase test db`

#### Manual Verification:

- `npx supabase migration list` shows local and remote in sync with no new migration
- In production, with the author's study page open on a laptop, a vote and comment sent from a phone via a link appear on the author's page within ~10 s

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- None (no app unit runner in the repo; decision Ranking). `rankVariants` and `formatVotes` are checked manually through the Phase 1 scenarios (tie, zero votes, plural forms); they are the first candidates for unit tests in the test-plan rollout.

### Integration Tests:

- Existing pgTAP keeps proving the read path: exact keys and body-sorted comments (`study_anonymity.test.sql`), vote counts and `responded` (`cast_vote.test.sql`). No new suite: no DB change.

### Manual Testing Steps:

1. Create and start a study with 4 variants and N = 5; open its page — 0 z 5, all at place 1.
2. From private windows vote via links: A with a comment „zeta”, A with „alfa”, B, B, C — page shows 1, 1, 3, 4; A's comments read „alfa”, „zeta”.
3. Keep the author page open; vote with the 5th link — the page updates within ~10 s, nothing is highlighted.
4. Switch tabs for 30 s — no requests; return — immediate request.
5. Set the study `closed` in Studio — final-results notice; reload — no polling.
6. Request the endpoint signed out (redirect) and as another author (404); check the response headers and keys.
7. Repeat steps 1–3 at 360 px width.

## Performance Considerations

One `get_study_results` call per 10 s per open, visible, active study page: a handful of indexed counts over ≤ 6 variants and ≤ 100 links/votes. Hidden tabs and closed studies make no requests. No new dependencies.

## Migration Notes

None — no database change. Rolling back is reverting the app commit.

## References

- Roadmap: `context/foundation/roadmap.md` (S-03, S-07 Risk)
- PRD: `context/foundation/prd.md` (US-01, FR-011–FR-013, NFR anonimowość)
- F-01 plan: `context/archive/2026-10-02-study-data-model/plan.md`
- S-02 plan: `context/archive/2026-10-05-one-time-link-voting/plan.md`
- `get_study_results`: `supabase/migrations/20261002095727_study_data_model.sql:340-390`
- Anonymity tests: `supabase/tests/study_anonymity.test.sql:105-137`
- Contracts: `docs/reference/contract-surfaces.md`
- Patterns: `src/pages/studies/[id].astro`, `src/pages/api/studies/[id]/start.ts`, `src/components/studies/LinkList.tsx`, `src/middleware.ts:4,19`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Results on the study page

#### Automated

- [x] 1.1 App gate passes: `npm run lint`, `npx astro check`, `npm run build`
- [x] 1.2 Database tests still pass: `npx supabase test db`

#### Manual

- [x] 1.3 A draft study's page looks unchanged (variant list + start button, no results)
- [x] 1.4 An active study with no votes shows „Odpowiedziało 0 z N”, „Nikt jeszcze nie zagłosował”, every variant at place 1 with „0 głosów” and „Brak komentarzy”
- [x] 1.5 After votes A=2, B=2, C=1, D=0 (4 variants, via `/v/<token>` links) the page shows places 1, 1, 3, 4, tied variants in wizard order, „2 głosy”/„1 głos”/„0 głosów”, and comments under the right variants sorted alphabetically
- [x] 1.6 At 360 px width the results section has no horizontal scroll and long content wraps

### Phase 2: Live updates

#### Automated

- [ ] 2.1 App gate passes: `npm run lint`, `npx astro check`, `npm run build`
- [ ] 2.2 Database tests still pass: `npx supabase test db`

#### Manual

- [ ] 2.3 With the author's study page open, voting from another browser updates X z N, the ranking and comments within ~10 s with no reload and no highlight of the change
- [ ] 2.4 In DevTools Network, requests to `/api/studies/<id>/results` stop while the tab is hidden and one fires immediately on return; responses carry `Cache-Control: no-store` and only the keys `status, responded, total, variants`
- [ ] 2.5 Setting the study to `closed` in Studio makes the page show the final-results notice and polling stops; a closed study loaded fresh makes no polling requests
- [ ] 2.6 Signed out, `GET /api/studies/<id>/results` redirects to sign-in; as another author it returns 404; after signing out in another tab the open page shows the session-expired notice and stops polling
- [ ] 2.7 `contract-surfaces.md` contains the Results view section and the extended anonymity rule

### Phase 3: Production rollout

#### Automated

- [ ] 3.1 CI is green on the PR, including `supabase test db`

#### Manual

- [ ] 3.2 `npx supabase migration list` shows local and remote in sync with no new migration
- [ ] 3.3 In production, with the author's study page open on a laptop, a vote and comment sent from a phone via a link appear on the author's page within ~10 s
