# Edit Draft and Delete Study (S-06) — Plan Brief

> Full plan: `context/changes/edit-and-delete-study/plan.md`

## What & Why

- **FR-017:** the author can edit a study while it is a draft: title, N, variants and the optional deadline.
- **FR-018:** the author can delete a study at any stage.
- **FR-010:** a participant holding a link to a deleted study sees „Badanie jest zakończone”.

Editing must be hard-blocked outside `draft`, or variants could change under cast votes.

## Starting Point

Delete already works in the database:

- RLS lets authors delete their own studies in any state.
- Links, votes and comments cascade with the study.
- `get_ballot` → `null` already renders „Badanie jest zakończone”.

What's missing:

- **Draft editing.** Row-by-row RLS edits can't enforce 2–6 variants, collide with `unique(position)` and can race `start_study`.
- **Deadline editing.** It isn't editable at all; the update grant was revoked, waiting for a validated path in S-06.
- **The UI.** The app has no edit or delete UI.

## Desired End State

- **Edit.** A draft's page has „Edytuj”, which opens `/studies/<id>/edit`: the creation form, prefilled, saved atomically. Started or closed studies cannot be edited at either layer.
- **Delete.** Every study page has „Usuń badanie” with an inline two-step confirmation and a warning that depends on the state. After deleting, the dashboard shows „Badanie zostało usunięte.” and the study's links show „Badanie jest zakończone”.
- **Isolation.** Author B can't view, edit or delete A's studies.

## Key Decisions Made

| Decision      | Choice                                                                                                                  | Why (1 sentence)                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Edit path     | New `security definer` RPC `update_study_draft`: lock the study, owner + draft check, validate, replace the whole draft | Atomic; closes the start race, the position collision and the missing 2–6 check; reuses create's errors |
| Deadline      | Editable on a draft: set, change or clear, validated exactly like `create_study`                                        | FR-017 has no exclusion, and it rescues a draft whose deadline passed (which can't be started)          |
| Deadline zone | Prefill and save in the stored `closes_tz`; a newly added deadline uses the browser zone                                | An unchanged deadline round-trips exactly                                                               |
| Entry point   | Study page only: „Edytuj” → `/studies/<id>/edit`; „Usuń badanie” in every state                                         | Confirmation sits next to the full context; the dashboard row stays a simple link                       |
| Delete path   | Existing RLS policy, `delete … select id`; 0 rows → the 404 page                                                        | No new contract needed; the outcome doesn't reveal whose study it was                                   |
| Delete UX     | Inline two-step (CloseStudyButton pattern), warning by state, then `/dashboard?deleted=1` notice                        | Familiar pattern; names the lost links and results exactly when they apply                              |
| Tests         | pgTAP + HTTP (+ unit for the deadline helper); no new e2e                                                               | Guarantees proven in the DB, isolation and screens over HTTP, as the test plan says                     |

## Scope

**In scope:**

- `update_study_draft` migration, pgTAP, types and the contract-surfaces entry
- `toLocalInputValue` helper
- `StudyWizard` edit mode
- edit page and update endpoint
- `DeleteStudyButton` and delete endpoint
- dashboard notice
- route-access entries
- HTTP isolation and owner tests

**Out of scope:**

- dashboard row actions
- editing started studies
- soft delete or undo
- a type-to-confirm barrier
- changing `create_study`
- a new e2e spec
- a delete-vs-vote concurrency test
- a CI migration step

## Architecture / Approach

**Edit:** `/studies/[id]/edit.astro` (RLS read, draft only) → `StudyWizard` with `initial` → `POST /api/studies/[id]/update`. The endpoint uses the shared validation, then `rpc("update_study_draft")`, then maps errors: 22023/23514 → the edit page; 55000 → the study page; P0002 → 404.

`update_study_draft` mirrors `start_study`'s lock (`FOR UPDATE`, study → link order) and `create_study`'s validation.

**Delete:** `DeleteStudyButton` → `POST /api/studies/[id]/delete` → RLS delete with `select id` → `/dashboard?deleted=1`, or the 404 page.

## Phases at a Glance

| Phase                              | What it delivers                                                                    | Key risk                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1. Database — `update_study_draft` | Atomic validated draft edit, pgTAP (incl. post-delete ballot/vote), types, contract | Edit path slipping past draft-only or the deadline validation drifting from `create_study` |
| 2. Draft editing                   | Helper + wizard edit mode + edit page + update endpoint + HTTP tests                | Deadline prefilled or saved in the wrong zone; creation regressing                         |
| 3. Deleting a study                | Two-step delete, endpoint, dashboard notice, HTTP tests                             | B deleting A's study or learning it exists; an accidental delete                           |

**Prerequisites:** S-05 done (PR #32). Work on branch `feat/edit-and-delete-study`.
**Estimated effort:** ~1–2 sessions across 3 phases.

## Open Risks & Assumptions

- CI doesn't apply migrations, so `npx supabase db push` to prod must accompany the merge (manual step 3.8).
- Delete vs an in-flight `cast_vote` is serialized by the study row lock. It isn't covered by a two-session test; only the sequential outcome is.
- The `create_study` deadline validation is duplicated in `update_study_draft`; pgTAP covers both so they cannot drift silently.

## Success Criteria (Summary)

- The author edits a draft (including the deadline) and sees the change. Started and closed studies can't be edited.
- The author deletes any of their studies after a confirmation, and its participants see „Badanie jest zakończone”.
- Another author can't view, edit or delete them, and all test layers stay green.
