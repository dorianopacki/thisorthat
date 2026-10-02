# Study Loop Data Model — Plan Brief

> Full plan: `context/changes/study-data-model/plan.md`

## What & Why

Roadmap F-01: the first database migration for ThisOrThat — studies, variants, one-time links, votes and comments — with access rules that isolate authors and make votes structurally anonymous. Anonymity and isolation are model constraints; bolting them on later would mean rewriting vote storage and every results query, so they land before any feature slice.

## Starting Point

The database is empty: `supabase/` has only `config.toml`, production project `ykszrmagqyituwiqcsvk` has no tables, and deploy-plan §0.4 defers migrations/RLS to feature work. The app uses only the anon key via `src/lib/supabase.ts`, so participants are the `anon` role. CI already boots a local Supabase stack.

## Desired End State

One migration defines the five tables with RLS and minimal per-role grants, plus `cast_vote` (participant write) and `get_study_results` (author read). pgTAP tests in CI prove an author can't touch another author's data and can't relate any vote or comment to a link. The schema is live in production, ready for S-01.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Vote storage | Detached rows: `votes`/`comments` with random UUIDs, no link ref, no timestamps, no ballot id; link has only boolean `used` | The join is impossible in the model, and comments stay without vote context as the PRD's FR-012 Socrates round decided. |
| Per-link visibility | Author sees tokens but never `used`; progress is aggregate "X of N" | Per-link status plus live results would reveal votes by timing at N≈10–20. |
| Token storage | Plain 128-bit hex token, author-readable | Author can re-copy links anytime (FR-006) without a regenerate flow. |
| F-01 scope | Schema + RLS + `cast_vote` + `get_study_results`; `start_study` stays in S-01 | Both ends of the anonymity contract become testable now without pulling in S-01's risk. |
| Status changes | No column grant on `status`; only definer functions change it | Authors can't bypass draft → active → closed from the API. |
| Unknown / deleted token | `cast_vote` returns `study_ended` | Delete cascades, and FR-010 shows "Badanie jest zakończone" for deleted studies. |
| Ranking | Function returns raw `vote_count`; tie ranking left to S-03 | FR-011 tie-place semantics are presentation, owned by S-03. |
| Verification | pgTAP suites run by `supabase test db` in CI | Guards S-02..S-07 against silently breaking the guarantees; no new npm deps. |
| Rollout | `supabase db push` to production in this change, after approval | Additive and unused by code, so it is safe and unblocks S-01's deploy. |

## Scope

**In scope:**
- Migration: `study_status` enum, `studies`, `variants`, `study_links`, `votes`, `comments`, RLS, grants, `cast_vote`, `get_study_results`
- pgTAP suites (isolation, anonymity, cast_vote, lifecycle) + CI step
- Generated `database.types.ts`, typed `createClient`, `docs/reference/contract-surfaces.md`, AGENTS.md testing note
- Production push + advisors check + deploy-plan §0.4 bookkeeping

**Out of scope:**
- `start_study` / link generation (S-01), participant ballot read (S-02), ranking & Realtime (S-03)
- Closing rules incl. auto-close after N (S-04), extra links (S-07), image storage (S-08)
- Soft delete, N/variant upper bounds, `seed.sql`, any UI or routes

## Architecture / Approach

Authors (`authenticated`) reach `studies`/`variants`/`study_links(token)` through RLS keyed on `author_id = auth.uid()`, after revoking Supabase's default broad grants. Participants (`anon`) touch no table; `cast_vote(token, variant, comments)` atomically flips `study_links.used` with a conditional `UPDATE … WHERE used = false RETURNING` and inserts detached vote/comment rows. Authors read results only through `get_study_results(study)`: JSON with `status`, `responded`, `total`, and per-variant `vote_count` and comments sorted by text, with no row ids or ordering that tracks insertion.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema, policies and functions | One migration applying cleanly and lint-clean | Missing a revoke leaves Supabase's default grants open |
| 2. Tests and contract | pgTAP proof in CI, typed client, contract registry | Role-switching fixtures in pgTAP are new to the repo |
| 3. Production rollout | Schema live in prod, advisors clean | Irreversible without a forward-fix migration — needs approval |

**Prerequisites:** Docker Desktop running for local `supabase start` / `test db`; production DB password for `supabase link` (Phase 3).
**Estimated effort:** ~2 sessions across 3 phases.

## Open Risks & Assumptions

- Out-of-band leaks remain: an author can open their own link to see "already voted", or watch the live count tick right after asking someone to vote. The model can't stop this; it is accepted.
- S-03 must not stream row-level vote/comment inserts via Realtime to the author in a way that brings back timing correlation. It should signal "changed" and refetch `get_study_results`.
- S-02/S-04 may need follow-up migrations to extend `cast_vote`. That's expected, and done forward-only once Phase 3 has run.

## Success Criteria (Summary)

- An author can only ever see and manage their own studies; another author's study looks nonexistent.
- No author-reachable query returns per-link usage, vote/comment rows, or any data tying a vote or comment to a link, and CI fails if that changes.
- One link yields exactly one accepted vote, even under concurrent submissions.
