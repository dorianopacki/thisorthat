# Live Results and Comments — Plan Brief

> Full plan: `context/changes/live-results-and-comments/plan.md`

## What & Why

Roadmap S-03, the milestone's north star: the author finally sees the outcome of a study — „Odpowiedziało X z N”, a ranking of variants by votes (ties share a place) and anonymous comments under each variant, refreshing while the study runs (FR-011–FR-013). Without it the study loop never closes.

## Starting Point

F-01 already ships `get_study_results` — the only author read path over votes and comments, aggregate-only, comments sorted by body, proven by pgTAP. The study page `/studies/<id>` shows only variants and links; nothing renders results, and Supabase Realtime cannot see the RLS-hidden vote tables.

## Desired End State

Opening an active or closed study shows progress, the ranking with places and comments above the link list; a draft looks as today. With the page open, a new vote appears within ~10 s without reload and without any highlight of what changed. The rules are recorded in `contract-surfaces.md`.

## Key Decisions Made

| Decision        | Choice                                                     | Why (1 sentence)                                                                                   |
| --------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Ties            | Competition ranking: 5,5,2,0 → 1,1,3,4; ties in wizard order | The place says how many variants did better; zero-vote variants are still ranked.                  |
| Live mechanism  | Poll a JSON endpoint every 10 s while active and visible    | Reuses the tested RPC; no new DB surface or Realtime authorization.                                 |
| Anonymity       | Accept the inherent live-diff limit; no „new” cues           | Exists with a plain reload too; the UI must not amplify it — documented like the `cast_vote` probe. |
| Placement       | Results on `/studies/[id]`, replacing the plain variant list | One page per study; no new route to protect.                                                        |
| Ranking compute | Pure TS `rankVariants`, no DB change; manual verification    | Keeps the slice migration-free; unit tests arrive with the test-plan rollout.                      |
| X z N           | `responded` of `total` (links), not `participant_target`     | S-07 adds links mid-study and progress must follow the live count.                                  |

## Scope

**In scope:**
- `src/lib/study-results.ts` (types, `rankVariants`, Polish `formatVotes`)
- `StudyResults` island (render + polling) on the study page
- `GET /api/studies/[id]/results`
- `contract-surfaces.md` Results view section and anonymity extension

**Out of scope:**
- Any migration or change to `get_study_results`; Supabase Realtime
- k-vote thresholds or results-after-close
- Highlighting new items; tying comments to votes
- Closing (S-04), dashboard (S-05), extra links (S-07), images (S-08); charts/export
- App unit test runner

## Architecture / Approach

The page calls `get_study_results` once and server-renders `StudyResults` with that data. While `status = 'active'` and the tab is visible, the island fetches `/api/studies/<id>/results` (same RPC, `no-store`, behind the existing auth middleware) every 10 s and replaces its state wholesale. It stops on a non-active status, 404 or expired session (`res.redirected`).

## Phases at a Glance

| Phase                          | What it delivers                                        | Key risk                                                      |
| ------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------- |
| 1. Results on the study page   | SSR progress, ranking with ties, comments               | Off-by-one in tie places; Polish plural forms                 |
| 2. Live updates                | JSON endpoint + polling lifecycle + contract registry    | Polling leaks (hidden tab, closed study, expired session)     |
| 3. Production rollout          | PR → CI → merge; no DB push                              | None beyond CI; prod check from a real phone                  |

**Prerequisites:** S-02 done (it is); local Supabase running for manual checks.
**Estimated effort:** ~1–2 sessions across 3 phases.

## Open Risks & Assumptions

- With small N, an author comparing snapshots can tell which variant a vote went to, which comments came with it and when — accepted, documented, not amplified by the UI.
- `rankVariants` has no automated test until the test-plan rollout adds a unit runner.
- Polling every 10 s assumes a handful of concurrently open author pages (MVP scale).

## Success Criteria (Summary)

- The author sees correct places with ties (1,1,3,4), vote counts and comments for their study.
- A vote from a phone appears on the open author page within ~10 s in production.
- No results UI reveals more than `get_study_results` does, and nothing marks what changed.
