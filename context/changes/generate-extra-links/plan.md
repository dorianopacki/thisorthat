# Generate Extra Links (S-07) Implementation Plan

## Overview

The author can generate extra one-time links in an active study (FR-019, roadmap S-07). Each addition raises N (`participant_target`) to the new link count, within the 1–100 cap. A study that is closed — manually, by its last link, or past its deadline — cannot be extended. New links get a stable per-study number, so the author can find and copy exactly the links they just added.

## Current State Analysis

- Links are created only by `start_study`, which inserts exactly `participant_target` rows (`supabase/migrations/20261015130000_study_closing_rules.sql:247-305`). No other writer exists, and authors have no insert grant on `study_links`.
- `participant_target` is updatable by authors only while `draft` (`docs/reference/contract-surfaces.md:45`). The contract already defines it as "the total number of links a study ever gets", capped at 100 by `studies_participant_target_check`, and says S-07 must stay within it (`contract-surfaces.md:55`).
- The live-count groundwork for S-07 is already in place:
  - auto-close counts unused links live (`20261015150000_study_closing_vote_path.sql:9`, `contract-surfaces.md:29`);
  - „Odpowiedziało X z N” uses N = `total`, the live link count (`contract-surfaces.md:178,186`, `src/lib/study-progress.ts`).
- Every writer locks the study row first, in the order study → link. `close_study` is the closest model: it locks with `for no key update`, refuses with `55000` unless `study_status_effective(...) = 'active'`, and owner-not-found is `P0002` (`20261015150000_study_closing_vote_path.sql:179-213`).
- `study_links.id` is a random uuid (`20261002095727_study_data_model.sql:41`), and the study page orders links by it (`src/pages/studies/[id].astro:70-74`). Links therefore have no creation order: added links would be scattered through the list.
- The study page shows „Liczba uczestników: {participant_target}” for started studies too (`[id].astro:117-119`). Raising N on every addition keeps that number true.
- pgTAP fixtures insert `study_links (study_id, token)` directly without any ordering column (`supabase/tests/study_anonymity.test.sql:57`, `study_isolation.test.sql:24`).

## Desired End State

On an effectively active study, the author's study page shows a „Dogeneruj linki” form below the link list: a number field from 1 to `100 − total`, defaulting to 1. Submitting it:

- appends that many links;
- raises N;
- redirects back to the page, which shows a „Nowe linki (k)” block with only the new links and a „Kopiuj nowe” button.

The full list is numbered by `position`, so the new links are always last. „Odpowiedziało X z N” and „Liczba uczestników” both reflect the new total. When the last link is used, the study closes only after the added links are used too. On a closed study, or one past its deadline, the form is absent, and a forced POST is refused with a message.

Verify with `npx supabase test db` (new pgTAP file) and `npm run test:http` (new HTTP file).

### Key Discoveries:

- `close_study` (`20261015150000_study_closing_vote_path.sql:179`) is the template for the new writer's lock, effective-status check and error codes.
- `cast_vote` already counts unused links live, and `get_study_results` / `list_author_studies` count `total` live. Neither needs changing.
- The close endpoint (`src/pages/api/studies/[id]/close.ts`) is the endpoint pattern: redirect to the study page, map `P0002`/`22P02` to a plain redirect, and send other failures back as `?error=`.
- `CloseStudyButton.tsx` is the island pattern: `SubmitButton`, a `submitting` guard, and a `pageshow` reset for the bfcache.
- `LinkList.tsx:68,76` numbers rows by `index + 1`. A subset list (the new block) needs a starting number.

## What We're NOT Doing

- Removing or revoking links. Added links are permanent.
- Recording the original planned N. `participant_target` is overwritten with the new total.
- Adding links to a `draft` (edit N instead) or to any study that is not effectively active.
- A confirmation step before adding.
- Changing the deadline when links are added.
- Showing the new-links block after a reload. Only the redirect's `?added=k` drives it; the full list keeps the new links last.
- Exposing `position` to participants. `get_ballot` stays as is.
- E2E (Playwright) coverage for this flow.
- An add-links action on the dashboard.

## Implementation Approach

One new `security definer` writer, `add_study_links`, follows `close_study`'s lock-then-check shape. It sets N from the live link count, so the existing check constraint enforces the cap. It also needs no new invariant about `participant_target` having matched the link count before.

A new per-study `position` on `study_links` gives links a stable order. All writers assign it, and the author can read it. It reveals only creation order, never usage, so the anonymity rule holds.

The UI adds one form island and a subset render of `LinkList`.

## Critical Implementation Details

- **Timing & lifecycle**: `add_study_links` must take the study row lock (`for no key update`) before reading the effective status or the link count. That serializes it with `cast_vote`'s last-link auto-close. The outcome is then either add-then-vote, where the vote does not close the study because unused links remain, or close-then-add, which is refused with `55000`. It is never links added to a closed study.
- **State sequencing**: positions are `max(position) + 1 … + k`, computed under that lock. Fixtures that insert links without a position must still get valid, unique positions. Use a column default/trigger or explicit assignment, as long as both paths work.

## Phase 1: Database — link order and `add_study_links`

### Overview

Give links a stable per-study order, add the writer that appends links and raises N, and prove the lifecycle, cap, isolation and race rules in pgTAP.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_generate_extra_links.sql` (new; forward-only, header comment in the style of earlier migrations)

**Intent**: Add `study_links.position`, backfill it, make `start_study` assign it, add `add_study_links`, and let authors read `position`.

**Contract**:

- `study_links.position integer not null`, `unique (study_id, position)`.
  - Positions are 1…total per study.
  - Existing rows are backfilled with `row_number() over (partition by study_id order by id)`.
  - Inserts that omit it (test fixtures) get the next free number for that study.
- `start_study` assigns positions 1…N. It is recreated with `create or replace`, and its body is otherwise unchanged.
- `grant select (position) on public.study_links to authenticated`. `used` stays ungranted.
- `public.add_study_links(p_study_id uuid, p_count integer) returns void`:
  - `security definer`, `set search_path = ''`;
  - `revoke … from public, anon`, `grant … to authenticated`.
  - Locks `studies` `for no key update` where `id = p_study_id and author_id = auth.uid()`.
  - Error codes:
    - `P0002`: not found or not the owner;
    - `55000`: `study_status_effective(status, closes_at) <> 'active'`, which covers draft, closed and past deadline;
    - `22023`: `p_count` is null or `< 1`.
  - Inserts `p_count` links at positions `max + 1 …`.
  - Sets `participant_target = (live link count before insert) + p_count`. Exceeding 100 raises `23514` from `studies_participant_target_check`, and the whole call rolls back.

#### 2. Generated types

**File**: `src/lib/database.types.ts`

**Intent**: Regenerate so `position` and the new function are typed.

**Contract**: `npx supabase gen types typescript --local > src/lib/database.types.ts`.

#### 3. pgTAP tests

**File**: `supabase/tests/generate_extra_links.test.sql` (new), `supabase/tests/study_anonymity.test.sql`

**Intent**: Prove FR-019 and test-plan risks #3, #6 and #7 at the database layer. Update the anonymity test's column assertion.

**Contract**: `generate_extra_links.test.sql` covers:

- **Matrix**: active → accepted; draft, closed, and active past `closes_at` → `55000`; someone else's study and an unknown id → `P0002`; anon → permission denied.
- **Count**: `0`, negative and null → `22023`. N=95 + 5 succeeds (N=100); N=95 + 6 → `23514` with no links added and N unchanged.
- **Effect**: after adding 3 to N=2, there are 5 links at positions 1–5, `participant_target = 5`, and `get_study_results` reports `total = 5`.
- **Auto-close**: use the 2 original links, then the status is still `active`. Use the 3 new ones, then it is `closed`.
- **Positions**: a fresh `start_study` gives 1…N; the backfill gives a contiguous 1…total per study.
- **Race**: a two-session dblink test is added to `study_closing_race.test.sql` (or a sibling using the same committed-fixture pattern). The last-link vote and `add_study_links` run concurrently, and they never end with a closed study that has unused links.

`study_anonymity.test.sql`: the author can select `(id, study_id, token, position)`; `used` is still denied.

#### 4. Contract docs

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Record the new surfaces so later slices build on them.

**Contract**:

- add the migration to "Source of truth";
- add `position` to the Tables row and grants;
- update the Anonymity rule text to `(id, study_id, token, position)`, which reveals creation order only;
- add a new `## public.add_study_links(...)` section with its codes and N semantics;
- add `add_study_links` to the lock-order writer list;
- amend Limits to say that N rises with every addition.

### Success Criteria:

#### Automated Verification:

- Migration applies on a fresh local database: `npx supabase db reset`
- All pgTAP tests pass, including `generate_extra_links.test.sql` and the race test: `npx supabase test db`
- Generated types contain `add_study_links` and `study_links.position`: `npx supabase gen types typescript --local` diff is committed
- Lint passes: `npm run lint`
- Build/type check passes: `npm run build`

#### Manual Verification:

- `contract-surfaces.md` reads consistently: the anonymity rule, the tables, limits and lock order all mention the new writer and column

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Endpoint and study page

### Overview

Wire the writer to an author form on the study page, order links by `position`, and show the newly added links in their own copyable block.

### Changes Required:

#### 1. Add-links endpoint

**File**: `src/pages/api/studies/[id]/links.ts` (new)

**Intent**: Accept the form, call `add_study_links`, and redirect back to the study page. Follow `close.ts`.

**Contract**: `POST /api/studies/<id>/links`, form field `count`.

- **Success**: redirect to `/studies/<id>?added=<count>`.
- **Errors**:
  - `P0002`/`22P02` → plain redirect to the study page;
  - `55000` → `?error=` „Badanie jest zakończone — nie można dodać linków.”;
  - `23514` → `?error=` „Badanie może mieć najwyżej 100 linków.”;
  - `22023`, or `count` not a whole number → `?error=` „Podaj liczbę linków od 1 do <max>.” (or a generic count message when max is unknown);
  - anything else → a generic `?error=`.
- The `count` value is parsed server-side; the client-side `min`/`max` limits are only a hint.

#### 2. Add-links form island

**File**: `src/components/studies/AddLinksForm.tsx` (new)

**Intent**: The „Dogeneruj linki” form, following the `CloseStudyButton` submit-guard and `pageshow` pattern, without a confirmation step.

**Contract**:

- Props: `studyId: string`, `max: number` (`MAX_PARTICIPANTS − total`).
- A labelled number input `count` (min 1, max `max`, default 1) and a `SubmitButton`.
- When `max < 1`, the form is not rendered; instead the page shows a note that the 100-link limit is reached.

#### 3. LinkList numbering

**File**: `src/components/studies/LinkList.tsx`

**Intent**: Let a subset of links keep its real numbers and its own copy-all label.

**Contract**:

- Optional props `firstNumber` (default 1) and `copyAllLabel` (default „Kopiuj wszystkie”).
- The row number and the `aria-label` „Kopiuj link N” use `firstNumber + index`.

#### 4. Study page

**File**: `src/pages/studies/[id].astro`

**Intent**: Order links by `position`, show the new-links block after an addition, and render the form while the study is effectively active.

**Contract**:

- The links query selects `id, token, position` and orders by `position`. It never selects `used`.
- `?added=k` is clamped to 1…total and ignored otherwise. While `effectiveStatus === "active"`, the page renders a „Nowe linki (k)” heading, then `LinkList` over the last k links with `firstNumber = total − k + 1` and `copyAllLabel` „Kopiuj nowe”. This block sits above the full list.
- `AddLinksForm` renders under the full list, next to `CloseStudyButton`, only when `effectiveStatus === "active"`.

#### 5. HTTP tests

**File**: `tests/http/generate-extra-links.test.ts` (new)

**Intent**: Prove the endpoint mapping and page rendering. Follow `tests/http/study-closing.test.ts`.

**Contract**:

- **Active study**:
  - the page offers „Dogeneruj linki”;
  - POST `count=3` → 302 to `?added=3`;
  - the page shows „Nowe linki (3)”, 3 rows numbered N+1…N+3, the full list with N+3 links, and „Liczba uczestników: N+3”;
  - the results endpoint reports `total = N+3`;
  - a new link's `/v/<token>` shows a ballot.
- **Closed study**: the page has no form; POST → 302 with `?error=` (the closed message), and the link count is unchanged.
- **Cap**: POST over the cap → 302 with the limit message.
- **Bad input**: `count=0` and `count=abc` → 302 with the count message.
- **Isolation**: another author's POST → 302 without an error, and nothing is added.

### Success Criteria:

#### Automated Verification:

- HTTP tests pass: `npm run test:http`
- Unit tests pass: `npm run test:unit`
- pgTAP still passes: `npx supabase test db`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- On a phone-width screen, the add-links form, the „Nowe linki” block and „Kopiuj nowe” are usable, and the copied text contains only the new URLs, one per line
- After adding links, reloading the page drops the „Nowe linki” block, and the new links remain last in the numbered list
- A closed study's page shows no add-links form

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- No new pure logic needs unit tests. If the `?added` clamp or the `count` parse is extracted into `src/lib/`, add a small unit test for its boundaries (0, 1, total, total+1, non-numeric).

### Integration Tests:

- pgTAP (`generate_extra_links.test.sql`, race test): status matrix, count validation, cap at exactly 100 / 101, positions, auto-close after added links, owner isolation, and concurrency with the last vote.
- HTTP (`generate-extra-links.test.ts`): endpoint redirects and messages, page rendering of the new block and totals, the closed-study refusal, and isolation.

### Manual Testing Steps:

1. Start a study with N=2. Add 3 links, copy them with „Kopiuj nowe”, and check that there are exactly 3 URLs.
2. Vote on both original links, and check that the study is still „Trwa”. Vote on the 3 new links, and check that it is „Zakończone”.
3. Try the form on a study with 100 links: it should show the limit note.

## Performance Considerations

None. At most 100 links per study, and inserts happen under one row lock.

## Migration Notes

Forward-only migration. It backfills `position` for existing links in uuid order, which matches today's display order, so nothing visibly reorders. Production migrations are applied manually by the user (`db push`). CI does not apply them.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-07), PRD FR-019
- Test-plan risks #3, #6, #7: `context/foundation/test-plan.md:46-50`
- Writer pattern: `supabase/migrations/20261015150000_study_closing_vote_path.sql:179`
- Link generation: `supabase/migrations/20261015130000_study_closing_rules.sql:247`
- Endpoint pattern: `src/pages/api/studies/[id]/close.ts`
- Prior plan: `context/archive/2026-10-15-study-closing-rules/plan-brief.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database — link order and `add_study_links`

#### Automated

- [x] 1.1 Migration applies on a fresh local database: `npx supabase db reset`
- [x] 1.2 All pgTAP tests pass, including `generate_extra_links.test.sql` and the race test: `npx supabase test db`
- [x] 1.3 Generated types contain `add_study_links` and `study_links.position`: `npx supabase gen types typescript --local` diff is committed
- [x] 1.4 Lint passes: `npm run lint`
- [x] 1.5 Build/type check passes: `npm run build`

#### Manual

- [x] 1.6 `contract-surfaces.md` reads consistently: the anonymity rule, the tables, limits and lock order all mention the new writer and column

### Phase 2: Endpoint and study page

#### Automated

- [ ] 2.1 HTTP tests pass: `npm run test:http`
- [ ] 2.2 Unit tests pass: `npm run test:unit`
- [ ] 2.3 pgTAP still passes: `npx supabase test db`
- [ ] 2.4 Lint passes: `npm run lint`
- [ ] 2.5 Build passes: `npm run build`

#### Manual

- [ ] 2.6 On a phone-width screen, the add-links form, the „Nowe linki” block and „Kopiuj nowe” are usable, and the copied text contains only the new URLs, one per line
- [ ] 2.7 After adding links, reloading the page drops the „Nowe linki” block, and the new links remain last in the numbered list
- [ ] 2.8 A closed study's page shows no add-links form
