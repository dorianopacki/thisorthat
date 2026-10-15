# Author Study Dashboard (S-05) — Plan Brief

> Full plan: `context/changes/author-study-dashboard/plan.md`

## What & Why

FR-002: after signing in, the author sees a plain list of only their own studies, each with its status (szkic / trwa / zamknięte) and progress „X z N”, and opens a study from it. This is the first place where author isolation is visible to the user, so the list must rely on database rules, not app-side filtering.

## Starting Point

`/dashboard` already lists the author's studies with the effective status (added in S-04), but it has no progress and still carries template chrome: English greeting, a stub sentence and a duplicate Sign out. Authors cannot read `study_links.used`. Today only `get_study_results`, one study at a time, exposes `responded`/`total`.

## Desired End State

`/dashboard` shows „Twoje badania” with `Topbar`, a „Nowe badanie” button, and the author's studies newest first. Each row shows its status label and progress:

- started studies: „Odpowiedziało X z N”, where N is the live link count;
- drafts: „Planowane: N uczestników”.

A study past its deadline reads „Zakończone”.

## Key Decisions Made

| Decision          | Choice                                                                                                | Why (1 sentence)                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Source of „X z N” | One `security definer` RPC `list_author_studies()` returning typed rows, owner-scoped by `auth.uid()` | One call, owner check in the body like `get_study_results`, no forged-row risk of computed fields |
| Draft progress    | „Planowane: N uczestników” from `participant_target`; started studies use the live `total`            | Shows scale on drafts without bending the N = total rule from contract-surfaces                   |
| Page scope        | Remove the stub: Polish h1, `Topbar`, no template texts; update e2e setup/seed locators               | Delivers the target FR-002 page with a small diff                                                 |
| Tests             | pgTAP (counts, status, isolation, anon, column set) + HTTP progress assertion + unit for the label    | Covers the real risk where it lives; e2e stays reserved for the full loop per the test plan       |
| Ordering          | `created_at desc, id`, fixed in the function                                                          | Keeps the current order, deterministic                                                            |

## Scope

**In scope:**

- `list_author_studies()` migration with pgTAP, types and a contract-surfaces entry
- `progressLabel` helper with unit tests
- the dashboard page rewrite
- the HTTP assertion and the e2e locator updates

**Out of scope:**

- pagination, filters, search and live polling;
- row actions (close, edit, delete);
- a full `/10x-ui` restyle;
- a dashboard e2e spec;
- a CI migration step.

## Architecture / Approach

`dashboard.astro` calls `supabase.rpc("list_author_studies")`. The function (`stable`, `security definer`, `search_path = ''`) selects `studies where author_id = auth.uid()`. For each study it computes `study_status_effective(status, closes_at)` and two counts over `study_links` (used / all). Execute is revoked from `public, anon` and granted to `authenticated`. The page maps `status` → `STATUS_LABELS`, and the row → `progressLabel`.

## Phases at a Glance

| Phase                         | What it delivers                                                 | Key risk                                                        |
| ----------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| 1. RPC listy badań autora     | `list_author_studies()` + pgTAP + types + contract entry         | Leaking another author's rows or granting `anon` execute        |
| 2. Docelowa strona /dashboard | Target page with progress, `Topbar`, updated HTTP/e2e assertions | Prod dashboard breaks if the migration is not pushed with merge |

**Prerequisites:** S-02 done (yes). Start from fresh `main` on a new branch `feat/author-study-dashboard`.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- CI does not apply migrations: `npx supabase db push` to prod must accompany the merge (tracked as manual step 2.10).
- Dashboard progress is as of page load, with no polling. This is assumed acceptable for a list page.

## Success Criteria (Summary)

- An author sees only their own studies, each with the correct status and „X z N” (or the planned N for drafts).
- A past-deadline or fully voted study reads „Zakończone” on the dashboard.
- No template text remains, and all test layers stay green.
