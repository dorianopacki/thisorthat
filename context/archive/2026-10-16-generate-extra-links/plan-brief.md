# Generate Extra Links (S-07) — Plan Brief

> Full plan: `context/changes/generate-extra-links/plan.md`

## What & Why

The author can generate extra one-time links in an active study (FR-019). This raises N and moves the moment of auto-close. A closed study cannot be extended. This is the last slice of stream B (closing a study) and covers test-plan risks #3, #6 („extra link after close”) and #7 („X z N” follows added links).

## Starting Point

S-04 already counts links live: auto-close counts unused links live, and „Odpowiedziało X z N” uses the live `total`. The contract already caps N (`participant_target`) at 100 total links.

Two things are missing:

- a writer that adds links after start (only `start_study` creates them);
- a creation order for links. `study_links.id` is a random uuid, so added links would be scattered through the list.

## Desired End State

On an active study's page, a „Dogeneruj linki” form adds k links (1 to 100 − total). The page then shows a „Nowe linki (k)” block with „Kopiuj nowe”.

The numbered list keeps the new links last. „Liczba uczestników” and „X z N” show the new total, and the study auto-closes only after the added links are used too. Closed or past-deadline studies have no form, and a forced POST is refused.

## Key Decisions Made

| Decision          | Choice                                                                                                                   | Why (1 sentence)                                                                                                   | Source               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | -------------------- |
| Meaning of N      | `participant_target` := live link count + k on each addition                                                             | Matches the roadmap („podnosi N”) and the contract (N = total links ever), and the existing check enforces the cap | Plan                 |
| Finding new links | New `study_links.position` (1…total per study) + a „Nowe linki (k)” block from `?added=k`                                | Stable numbering, and sending just the new links is one click                                                      | Plan                 |
| Input UX          | Number field (1 to 100 − total, default 1), no confirmation                                                              | Adding is not destructive, and the form-endpoint pattern is reused                                                 | Plan                 |
| Writer            | `add_study_links` (`security definer`), locks the study `for no key update`, refuses unless effectively active (`55000`) | Same shape as `close_study`, serialized with the last-vote auto-close                                              | Plan / S-04 contract |
| Cap enforcement   | `studies_participant_target_check` (1–100) via the N update → `23514`, full rollback                                     | No duplicated limit logic                                                                                          | Plan                 |
| Anonymity         | Authors may select `position`; `used` stays ungranted; `get_ballot` unchanged                                            | Position reveals creation order only, never usage                                                                  | Plan                 |
| Tests             | pgTAP (matrix, cap, positions, auto-close, isolation, race with last vote) + HTTP                                        | Risks live in the database and endpoint; no E2E for this slice                                                     | Plan                 |

## Scope

**In scope:**

- the migration (`position` + backfill, `start_study` assigning positions, `add_study_links`, the grant);
- regenerated types;
- `contract-surfaces.md`;
- the `/api/studies/[id]/links` endpoint, the `AddLinksForm` island, `LinkList` numbering props and study-page changes;
- pgTAP and HTTP tests.

**Out of scope:**

- removing links;
- keeping the original N;
- adding links to a draft or closed study;
- a confirmation step;
- changing the deadline;
- the new-links block after a reload;
- `position` for participants;
- E2E;
- a dashboard action.

## Architecture / Approach

Study page form → `POST /api/studies/<id>/links` → `add_study_links`. The function:

- locks the study row;
- checks the effective status;
- appends links at `max(position) + 1…`;
- sets N to the new total.

It redirects to `/studies/<id>?added=k`. The page orders links by `position` and renders the last k links in a separate `LinkList`. Auto-close and the „X z N” counts already read live counts, so they need no change.

## Phases at a Glance

| Phase                                          | What it delivers                                                                    | Key risk                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1. Database — link order and `add_study_links` | Migration, types, contract docs, pgTAP incl. a race test                            | Positions for fixture inserts without a position; dblink race test in CI |
| 2. Endpoint and study page                     | Endpoint + error mapping, form island, „Nowe linki” block, ordered list, HTTP tests | Error-code mapping (`55000` / `23514` / `22023`) to the right message    |

**Prerequisites:** S-01 and S-04 done (they are). Docker for `npx supabase test db`. Production migration applied manually (`db push`).
**Estimated effort:** ~1–2 sessions. Phase 1 suits `/10x-tdd`, phase 2 `/10x-implement`.

## Open Risks & Assumptions

- Existing pgTAP fixtures insert links without a position. The column needs a default or trigger that assigns the next number, or those tests break.
- Backfill uses uuid order, which is today's display order, so nothing visibly reorders for existing studies.
- The new-links block depends on `?added=k`. It is gone after a reload by design, and the full list keeps the new links last.
- Links cannot be removed, so an accidental large k is permanent (accepted; no confirmation step).

## Success Criteria (Summary)

- An author adds links to an active study and copies only the new ones in one click. „X z N” and „Liczba uczestników” show the new total.
- The study closes only after every link, old and new, is used. A closed or past-deadline study can never gain links, which pgTAP proves, including under concurrency with the last vote.
