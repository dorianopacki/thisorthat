# Create and Start a Text Study — Plan Brief

> Full plan: `context/changes/create-and-start-study/plan.md`

## What & Why

Roadmap S-01: a signed-in author creates a text study (title, 2–6 variants, N between 1 and 100), clicks „Rozpocznij” and copies N one-time links. It is the first step towards the north star S-03. Without it there is no study to vote in (S-02) and no results to show (S-03).

## Starting Point

F-01 put the schema, RLS, `cast_vote` and `get_study_results` in production. Nothing can change `studies.status` or create links yet (both are function-only by design), the limits are sanity checks only (`N > 0`, no variant cap), and the app has only auth pages and a placeholder dashboard.

## Desired End State

From the dashboard the author opens „Nowe badanie”, fills the wizard and lands on `/studies/<id>` with a draft. „Rozpocznij” (with confirmation) makes it active and lists N links `<origin>/v/<token>` with „Kopiuj wszystkie” and per-link copy. The links can be copied again any time via the dashboard list. The database refuses anything outside the limits, and a failed start leaves no links behind.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Limits | Variants 2–6, N 1–100 (total links, S-07 too) | Phone-sized ballot with comments; author sends each link by hand to a closed group. |
| Flow | Wizard saves a draft, the study page starts it | Follows the PRD lifecycle draft → active and gives S-06 a home for editing. |
| Where the links live | `/studies/[id]`, always visible; minimal dashboard list | The author can copy again later; S-03/S-05 build on the same page. |
| Copy UX | „Kopiuj wszystkie” (one per line) + per-link copy | Covers pasting a whole list and sending one link per person. |
| UI language | Polish for new screens | Matches the PRD messages S-02 must show verbatim. |
| Authors holding tokens | Accept and document | Authors must distribute links; the probe is destructive and visible in `responded`. |
| Write path | `create_study` (invoker) + `start_study` (definer) RPCs | Atomic create; the only privileged transition stays in one locked transaction. |
| Variant cap mechanism | Count 2–6 in `create_study`, re-checked under lock in `start_study` | Position stays a free sort key, so S-06 can reorder and re-add; no draft can start outside 2–6. |
| Vote URL | `<origin>/v/<token>`, recorded in contract-surfaces | S-02 must serve exactly this path. |

## Scope

**In scope:** migration with limits and two RPCs, pgTAP suite, types, contract registry; wizard page and island; create and start endpoints; study page (draft and active views); confirmation before starting; link list with copy; dashboard button and bare list; route protection; production rollout.

**Out of scope:** editing or deleting (S-06), voting page `/v/<token>` (S-02), results and progress (S-03), closing (S-04), full dashboard (S-05), extra links (S-07), images (S-08), hiding tokens, translating existing English pages, app unit/e2e tests.

## Architecture / Approach

The guarantees go in the database first, then the UI. `create_study(title, N, variants[])` runs as the caller, so RLS still applies. `start_study(id)` runs as definer and does everything in one transaction: lock the row, check owner/draft/2–6 variants, insert N links (tokens from the existing 128-bit default), set `active`. Astro pages read through the RLS-scoped server client. Mutations are form POSTs to `src/pages/api/studies/**` that redirect with `?error=`. `StudyWizard`, `StartStudyButton` and `LinkList` are React islands. The limits are mirrored in `src/lib/study-limits.ts`, and the URL is built in `src/lib/study-links.ts`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Database | Limits, `create_study`, `start_study`, pgTAP, types, contract doc | Concurrent starts producing double links (row lock + status check) |
| 2. Wizard and draft page | Create a draft and see it; dashboard entry and list | Server and client validation drifting apart (shared limits module) |
| 3. Start and copy links | Confirmed start, N links, copy all / per link | Clipboard API failures; double submit |
| 4. Production rollout | Migration pushed, app deployed | Pushing app before migration; existing rows violating new checks (none expected) |

**Prerequisites:** F-01 done (it is); local Supabase via Docker; user approval and DB password for `supabase db push`.
**Estimated effort:** ~3–4 sessions across 4 phases.

## Open Risks & Assumptions

- Drafts can't be edited or deleted until S-06, so typos mean creating a new draft.
- Assumes production has no studies, so tightening the checks can't fail. This is checked read-only before the push.
- The `/v/<token>` links lead nowhere until S-02 ships.
- New Polish screens sit next to the English auth pages for now.

## Success Criteria (Summary)

- An author goes from „Nowe badanie” to N copied links in a few minutes, and can copy them again later.
- The database rejects out-of-limit studies and never leaves a study with a partial set of links.
- The pgTAP suite and the app gate are green, and the flow works in production.
