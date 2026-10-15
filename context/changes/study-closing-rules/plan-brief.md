# Study Closing Rules (S-04) — Plan Brief

> Full plan: `context/changes/study-closing-rules/plan.md`
> Research: `context/changes/study-closing-rules/research.md`

## What & Why

A study must close in three ways:

- automatically after its last link is used (FR-014);
- manually by the author, irreversibly (FR-015);
- at an author-set deadline in the author's time zone (FR-016).

The three paths must share one rule, so a study cannot close twice and cannot accept a vote while it is closing (roadmap S-04 risk). This also closes the acceptance criteria of US-01.

## Starting Point

The participant side already handles `closed`: `get_ballot` returns null, `cast_vote` returns `study_ended`, and the page shows „Badanie jest zakończone”. But nothing writes `closed`, and there are no deadline columns. `cast_vote` locks only the link row, so a close is not serialized against a vote in flight.

## Desired End State

- The author can set an optional deadline in the wizard and close an active study with a two-step confirmation.
- A study whose links are all used, that was closed manually, or that is past its deadline reads „Zakończone” on every author view. Its links show „Badanie jest zakończone” and accept no votes.
- Results stay visible to the author.

## Key Decisions Made

| Decision                 | Choice                                                                                                                                       | Why (1 sentence)                                                                                   | Source                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Deadline semantics       | Computed: `study_status_effective` (+ `effective_status(studies)` computed field) = closed when `active ∧ now() >= closes_at`; never written | No view can show „Trwa” after the deadline, and reads stay `stable`                                | Plan                                                   |
| Deadline boundary        | Closed at exactly `closes_at` (`>=`)                                                                                                         | One unambiguous rule; pgTAP tests it at `now()`                                                    | Plan                                                   |
| Time-zone storage        | `closes_at timestamptz` + `closes_tz` (IANA, from the browser); Postgres converts local → instant                                            | Unambiguous comparison and correct display on UTC Workers, DST handled, no JS date library         | Plan                                                   |
| When the deadline is set | Only when the draft is created; fixed after start; start refused if already past (`22008`)                                                   | Smallest surface, consistent with „no edits after start”                                           | Plan                                                   |
| Vote vs close race       | `cast_vote` and `close_study` lock the study row `FOR NO KEY UPDATE`; a vote on a deleted study returns `study_ended`                        | Hard guarantee of no vote after close; `FOR SHARE` would deadlock or miss the last-link auto-close | Plan (refined from the agreed "serialize with a lock") |
| Auto-close               | The last vote writes `closed` when no unused link remains (live count)                                                                       | Keeps S-07 extra links correct; the last voter still gets `accepted` and the thank-you screen      | Research                                               |
| Manual close UX          | „Zakończ badanie” on the study page, two-step warning, following `StartStudyButton`                                                          | Reuses the proven pattern; the dashboard is S-05's                                                 | Plan                                                   |
| Stale „Trwa” label (F2)  | Label moves into the results island, driven by the effective status                                                                          | Fixes the finding deferred to S-04                                                                 | Research                                               |
| Tests                    | pgTAP (deadline ±1 min, matrix, isolation, two-session race) + HTTP + 1 E2E                                                                  | Covers test-plan risks #3 and #6 at the right layers without the wall clock                        | Plan                                                   |

## Scope

**In scope:**

- migrations for the deadline columns, `study_status_effective` + `effective_status`, `close_study` and the `cast_vote` lock with auto-close;
- deadline handling in `get_ballot`, `get_study_results`, `create_study` and `start_study`;
- types and `contract-surfaces.md`;
- the wizard deadline field, the close endpoint and button, the status label and deadline display, and the dashboard status;
- pgTAP, HTTP and E2E tests.

**Out of scope:**

- editing the deadline after creation;
- a close action on the dashboard (S-05);
- writing `closed` when the deadline passes;
- `closed_at` or a close reason;
- reopening a study;
- background jobs;
- extra links (S-07).

## Architecture / Approach

One SQL rule, `study_status_effective(status, closes_at)` (wrapped by the `effective_status(studies)` computed field), used by every reader:

- `get_ballot`;
- `get_study_results`;
- `cast_vote`'s open check;
- `close_study`;
- the dashboard (via a PostgREST computed field).

Only two writers set `closed`, and both lock the study row first:

- `close_study`, for a manual close;
- `cast_vote`, on the last link.

The deadline is never written. It is evaluated at read time, in each transaction.

## Phases at a Glance

| Phase                                         | What it delivers                                                                            | Key risk                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1. Deadline in the schema and one status rule | Columns, `effective_status`, deadline-aware reads, create/start with a deadline, pgTAP      | Time-zone and DST conversion; computed-field exposure through PostgREST                  |
| 2. Vote path and manual close                 | `cast_vote` lock + auto-close, `close_study`, matrix and race tests                         | Lock ordering must keep the anonymity order; `dblink` may not work in CI (HTTP fallback) |
| 3. Author UI                                  | Wizard deadline, close button/endpoint, live status label (F2), deadline display, dashboard | Mapping `22023` correctly between deadline and variant errors                            |
| 4. E2E                                        | Manual close → participant sees „Badanie jest zakończone”                                   | Flakiness across islands and redirects                                                   |

**Prerequisites:** S-02 done (it is). Docker for `npx supabase test db`. Work on a new branch from `main`, not `test/e2e-setup`.
**Estimated effort:** ~3–4 sessions. Phases 1–2 suit `/10x-tdd`, phase 3 `/10x-implement`, phase 4 `/10x-e2e`.

## Open Risks & Assumptions

- The stored `status` can read `active` after a deadline. Any future reader that queries `studies.status` directly instead of `effective_status` will be wrong. This is recorded in `contract-surfaces.md`.
- Whether `dblink` can connect inside the local or CI Supabase container is untested. Check it locally first. The fallback is a concurrent HTTP test, which does not prove serialization.
- Generated types may not infer the `effective_status` computed field in `select()`. In that case it is narrowed once at the query boundary.
- Every new or recreated function revokes `from public, anon` explicitly, because Supabase's default privileges would otherwise expose it to anon.
- The race test (`study_closing_race.test.sql`) runs outside the rollback convention. It uses committed dblink fixtures with cleanup at the start and at the end.

## Success Criteria (Summary)

- No vote is recorded for a study that was closed manually, is past its deadline, or has used all its links. The pgTAP tests prove this by row counts, including the two-session race.
- Every author view shows the correct status, and participants see „Badanie jest zakończone” for any closed study, while the last voter still sees the thank-you screen.
