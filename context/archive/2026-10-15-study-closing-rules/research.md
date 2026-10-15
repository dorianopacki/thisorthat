---
date: 2026-10-15T14:33:59+02:00
researcher: Claude (Opus 5.5) for dorian.opacki
git_commit: f24d574e78279ea7284096d0b1e0d05e5f71b91b
branch: test/e2e-setup
repository: dorianopacki/thisorthat
topic: "S-04 study-closing-rules — current lifecycle, vote path and author surfaces that closing must extend"
tags: [research, codebase, study-lifecycle, cast_vote, get_ballot, get_study_results, start_study, closing, deadline]
status: complete
last_updated: 2026-10-15
last_updated_by: Claude (Opus 5.5)
---

# Research: S-04 `study-closing-rules`

**Date**: 2026-10-15T14:33:59+02:00
**Researcher**: Claude (Opus 5.5) for dorian.opacki
**Git Commit**: f24d574e78279ea7284096d0b1e0d05e5f71b91b
**Branch**: test/e2e-setup
**Repository**: dorianopacki/thisorthat

## Research Question

What does the codebase already provide for closing a study, and what must S-04 add so that the three closing paths — auto-close after all N links are used (FR-014), manual close by the author (FR-015), and an author-set deadline in the author's time zone, evaluated lazily (FR-016) — converge on one rule, with no double close and no vote accepted for a closed study?

## Summary

- **The `closed` state already exists end to end; nothing sets it.** The enum is `('draft','active','closed')` (`supabase/migrations/20261002095727_study_data_model.sql:13`). `cast_vote` refuses closed studies (`…/20261002124043_cast_vote_comment_uuid_errcode.sql:102-124`), `get_ballot` returns null for non-active studies, and the participant page renders „Badanie jest zakończone” on that null (`src/pages/v/[token].astro:55-56,77`). Author results already accept `closed` and stop polling when a poll sees it (`src/components/studies/StudyResults.tsx:28-29,85-87`). A search of `supabase/` and `src/` found no code path that writes `status = 'closed'`.
- **Status changes go through security-definer RPCs only.** `authenticated` has no column grant on `status`, and the update policy is draft-only (`…study_data_model.sql:101-103,132-135`). A direct `UPDATE … SET status='closed'` is already tested to raise `42501` (`supabase/tests/study_isolation.test.sql:119-124`). Manual close therefore needs a new definer RPC. `start_study` is the template: `SELECT … FOR UPDATE` on the owned row, `P0002` when not found, `55000` on the wrong state (`…/20261005075735_create_and_start_study.sql:97-114`).
- **There is no deadline or time-zone data anywhere.** `studies` has no `closes_at`/timezone columns (`…study_data_model.sql:19-27`), `src/` has no date or `Intl` handling, and `package.json` has no date library.
- **The vote path does not lock the study row.** The one-vote guarantee is a single conditional `UPDATE study_links … FROM studies … AND s.status='active'` (`…cast_vote_comment_uuid_errcode.sql:102-109`), which takes a row lock on the link only. _Inference, not tested:_ a close that commits while a vote is in flight is not serialized against that vote. Closing safely needs a shared lock on the `studies` row, either `FOR SHARE`/`FOR UPDATE` in `cast_vote` or an equivalent.
- **Lazy evaluation conflicts with the current functions being read-only.** Both `get_ballot` and `get_study_results` are `language sql stable` (`…one_time_link_voting.sql:22-23`, `…study_data_model.sql:345-348`), so they cannot write a status change. The plan has to choose between writing the close (a volatile RPC on page open) and computing an effective status (`active` and `now() < closes_at`) in every read and in `cast_vote`. That is the main design choice of this change. See Open Questions.

## Detailed Findings

### Data model

- `study_status` enum: `draft, active, closed` (`…study_data_model.sql:13`). No enum change is needed.
- `studies` columns: `id, author_id, title, participant_target, status, created_at, updated_at` (`…study_data_model.sql:19-27`). `participant_target` is limited to 1–100 (`…create_and_start_study.sql:21-26`).
- The only trigger is `studies_set_updated_at` (BEFORE UPDATE) (`…study_data_model.sql:72-88`). There are no status-transition triggers.
- `study_links (id, study_id, token, used)` has no timestamps (`…study_data_model.sql:40-45`).

### Vote path — `cast_vote`

- The current definition is `…cast_vote_comment_uuid_errcode.sql:7-138`. It is security definer with `search_path=''`, and `anon` and `authenticated` can execute it (`:137-138`). It returns `'accepted' | 'link_used' | 'study_ended'`.
- An unknown token returns `study_ended` before validation, with nothing locked (`:30-37`). Input errors raise `22023` before the link is consumed, so `used` cannot be probed (`:43-97`).
- The consume step is the conditional UPDATE quoted above (`:102-109`). When it matches nothing, the function returns `link_used` only if the link is used and the study is `active`; otherwise it returns `study_ended` (`:111-124`). So a closed study already yields `study_ended` whether its link is used or not. This is tested in `supabase/tests/cast_vote.test.sql:120-122`.
- On success it inserts one `votes` row and the comments, then returns `accepted` (`:126-133`). **No auto-close runs after the last link.**
- Auto-close fits naturally after the insert, in the same transaction: if no unused link remains for the study, set `status='closed'` where it is still `active`. Counting links live, rather than comparing with `participant_target`, keeps S-07 (adding extra links) correct (`context/foundation/roadmap.md:185`; `docs/reference/contract-surfaces.md:132`).
- _Concurrency (inference from Postgres READ COMMITTED semantics; no test covers it):_ `UPDATE … FROM studies` locks only the `study_links` row. A concurrent close updates `studies` without waiting, and the vote's re-check reads the `studies` version it already joined. Test-plan risk #3 asks for exactly this case: pgTAP with two sessions, asserting recorded row counts rather than return codes (`context/foundation/test-plan.md:60`).

### Participant surfaces

- `get_ballot` returns null unless `status='active'` (`…one_time_link_voting.sql:20-48`). It is `stable` SQL and must never read `used` (`contract-surfaces.md:11`).
- Page `src/pages/v/[token].astro` checks screens in this order (`:39-69`): `?status=accepted` → thanks, with no DB call; `get_ballot` null → ended; voted cookie or `?status=used` → used; otherwise the ballot.
  - Thanks comes first deliberately, so the last voter still sees it after S-04 auto-closes the study (`:39-40`; `contract-surfaces.md:50`: „S-04 must keep this order”).
  - The ended screen returns 200 so that an unknown token and a closed study look the same (`:71-72`).
- The vote endpoint `src/pages/api/v/[token].ts:72-80` maps `study_ended` to a redirect to the bare `/v/<token>`, which then renders ended.
- **Consequence:** if `get_ballot` and `cast_vote` both treat a past deadline as ended, the participant side needs no app change.

### Author surfaces

- `src/pages/studies/[id].astro` reads `id, title, participant_target, status` (`:26-30`).
  - `draft` → variants plus `StartStudyButton`; any other status → `get_study_results` plus `LinkList` (`:39-76,128-137`).
  - Labels come from `STATUS_LABELS = { draft: "Szkic", active: "Trwa", closed: "Zakończone" }` (`:84`).
  - A close button belongs in the non-draft branch and should appear only when the study is `active`.
- Confirmation template: `src/components/studies/StartStudyButton.tsx`.
  - It is two-step: a „Rozpocznij” button, then a native POST form with a `role="alert"` warning and „Tak, rozpocznij” / „Anuluj” (`:44-81`).
  - It also has a double-submit guard and a bfcache reset (`:26-42`).
- Endpoint template: `src/pages/api/studies/[id]/start.ts`. It calls the RPC (`:16`) and maps `55000` to the study page, `P0002`/`22P02` to the study page (which renders 404), `22023` to `?error=`, and anything else to a generic message (`:20-25`).
- Results: `src/components/studies/StudyResults.tsx`.
  - It polls every 10 s only while the initial status is `active` (`:5,28-29`).
  - It shows „Badanie jest zakończone — wyniki są ostateczne.” only when a _poll_ returns a non-active status (`:85-87`). A study loaded already closed shows no final notice.
  - `get_study_results` has no status filter and returns `{status, responded, total, variants}` for owned studies (`…study_data_model.sql:345-390`). `responded`/`total` count used and all links (`:354-361`).
  - The results endpoint passes the RPC through unchanged (`src/pages/api/studies/[id]/results.ts:10-25`).
- The dashboard shows the same status labels (`src/pages/dashboard.astro:7,46`). Under lazy evaluation it would show „Trwa” past a deadline unless it also evaluates the deadline.

### Create wizard (where a deadline would be entered)

- `src/components/studies/StudyWizard.tsx` has fields `title`, `participant_target`, `variant[]` (`:128-186`), client-side `validate()` (`:54-87`), and a native POST to `/api/studies`.
- `src/pages/api/studies/index.ts` validates again on the server (`:21-42`) and calls `create_study(p_title, p_participant_target, p_variants)` (`:61-65`).
- `src/lib/study-limits.ts` mirrors the DB checks (`:6-14`).
- `start_study` is called as a bare POST with no body (`start.ts`). Today a deadline could therefore enter only through `create_study`, or through a new parameter or RPC.

### Route protection and test harness

- New author endpoints must be added to `ROUTE_AUDIENCE` in `src/lib/route-access.ts:10-28`. `tests/unit/route-access.test.ts` fails for any page missing from the map, and `tests/http/route-access.test.ts:25-43` needs a `PROBES` row for each entry.
- Middleware enforces only that a user is signed in (`src/middleware.ts:19-21`). Ownership is enforced in the RPCs and RLS.
- pgTAP suites live in `supabase/tests/<topic>.test.sql`. Each file follows `begin; … plan(N); … finish(); rollback;`, inserts superuser fixtures with fixed uuids, and switches role with `set local role` plus `request.jwt.claims`. They run with `npx supabase test db` (`AGENTS.md:27`; `.github/workflows/ci.yml:51`).
- `AGENTS.md:42` requires every schema change to ship with a forward-only migration, regenerated `src/lib/database.types.ts`, pgTAP tests, and an update to `docs/reference/contract-surfaces.md`.
- E2E: `tests/e2e/one-link-one-vote.spec.ts` is the template (unique title, `afterEach` cleanup, anonymous participant context, `waitForIslands()`). Its header notes that closed-study votes „wait for S-04” (`:3-4`).
- Real-clock testing is an anti-pattern for risk #6 (`test-plan.md:63`). Playwright's clock does not move the database's `now()`, so deadline boundaries belong in pgTAP with a controlled clock or an injectable "now".

## Code References

- `supabase/migrations/20261002095727_study_data_model.sql:13` — `study_status` enum
- `supabase/migrations/20261002095727_study_data_model.sql:19-27` — `studies` columns (no deadline)
- `supabase/migrations/20261002095727_study_data_model.sql:101-103,132-135` — no column grant on `status`; draft-only update policy
- `supabase/migrations/20261002095727_study_data_model.sql:345-390` — `get_study_results` (stable, no status filter)
- `supabase/migrations/20261002124043_cast_vote_comment_uuid_errcode.sql:102-124` — atomic consume and `study_ended` fallback
- `supabase/migrations/20261005075735_create_and_start_study.sql:97-132` — `start_study` lock-then-check pattern
- `supabase/migrations/20261005132123_one_time_link_voting.sql:20-48` — `get_ballot` (stable, active-only)
- `src/pages/v/[token].astro:39-81` — participant screen precedence and titles
- `src/pages/api/v/[token].ts:72-80` — vote outcome redirects
- `src/pages/studies/[id].astro:26-30,84,128-137` — author study page status branching and labels
- `src/components/studies/StartStudyButton.tsx:26-81` — confirm-before-irreversible-action pattern
- `src/pages/api/studies/[id]/start.ts:16-25` — RPC error mapping template
- `src/components/studies/StudyResults.tsx:28-29,85-87` — polling gate and final notice
- `src/lib/route-access.ts:10-28` — route audience map
- `docs/reference/contract-surfaces.md:11,46,50,87,128,132` — rules S-04 must keep

## Architecture Insights

- **One status writer per transition, inside a definer function, after locking the row first.** Only `start_study` writes a status today. S-04 adds the `active → closed` writers (manual close, auto-close in `cast_vote`, and the deadline close if it is materialized). The "three paths, one rule" risk (`roadmap.md:149`) suggests one internal SQL helper that all of them call, idempotent on `where status = 'active'`.
- **"Ended" is deliberately indistinguishable from "unknown".** Any new participant read must keep returning null or `study_ended` and must not reveal `used` or the reason for closing (`contract-surfaces.md:11`; `context/archive/2026-10-05-one-time-link-voting/reviews/impl-review.md:81`).
- **N is the live link count, not `participant_target`**, so S-07 can add links later (`contract-surfaces.md:132`; `roadmap.md:185`).
- **Contract registry discipline:** every RPC change lands in `docs/reference/contract-surfaces.md` together with its types and pgTAP tests (`AGENTS.md:42`).

## Historical Context (from prior changes)

- `context/archive/2026-10-02-study-data-model/plan.md:41` — „Auto-close … manual close … deadline — S-04; it will extend `cast_vote` and add a close function and deadline column.” This matches the current code: none of the three exists yet.
- `context/archive/2026-10-02-study-data-model/plan.md:96` — only definer functions (S-01 start, S-04 close) change `status`. Supported by `…study_data_model.sql:101-103`.
- `context/archive/2026-10-02-study-data-model/plan.md:33` — deadline closing is lazy and not part of the F-01 schema. Supported, since no deadline column exists.
- `context/archive/2026-10-05-one-time-link-voting/plan.md:50` — thank-you comes before ended because of S-04. Implemented at `src/pages/v/[token].astro:39-46`.
- `context/archive/2026-10-06-live-results-and-comments/reviews/impl-review.md:36-44` — **F2 deferred to S-04:** the server-rendered „Trwa” label stays stale after polling sees `closed`. S-04 decides where the status label lives.
- `context/archive/2026-10-06-testing-access-boundaries/research.md:139` — S-04 manual close and deadline are new owner-checked status writes and need the same isolation matrix (foreign author → `P0002`).
- `context/foundation/test-plan.md:46,49,60,63` — risks #3 and #6 and their strategy: pgTAP with concurrent sessions and a status matrix, a deadline ± 1 minute in the author's zone, and no wall-clock tests.
- `context/foundation/tech-stack.md:24` — "Scheduled closing (FR-016) is evaluated when a link or results page is opened, so no background jobs are needed."

## Related Research

- `context/archive/2026-10-06-testing-access-boundaries/research.md` — author isolation matrix that the new close RPC must join
- `context/archive/2026-10-02-study-data-model/` — original lifecycle and grant design

## Open Questions

1. **Lazy deadline semantics (roadmap :148, owner: user).** There are two options:
   - **(a) Materialize:** a volatile RPC writes `closed` when a link, results page or dashboard is opened.
   - **(b) Compute:** keep stored `active` and derive the effective status (`active ∧ now() < closes_at`) in `get_ballot`, `cast_vote`, `get_study_results` and the dashboard query.

   With (b) the reads stay `stable` and no page is ever stale. With (a) the stored status is real but can lag, which is the trap named in test-plan #6. The choice also decides how F2 (stale „Trwa” label) is fixed.

2. **How the time zone is captured and stored.** One option is to store `closes_at timestamptz` computed from the author's input and browser zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`). Another is to also store the IANA zone for display. Nothing exists today.
3. **When the deadline is set and whether it can change.** It could be set at creation (draft) only, at start, or editable while active (and removable?). This is not decided in any document. The PRD only says closed studies accept no edits (`prd.md:118`).
4. **Deadline vs a vote in flight, and manual close vs a vote in flight.** Should a vote whose transaction began before the close commits be accepted? This needs an explicit locking decision (see Vote path) plus a pgTAP test with two sessions.
5. **Manual close UX.** Copy for the irreversible-action warning (the FR-015 Socrates note accepts irreversibility), and whether the dashboard (S-05, not built yet) needs a close action or only the study page.
6. **Scope of deadline closing.** `shape-notes.md:91` suggests the deadline as the cheapest thing to defer, as a suggestion only. The PRD keeps FR-016 as must-have, and this research assumes it is in scope.
7. **Test-plan Phase 2 folder.** `test-plan.md:75` lists `context/changes/testing-db-guarantees-migrations/` as „change opened”, but the folder does not exist. This is unrelated to S-04 scope but affects where the risk #3 concurrency test lives.
