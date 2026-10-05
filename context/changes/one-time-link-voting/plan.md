# One-Time Link Voting Implementation Plan

## Overview

Roadmap item **S-02** (`one-time-link-voting`, issue #7). A participant without an account opens `/v/<token>`, sees the study title and its variants (in an order shuffled per link), selects one, optionally adds a comment under any variant, and sends. They then see „Dziękujemy za udział w badaniu”. Reopening the link in the same browser shows „Twój głos został już oddany”; a link to a closed, deleted or unknown study shows „Badanie jest zakończone”. Covers US-01 (participant side), FR-007, FR-008, FR-009, FR-010 (thank-you and used-link messages; closed/deleted messages are already produced by the shared „ended” state and get their triggers in S-04 and S-06), and the mobile NFR.

## Current State Analysis

- The write path exists: `cast_vote(p_token, p_variant_id, p_comments)` consumes a link atomically, validates every input before consuming, and returns `accepted | link_used | study_ended` — `supabase/migrations/20261002124043_cast_vote_comment_uuid_errcode.sql:7-135`. It is in production, granted to `anon` and `authenticated`, and covered by `supabase/tests/cast_vote.test.sql`.
- There is no participant read path: `anon` has no table privileges (`docs/reference/contract-surfaces.md:25`), so the page cannot load a ballot. F-01 deferred `get_ballot(token)` to S-02 (`context/archive/2026-10-02-study-data-model/plan.md:38`).
- `/v/<token>` is the agreed URL (`contract-surfaces.md:33-35`), built by `voteUrl()` in `src/lib/study-links.ts`; no route serves it yet.
- `PROTECTED_ROUTES` covers `/dashboard`, `/studies`, `/api/studies` with exact-or-subpath matching (`src/middleware.ts:4,19`), so `/v` and `/api/v` are already public.
- Form/island patterns: native form POST to `src/pages/api/*`, redirect with `?error=` (`src/pages/api/studies/[id]/start.ts`); islands keep their own `submitting` state and reset it on bfcache `pageshow` (`src/components/studies/StudyWizard.tsx:41-52,118-124`); copy is Polish; `charLength` and limits live in `src/lib/study-limits.ts`.
- S-01 review lesson F1: native form POSTs send CRLF, so the server must normalize `\r\n?` → `\n` before trimming and length checks (`context/archive/2026-10-05-create-and-start-study/reviews/impl-review.md` F1).
- No `context/foundation/lessons.md` exists.

## Desired End State

- `public.get_ballot(p_token text) returns jsonb` exists in a forward migration: title + variants for a token of an `active` study, `null` otherwise, with **identical output for used and unused links**. Proven by pgTAP and recorded in `contract-surfaces.md`.
- Opening `/v/<token>` on a phone shows a usable ballot: tappable variant cards, a collapsed „Dodaj komentarz” per variant, and „Wyślij głos” enabled only after a selection.
- Sending records exactly one vote plus non-blank comments and shows the thank-you screen; the same browser later sees „Twój głos został już oddany”; another browser sees the ballot and gets the same message after sending; a closed/deleted/unknown link shows „Badanie jest zakończone”.
- Verified by `npx supabase test db`, the app gate, and manual checks at phone width and on a real phone in production.

### Key Discoveries:

- `cast_vote` already returns `study_ended` for unknown token, draft, closed and deleted studies, and `link_used` only for a used link in an `active` study — `20261002124043_cast_vote_comment_uuid_errcode.sql:111-123`. The endpoint maps these codes 1:1; no change to `cast_vote` is needed.
- The accepted author probe is acceptable only because it is destructive and therefore "not a silent oracle" — `contract-surfaces.md:63`. A ballot read that returned "used" would make it silent, and together with S-03 live results it would let an author tie a vote to a person. Hence `get_ballot` must not read `study_links.used`.
- Every definer function sets `search_path = ''` and schema-qualifies names; `EXECUTE` is revoked from `public` then granted per role — F-01 plan §Critical Implementation Details.
- Role switching in pgTAP: `set local role anon` + `request.jwt.claims` — `supabase/tests/cast_vote.test.sql:36-50`.
- `Layout.astro` has no `<head>` slot; response headers are set through `Astro.response.headers` / the endpoint `Response`.

## What We're NOT Doing

- Results, ranking, live updates, progress „X z N” (S-03).
- Closing rules — auto-close after N, manual close, deadline (S-04). S-02 only renders the shared „ended” state that S-04 and S-06 will trigger.
- Editing/deleting studies (S-06), extra links (S-07), image variants (S-08).
- Showing „Twój głos został już oddany” on open on a device that has not voted from this browser — deliberately traded away for anonymity (decision Reopen).
- Rate limiting or bot protection on `/v` (128-bit tokens; MVP scale).
- Changing `cast_vote`, the schema, or any author page.
- Translating the layout (`lang="en"`) or existing English auth pages — same scope line as S-01.
- App unit/e2e tests (none in the repo; DB guarantees covered by pgTAP).
- Updating the roadmap's S-02 „Unknowns” text — the mobile-comments decision is recorded in `change.md` and here.

## Implementation Approach

Mirror F-01 and S-01: the guarantee goes into the database first and is proven with pgTAP, then the UI is built on top. `get_ballot` is a `security definer` read narrowed to one token, and it never touches `used`. That way the only way to learn a link's state stays `cast_vote`, which consumes an unused link. The page is an Astro route that asks `get_ballot` once and decides which screen to render; the ballot itself is a React island posting a native form to `/api/v/<token>`. That endpoint normalizes and validates input, calls `cast_vote` and redirects with an outcome. Once a vote is accepted, or the link turns out to be used, a cookie scoped to `/v/<token>` lets this browser show „Twój głos został już oddany” on later visits without asking the database about `used`. The variant order is a pure function of the token, so a reload shows the same order and nothing is stored.

## Critical Implementation Details

**Screen precedence on `/v/<token>`.** Evaluate in this order: `?status=accepted` → thank-you (no DB call); `get_ballot` returns `null` → „Badanie jest zakończone”; voted cookie present or `?status=used` → „Twój głos został już oddany”; otherwise the ballot (with `?error=` if present). Thank-you comes first because S-04 will auto-close the study on the last link: the last voter's redirect must still show the thank-you, not „ended”.

**The cookie is a hint, never the guard.** One vote per link is enforced only by `cast_vote`'s conditional `UPDATE`. A missing or cleared cookie only means the ballot shows again; sending it returns `link_used`. Never skip `cast_vote` because a cookie is absent, and never accept a vote because one is present.

**Token in URLs and headers.** The token is the participant's credential: build the path through one helper that `encodeURIComponent`s it. Send `Referrer-Policy: no-referrer` and `Cache-Control: no-store` (plus `X-Robots-Tag: noindex`) on the page and the endpoint's redirects, so the token does not leak via `Referer` and a shared/back-cached page does not show a stale screen.

## Phase 1: Database — `get_ballot`

### Overview

Forward migration adding the participant read path, a pgTAP suite proving it never reveals link usage, regenerated types and an updated contract registry.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_one_time_link_voting.sql` (via `npx supabase migration new one_time_link_voting`)

**Intent**: Let a token holder load the ballot of an active study without exposing whether that link was used, and without opening any table to `anon`.

**Contract**:

```sql
public.get_ballot(p_token text) returns jsonb
  language sql stable security definer set search_path = ''
-- revoke execute from public; grant execute to anon, authenticated
```

- Returns `null` unless a `study_links` row with `token = p_token` exists and its study has `status = 'active'` (unknown token, deleted, `draft` or `closed` study → `null`).
- Shape: `{ "title": text, "variants": [ { "variant_id": uuid, "content": text } ] }`, `variants` ordered by `position`.
- **Must not read `study_links.used`** and must not return link id, token, `position`, study id, status or counts.

#### 2. pgTAP suite

**File**: `supabase/tests/get_ballot.test.sql`

**Intent**: Prove the read path's contract as the real roles, following the fixture/role-switch pattern of `cast_vote.test.sql`.

**Contract**: Fixtures: author A with an `active` study (2 variants inserted out of position order, 2 links), a `closed` study and a `draft` study, each with a link. Cases:
- As `anon`, an unused active token returns the title and both variants in `position` order.
- Top-level keys are exactly `title, variants`; per-variant keys exactly `variant_id, content`.
- After `cast_vote` consumes token 1, `get_ballot(token 1)` **equals** `get_ballot(token 2)` (unused) and equals its own pre-vote output — the no-oracle guarantee.
- Unknown token, closed-study token and draft-study token → `null`.
- After deleting the active study (as superuser), its token → `null`.
- `authenticated` (author A, and author B) can execute it with the same result as `anon`; executing it grants no table access (`anon` still gets permission denied on `study_links`).

#### 3. Types

**File**: `src/lib/database.types.ts`

**Intent**: Expose `get_ballot` to the typed client.

**Contract**: Regenerate with `npx supabase gen types typescript --local > src/lib/database.types.ts` from Git Bash, then `npx prettier --write` it.

#### 4. Contract registry

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Record the new load-bearing function and the rules S-03/S-04/S-06 must keep.

**Contract**: Add the migration to "Source of truth"; add a `get_ballot` section (signature, callers, `null` cases, exact JSON shape); extend the Anonymity rule: "no participant-reachable read reveals `study_links.used`; the only way to learn a link's state is `cast_vote`, which consumes an unused link". Under "Vote URL" document the page's screen precedence, the `/v/<token>`-scoped voted cookie as a same-browser hint, the per-token shuffled order, and the note that S-04 must keep thank-you ahead of „ended”.

### Success Criteria:

#### Automated Verification:

- Migrations apply on a fresh local database: `npx supabase db reset`
- All database tests pass, including the new suite: `npx supabase test db`
- Database lint reports no errors: `npx supabase db lint`
- App gate passes with regenerated types: `npm run lint`, `npx astro check`, `npm run build`

#### Manual Verification:

- `contract-surfaces.md` lists `get_ballot`, the extended anonymity rule and the `/v/<token>` screen precedence and cookie note

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Voting page and endpoint

### Overview

The public `/v/<token>` page with all four screens, the mobile-first ballot island, and the POST endpoint that calls `cast_vote`.

### Changes Required:

#### 1. Limits and link helpers

**Files**: `src/lib/study-limits.ts`, `src/lib/study-links.ts`

**Intent**: Keep the comment limit and the vote path/cookie in one place, so the page, the island and the endpoint cannot drift from each other or from `cast_vote`.

**Contract**: `study-limits.ts` gains `MAX_COMMENT_LENGTH = 2000` (comment pointing at `cast_vote`). `study-links.ts` gains `votePath(token): string` → `/v/${encodeURIComponent(token)}` (and `voteUrl` builds on it) plus an exported cookie name constant `VOTED_COOKIE`.

#### 2. Per-token order

**File**: `src/lib/ballot-order.ts`

**Intent**: Shuffle variants per link to remove first-position bias, stable across reloads.

**Contract**: `orderForToken<T>(items: readonly T[], token: string): T[]` — pure, deterministic Fisher–Yates seeded from a 32-bit hash of the token (e.g. FNV-1a feeding a small PRNG); no Node-only APIs (workerd); returns a new array, never mutates the input.

#### 3. Voting page

**File**: `src/pages/v/[token].astro`

**Intent**: Decide which screen the participant sees and render it in the existing card style, readable at 360 px width.

**Contract**: Calls `supabase.rpc("get_ballot", { p_token })` once (handle the `null` client branch with the „ended”-style card plus a generic error, not a throw). Screens and precedence as in Critical Implementation Details: thank-you „Dziękujemy za udział w badaniu”; „Badanie jest zakończone”; „Twój głos został już oddany”; ballot (study title + `BallotForm` with variants passed through `orderForToken`). Sets `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`. No author/dashboard links on any screen. Unexpected RPC errors render a generic Polish error card rather than throwing.

#### 4. Ballot island

**File**: `src/components/voting/BallotForm.tsx`

**Intent**: FR-007–FR-009 on a phone: select one variant, optionally comment under any variant, send in one tap.

**Contract**: Default-export island (`client:load`); props `token`, `variants: { variant_id: string; content: string }[]`, `serverError?: string | null`. Native `<form method="POST" action="/api/v/<encoded token>">`. Each variant is a full-width card with a native radio `name="variant_id"` (whole card tappable, selected card clearly highlighted, keyboard-accessible). Under each card a „Dodaj komentarz” toggle expands a textarea `name="comment:<variant_id>"`; collapsing hides it without discarding text (toggle then reads „Edytuj komentarz”). Client validation: comment ≤ `MAX_COMMENT_LENGTH` via `charLength`, Polish message. „Wyślij głos” is disabled until a variant is selected and while `submitting` (own state set in `onSubmit`, reset on bfcache `pageshow`, as in `StudyWizard`). Shows `serverError` via `ServerError`. Variant content rendered with `whitespace-pre-wrap break-words`.

#### 5. Vote endpoint

**File**: `src/pages/api/v/[token].ts`

**Intent**: Turn the form into one `cast_vote` call and send the participant to the right screen.

**Contract**: `POST`. Reads `variant_id` and every `comment:<uuid>` field; normalizes `\r\n?` → `\n`, trims, drops blank comments, rejects a comment over `MAX_COMMENT_LENGTH`; missing `variant_id` → redirect `votePath(token)?error=Wybierz wariant.`. Builds `p_comments` as `[{ variant_id, body }]` and calls `cast_vote`. Outcomes:
- `accepted` → set the `VOTED_COOKIE` (`path: votePath(token)`, `httpOnly`, `sameSite: "lax"`, `secure: !import.meta.env.DEV`, max-age 1 year) and redirect `?status=accepted`.
- `link_used` → set the same cookie, redirect `?status=used`.
- `study_ended` → redirect to `votePath(token)` (the page renders „ended”).
- RPC error (`22023`, `22P02`, other) or `null` client → redirect `?error=Nie udało się wysłać głosu. Odśwież stronę i spróbuj ponownie.`
All redirects carry `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. `/v` and `/api/v` stay out of `PROTECTED_ROUTES`.

### Success Criteria:

#### Automated Verification:

- App gate passes: `npm run lint`, `npx astro check`, `npm run build`
- Database tests still pass: `npx supabase test db`

#### Manual Verification:

- Signed out, at 360 px width, a fresh link shows the title and variants with no horizontal scroll; „Wyślij głos” is disabled until a variant is tapped
- Two different links of the same study show the variants in different orders (for a 3+ variant study), and each link keeps its order on reload
- Sending with a choice and one comment shows „Dziękujemy za udział w badaniu”; `get_study_results` (as the author, via SQL in Studio) shows `responded` = 1, the vote and the comment
- Reopening the same link in the same browser shows „Twój głos został już oddany”; opening it in a private window shows the ballot, and sending shows the same message with no second vote recorded
- A double tap on „Wyślij głos” records one vote; collapsing a comment keeps its text; a 2001-character comment is blocked with a Polish message
- An unknown token and a token of a study set to `closed` in Studio show „Badanie jest zakończone”; the response headers include `no-store` and `no-referrer`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Production rollout

### Overview

Apply the migration to the production Supabase project, then ship the app by merging to `main`.

### Changes Required:

#### 1. Database push

**Intent**: Make `get_ballot` available before the page that calls it is deployed.

**Contract**: 👤 user, after explicit approval: `npx supabase db push` (project already linked) and `npx supabase migration list` showing local = remote. Do not apply via MCP `apply_migration` (it records a different version). Then check security advisors (MCP `get_advisors`, type `security`, read-only).

#### 2. App deploy

**Intent**: Ship the voting page.

**Contract**: Open a PR to `main`; CI (`ci.yml`, `deploy.yml` verify job) must be green; merging deploys to Cloudflare Workers.

### Success Criteria:

#### Automated Verification:

- CI is green on the PR, including `supabase test db`

#### Manual Verification:

- Migration pushed after approval; `npx supabase migration list` shows local and remote in sync
- Security advisors show no new ERROR (expected WARN for definer `get_ballot`)
- In production, on a real phone, a participant opens a link from a started study, comments, votes, sees the thank-you, and reopening shows „Twój głos został już oddany”

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- None for app code (no unit suite in the repo). `orderForToken` is pure and is checked manually (stable per token, varies across tokens).

### Integration Tests:

- pgTAP `get_ballot.test.sql`: shape, `null` cases, role access, and identical output for used vs unused links (Phase 1).
- Existing `cast_vote.test.sql` keeps covering one-vote-per-link, return codes and validation-before-consume.

### Manual Testing Steps:

1. As an author, create and start a study with 3 variants and N = 3; copy the links.
2. Sign out; open link 1 at 360 px in device emulation — ballot, Send disabled.
3. Open link 2 — different order; reload each — orders stable.
4. On link 1, select, expand „Dodaj komentarz” on another variant, type with a line break, collapse/expand, send — thank-you.
5. Reload link 1 — „Twój głos został już oddany”; open link 1 in a private window — ballot; send — same message; `get_study_results` shows 1 response.
6. On link 2, double-tap Send — one vote; `responded` = 2.
7. Open `/v/unknown` — „Badanie jest zakończone”; set the study `closed` in Studio, open link 3 — „ended”.
8. Inspect response headers on `/v/<token>` — `no-store`, `no-referrer`, `noindex`.

## Performance Considerations

One RPC per page view (a single indexed lookup by unique `token`, ≤ 6 variants) and one per vote (`cast_vote`, unchanged). The island is small; no new dependencies. Well within the Workers CPU budget.

## Migration Notes

Forward-only, additive (one new function); existing migrations untouched. Rollback of app code does not affect it; a correction is a new forward migration.

## References

- Roadmap: `context/foundation/roadmap.md` (S-02)
- PRD: `context/foundation/prd.md` (US-01, FR-007–FR-010, NFR mobile and anonimowość)
- F-01 plan: `context/archive/2026-10-02-study-data-model/plan.md`
- S-01 plan and review: `context/archive/2026-10-05-create-and-start-study/plan.md`, `reviews/impl-review.md` (F1 CRLF)
- `cast_vote`: `supabase/migrations/20261002124043_cast_vote_comment_uuid_errcode.sql`
- Contracts: `docs/reference/contract-surfaces.md`
- Patterns: `src/pages/api/studies/[id]/start.ts`, `src/components/studies/StudyWizard.tsx`, `src/pages/studies/[id].astro`, `src/middleware.ts:4,19`, `supabase/tests/cast_vote.test.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database — `get_ballot`

#### Automated

- [x] 1.1 Migrations apply on a fresh local database: `npx supabase db reset` — 178900a
- [x] 1.2 All database tests pass, including the new suite: `npx supabase test db` — 178900a
- [x] 1.3 Database lint reports no errors: `npx supabase db lint` — 178900a
- [x] 1.4 App gate passes with regenerated types: `npm run lint`, `npx astro check`, `npm run build` — 178900a

#### Manual

- [x] 1.5 `contract-surfaces.md` lists `get_ballot`, the extended anonymity rule and the `/v/<token>` screen precedence and cookie note — 178900a

### Phase 2: Voting page and endpoint

#### Automated

- [x] 2.1 App gate passes: `npm run lint`, `npx astro check`, `npm run build` — d2205dd
- [x] 2.2 Database tests still pass: `npx supabase test db` — d2205dd

#### Manual

- [x] 2.3 Signed out, at 360 px width, a fresh link shows the title and variants with no horizontal scroll; „Wyślij głos” is disabled until a variant is tapped — d2205dd
- [x] 2.4 Two different links of the same study show the variants in different orders (for a 3+ variant study), and each link keeps its order on reload — d2205dd
- [x] 2.5 Sending with a choice and one comment shows „Dziękujemy za udział w badaniu”; `get_study_results` (as the author, via SQL in Studio) shows `responded` = 1, the vote and the comment — d2205dd
- [x] 2.6 Reopening the same link in the same browser shows „Twój głos został już oddany”; opening it in a private window shows the ballot, and sending shows the same message with no second vote recorded — d2205dd
- [x] 2.7 A double tap on „Wyślij głos” records one vote; collapsing a comment keeps its text; a 2001-character comment is blocked with a Polish message — d2205dd
- [x] 2.8 An unknown token and a token of a study set to `closed` in Studio show „Badanie jest zakończone”; the response headers include `no-store` and `no-referrer` — d2205dd

### Phase 3: Production rollout

#### Automated

- [x] 3.1 CI is green on the PR, including `supabase test db` — ee0d121

#### Manual

- [x] 3.2 Migration pushed after approval; `npx supabase migration list` shows local and remote in sync — ee0d121
- [x] 3.3 Security advisors show no new ERROR (expected WARN for definer `get_ballot`) — ee0d121
- [x] 3.4 In production, on a real phone, a participant opens a link from a started study, comments, votes, sees the thank-you, and reopening shows „Twój głos został już oddany” — ee0d121
