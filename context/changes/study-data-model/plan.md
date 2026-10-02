# Study Loop Data Model Implementation Plan

## Overview

Roadmap item **F-01** (`study-data-model`, issue #5). Introduce the first Supabase migration: the smallest schema that carries one study loop (study → variant → one-time link → vote → comment), row-level security that isolates authors from each other, and a vote-storage shape in which no author-reachable query can relate a vote or comment to the link that produced it. Two SECURITY DEFINER functions fix both ends of the anonymity contract — `cast_vote` (participant write path) and `get_study_results` (author read path) — and pgTAP tests in CI prove the guarantees. The migration is pushed to the production Supabase project at the end.

## Current State Analysis

- `supabase/` holds only `config.toml`; there is no `supabase/migrations/` and no domain schema (roadmap Baseline; `context/deployment/deploy-plan.md:53`). `config.toml:65` references a `seed.sql` that does not exist (harmless warning; not touched here).
- The production project `ykszrmagqyituwiqcsvk` (eu-west-1) has no `public` tables either; deploy-plan §0.4 defers "migrations applied", "RLS on every table" and "Realtime" items to feature work (`deploy-plan.md:53-55`).
- The app reaches Supabase only via `createServerClient` with the publishable/anon key (`src/lib/supabase.ts:5-23`); no service_role key exists anywhere. Therefore unauthenticated participants act as Postgres role `anon`, authors as `authenticated` with `auth.uid()` = their user id. Every participant path must be a narrowly scoped function — `anon` gets no table access.
- CI already boots a local Supabase stack in `.github/workflows/ci.yml` (`supabase start -x …`), which applies `supabase/migrations/` automatically — a ready host for database tests. There is no other test suite (`AGENTS.md` §Testing).
- Docker is installed locally but the daemon was not running at planning time; local `supabase start` / `supabase test db` require Docker Desktop to be started.
- No `context/foundation/lessons.md` and no `docs/reference/contract-surfaces.md` exist yet.

## Desired End State

- `supabase/migrations/<timestamp>_study_data_model.sql` creates enum `study_status` and tables `studies`, `variants`, `study_links`, `votes`, `comments`, with RLS enabled on all of them, explicit per-role grants, and functions `cast_vote` and `get_study_results`.
- Author A can create and manage their own draft studies and variants, read their own link tokens, and read aggregated results of their own studies — and nothing belonging to author B.
- No author-reachable surface exposes: per-link `used` state, vote rows, comment rows, row ids of votes/comments, or any timestamp/ordering correlated with voting.
- A participant (`anon`) can cast exactly one vote per link into an active study, with optional per-variant comments; concurrent submissions with the same token yield exactly one accepted vote.
- `supabase test db` passes locally and in CI, covering isolation, anonymity, the voting path and the status-change rule.
- The same migration is applied to production and Supabase security advisors report no RLS errors for these tables.

Verification: `npx supabase db reset` + `npx supabase test db` locally, CI green on the PR, `npx supabase migration list` showing local = remote after Phase 3.

### Key Discoveries:

- Participants are `anon`, not a service role — `src/lib/supabase.ts:13` uses `SUPABASE_KEY` documented as publishable/anon in `.env.example`.
- CI's smoke job already runs `supabase start` before the build (`.github/workflows/ci.yml`, step "Start local Supabase") — adding `supabase test db` there costs one step.
- PRD FR-012 Socrates resolution keeps comments detached from the commenter's vote ("komentarz bez kontekstu, na co głosował autor komentarza" — kept as written), so comments carry no ballot id.
- `infrastructure.md:79,91`: rollback does not revert migrations — ship additive migrations and forward-fix; schema-destructive migrations need human approval.
- `tech-stack.md`: no background jobs; deadline closing (S-04) is lazy — not part of this schema.

## What We're NOT Doing

- **`start_study` / link generation** (draft → active, N tokens in one transaction) — S-01 owns it and its upper bounds for N and variant count.
- **Participant ballot read** (`get_ballot(token)` to render variants) — S-02.
- **Ranking presentation** — `get_study_results` returns raw `vote_count`; how ties map to places (FR-011, e.g. 1-1-3 vs 1-1-2) is decided in S-03.
- **Realtime publication** for live results — S-03 (it must not subscribe to row-level vote/comment inserts in a way that reintroduces timing correlation; see Open Risks in the brief).
- **Auto-close after the last link (FR-014), manual close (FR-015), deadline (FR-016)** — S-04; it will extend `cast_vote` and add a close function and deadline column.
- **Extra links (FR-019)** — S-07. **Image variants / storage bucket** — S-08.
- **Per-link "used" visibility for authors** — deliberately never exposed (decision: aggregate only).
- **Soft delete** — deleting a study cascades; an unknown token is reported as "study ended", which satisfies FR-010 for deleted studies.
- **Upper bounds** on `participant_target` / variant count — S-01. Only sanity checks (`> 0`, non-empty text, max lengths) here.
- **`seed.sql`**, app routes, UI, middleware changes.

## Implementation Approach

Make anonymity a property of the **model**, not of the queries: vote and comment rows carry no reference to a link, no timestamps, no sequential ids and no ballot grouping; the link only records a boolean `used`. The single transition that touches both sides is a SECURITY DEFINER function, so no role ever writes votes directly. Authors never SELECT `votes`, `comments` or `study_links.used`; their only results surface is `get_study_results`, which returns aggregates and comments sorted by text (never by physical/insertion order). Isolation is enforced by RLS keyed on `studies.author_id = auth.uid()` plus revoke-all-then-grant-minimum per role, so Supabase's default broad grants to `anon`/`authenticated` do not leak access. Status changes are function-only, so the `draft → active → closed` lifecycle cannot be bypassed from the API.

## Critical Implementation Details

**Default privileges.** Supabase grants ALL on new `public` tables to `anon` and `authenticated` by default. RLS alone would still let `authenticated` read any *column* RLS allows on visible rows, so the migration must `revoke all … from anon, authenticated` on every new table and then grant only the listed table/column privileges. Function `EXECUTE` is granted to `public` by default — revoke from `public` and grant explicitly.

**Concurrency of `cast_vote`.** The one-vote guarantee must come from a single conditional `UPDATE … WHERE used = false … RETURNING`, not a read-then-write. Under READ COMMITTED a second concurrent call blocks on the row lock, re-evaluates `used = false` after the first commits, matches zero rows, and returns `link_used`.

**SECURITY DEFINER hygiene.** Every definer function sets `search_path = ''` and schema-qualifies all names (`public.…`, `extensions.gen_random_bytes`), otherwise `supabase db lint` / advisors flag it and it is hijackable.

## Phase 1: Schema, policies and functions

### Overview

One migration that creates the model, locks down access per role, and adds the two contract functions. Verified by a clean reset and lint.

### Changes Required:

#### 1. Migration file

**File**: `supabase/migrations/<timestamp>_study_data_model.sql` (create with `npx supabase migration new study_data_model`)

**Intent**: Create the study-loop schema with integrity constraints that make cross-study references impossible and keep vote/comment rows free of any link-correlating data.

**Contract**:
- `create type public.study_status as enum ('draft', 'active', 'closed')`.
- `studies`: `id uuid pk default gen_random_uuid()`, `author_id uuid not null default auth.uid() references auth.users(id) on delete cascade`, `title text not null` (trimmed length 1–200), `participant_target integer not null check (> 0)`, `status study_status not null default 'draft'`, `created_at`/`updated_at timestamptz not null default now()` (author's own metadata — not vote-correlated). Index on `author_id`.
- `variants`: `id uuid pk`, `study_id uuid not null references studies on delete cascade`, `position smallint not null check (>= 0)`, `content text not null` (trimmed length 1–2000), `unique (study_id, position)`, `unique (id, study_id)` (target for composite FKs).
- `study_links`: `id uuid pk`, `study_id uuid not null references studies on delete cascade`, `token text not null unique default encode(extensions.gen_random_bytes(16), 'hex')` (128-bit), `used boolean not null default false`. **No timestamp columns.** Index on `study_id`.
- `votes`: `id uuid pk default gen_random_uuid()`, `study_id uuid not null`, `variant_id uuid not null`, composite FK `(variant_id, study_id) references variants (id, study_id) on delete cascade`. **No link reference, no timestamps, no ballot id.** Index on `(study_id, variant_id)`.
- `comments`: same shape as `votes` plus `body text not null` (trimmed length 1–2000). **No link reference, no timestamps, no ballot id.**

#### 2. Grants and RLS (same migration)

**Intent**: Isolate authors from each other, keep participants off all tables, and stop authors from seeing per-link usage or individual vote/comment rows.

**Contract** (after `revoke all on <table> from anon, authenticated` for every table; `alter table … enable row level security` on every table):

| Table | `authenticated` privileges | RLS policy (authenticated) | `anon` |
| --- | --- | --- | --- |
| `studies` | `select`, `insert (title, participant_target)`, `update (title, participant_target)`, `delete` | select/delete: `author_id = auth.uid()`; insert check: `author_id = auth.uid()`; update: own **and** `status = 'draft'` (using + with check) | none |
| `variants` | `select`, `insert (study_id, position, content)`, `update (position, content)`, `delete` | select: parent study owned; insert/update/delete: parent study owned **and** `status = 'draft'` | none |
| `study_links` | `select (id, study_id, token)` only — **not `used`** | select: parent study owned | none |
| `votes` | none | none (RLS on, no policy) | none |
| `comments` | none | none (RLS on, no policy) | none |

- `status` is not in any column grant → only definer functions (S-01 start, S-04 close) change it.
- An `updated_at` trigger on `studies` (plain `before update` trigger, not definer).

#### 3. `cast_vote` function (same migration)

**Intent**: The only write path for votes and comments; atomically consumes a link and inserts detached rows, reporting the outcomes FR-010 needs.

**Contract** — signature other slices depend on:

```sql
public.cast_vote(p_token text, p_variant_id uuid, p_comments jsonb default '[]'::jsonb)
  returns text   -- 'accepted' | 'link_used' | 'study_ended'
  language plpgsql security definer set search_path = ''
-- grant execute to anon, authenticated; revoke from public
```

- Consume step: `update public.study_links l set used = true from public.studies s where l.token = p_token and l.used = false and s.id = l.study_id and s.status = 'active' returning l.study_id`.
- No row consumed → if a link with that token exists, is `used` and its study is `active` → `'link_used'`; every other case (unknown token, deleted study, `closed` study, `draft` study) → `'study_ended'`. (Used link in a closed study → `'study_ended'`, matching FR-010's priority of the study-ended message.)
- `p_variant_id` must belong to the consumed link's study, else `raise exception` (rolls back the consume — client bug, not a user outcome).
- `p_comments` is a JSON array of `{ "variant_id": uuid, "body": text }`; entries with blank trimmed body are skipped; each `variant_id` must belong to the study and appear at most once, else `raise exception`. Bodies are stored trimmed.
- Inserts exactly one `votes` row and 0..n `comments` rows; returns `'accepted'`.

#### 4. `get_study_results` function (same migration)

**Intent**: The only author read path over votes/comments; returns aggregates with no row identity or ordering that could correlate with voting.

**Contract**:

```sql
public.get_study_results(p_study_id uuid) returns jsonb
  language sql stable security definer set search_path = ''
-- grant execute to authenticated only; revoke from public, anon
```

- Returns `null` unless `studies.id = p_study_id and author_id = auth.uid()` (another author's study is indistinguishable from a non-existent one).
- Shape: `{ "status": study_status, "responded": int /* used links */, "total": int /* all links */, "variants": [ { "variant_id": uuid, "position": int, "content": text, "vote_count": int, "comments": [text, …] } ] }`.
- `variants` ordered by `position`; each `comments` array ordered by `body` (collation order) — never by insertion/physical order. No vote ids, comment ids, link ids or tokens in the output.

### Success Criteria:

#### Automated Verification:

- Migration applies on a fresh local database: `npx supabase db reset`
- Database lint reports no errors: `npx supabase db lint`
- App gate still passes: `npm run lint`, `npx astro check`, `npm run build`

#### Manual Verification:

- In local Studio the five tables show RLS enabled and `votes`/`comments` have no link or timestamp columns (Studio: http://127.0.0.1:54323)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Tests and contract

### Overview

pgTAP suites that prove isolation and anonymity, wired into CI; typed client and a registry of the new load-bearing names.

### Changes Required:

#### 1. pgTAP test suites

**File**: `supabase/tests/study_isolation.test.sql`, `supabase/tests/study_anonymity.test.sql`, `supabase/tests/cast_vote.test.sql`

**Intent**: Executable proof of the guarantees, run as each real role, so later slices cannot silently break them.

**Contract**: Each file is `begin; create extension if not exists pgtap with schema extensions; select plan(n); … select * from finish(); rollback;`. Fixtures are inserted as the test superuser (two `auth.users` rows for authors A and B; an `active` study for A with links, since `start_study` does not exist yet). Role switching: `set local role authenticated` + `select set_config('request.jwt.claims', json_build_object('sub', <uuid>, 'role', 'authenticated')::text, true)`; `set local role anon` for participants. Required cases:

- **Isolation**: B sees 0 of A's studies/variants/links; B cannot insert a variant into A's study; B's update/delete of A's study affects 0 rows; `get_study_results(A's study)` as B returns `null`; `anon` gets permission denied on every table and on `get_study_results`.
- **Anonymity**: `votes` and `comments` have no column whose FK targets `study_links` and no `timestamp`/`timestamptz` column, and no serial/identity default (catalog checks); A gets permission denied selecting `votes`, `comments`, and `study_links.used`; A can select `study_links (id, study_id, token)`; `get_study_results` top-level keys are exactly `status, responded, total, variants`, per-variant keys exactly `variant_id, position, content, vote_count, comments`; comments inserted in non-alphabetical order come back sorted by body.
- **cast_vote**: valid token → `accepted`, `responded` goes 0→1, vote counted; same token again → `link_used`, counts unchanged; unknown token → `study_ended`; token of a `closed` study → `study_ended`; variant of another study → exception and the link remains unused; blank comment bodies are skipped; duplicate comment `variant_id` → exception.
- **Lifecycle**: A cannot update `studies.status` (permission denied); A cannot update title or variants once the study is `active` (0 rows); A can delete an `active` study and its links/votes/comments cascade.

#### 2. CI step

**File**: `.github/workflows/ci.yml`

**Intent**: Run database tests on every push/PR to `main` using the Supabase stack the smoke job already starts.

**Contract**: New step `- run: supabase test db` immediately after "Start local Supabase", before the build.

#### 3. Generated types and typed client

**File**: `src/lib/database.types.ts` (generated), `src/lib/supabase.ts`

**Intent**: Give S-01..S-03 typed tables and RPCs instead of `any`.

**Contract**: Generate with `npx supabase gen types typescript --local > src/lib/database.types.ts`; `createServerClient<Database>(…)` in `createClient`. File must pass `npm run lint` (add an ESLint ignore for the generated file only if needed).

#### 4. Contract registry and agent docs

**File**: `docs/reference/contract-surfaces.md` (new), `AGENTS.md`

**Intent**: Record the load-bearing names later slices must not rename, and stop AGENTS.md claiming there is no test suite.

**Contract**: `contract-surfaces.md` lists tables/columns, enum values, `cast_vote` signature + return codes, `get_study_results` JSON shape, and the rule "authors never read `votes`, `comments`, `study_links.used`". `AGENTS.md` §Testing and §Commands mention `npx supabase test db` (Docker required) and the migration workflow (`npx supabase migration new`, forward-fix only).

### Success Criteria:

#### Automated Verification:

- All database tests pass locally: `npx supabase test db`
- App gate passes with typed client: `npm run lint`, `npx astro check`, `npm run build`
- CI workflow runs `supabase test db` green on the PR

#### Manual Verification:

- Temporarily adding a `created_at` column to `votes` in a scratch migration makes the anonymity suite fail — then discard the scratch migration

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Production rollout

### Overview

Apply the migration to the production project once tests are green, check advisors, and close the deferred deploy-plan items this change satisfies.

### Changes Required:

#### 1. Push migration to production

**File**: none (operational)

**Intent**: Make the schema available before S-01 ships, as `deploy-plan.md:53` requires.

**Contract**: 👤 user runs `npx supabase link --project-ref ykszrmagqyituwiqcsvk` (needs DB password) and `npx supabase db push`, after explicit approval. Do **not** apply via MCP `apply_migration` — it records a different migration version and causes local/remote drift. Afterwards check security advisors (MCP `get_advisors` type `security`, read-only).

#### 2. Deploy plan bookkeeping

**File**: `context/deployment/deploy-plan.md`

**Intent**: Reflect that migrations and RLS are now in place.

**Contract**: §0.4 tick "schema and migrations applied" and "RLS enabled on every table" with date and a note; Realtime and Storage items stay deferred to S-03 / S-08.

### Success Criteria:

#### Automated Verification:

- Local and remote migrations are in sync: `npx supabase migration list`
- Security advisors report no errors for `studies`, `variants`, `study_links`, `votes`, `comments`

#### Manual Verification:

- User approves the production push before it runs
- Production site still serves `/` and signin after the push (no app change expected)

**Implementation Note**: The push is irreversible without a forward-fix migration; do not run it without explicit approval.

---

## Testing Strategy

### Unit Tests:

- None at the TypeScript level — this change adds no app logic.

### Integration Tests:

- pgTAP suites in `supabase/tests/` (Phase 2), executed as `anon`, author A and author B against the real migration in a local Supabase stack, locally and in CI.

### Manual Testing Steps:

1. `npx supabase db reset`, open Studio, confirm RLS badges and column lists.
2. Run the scratch-column mutation check from Phase 2 to confirm the anonymity suite actually bites.
3. After the prod push, `npx supabase migration list` and a quick look at advisors.

## Performance Considerations

MVP scale is tens to ~100 participants per study (PRD Open Questions 1). Indexes on `studies.author_id`, `study_links.study_id`, `votes (study_id, variant_id)`, `comments (study_id, variant_id)` keep `get_study_results` a single round trip (relevant to the 10 ms Workers CPU budget, `infrastructure.md:58,88`). `cast_vote` touches one indexed row by unique `token`.

## Migration Notes

Purely additive — no existing data or tables. Rollback of app code (`wrangler rollback`) does not affect it; any later correction is a new forward migration (`infrastructure.md:79,91`). Once pushed to production (Phase 3), this file must not be edited.

## References

- Roadmap item: `context/foundation/roadmap.md` — F-01
- PRD: `context/foundation/prd.md` — NFR (anonimowość, izolacja), Access Control, Business Logic, FR-010, FR-012
- Server client: `src/lib/supabase.ts:5-23`
- CI Supabase stack: `.github/workflows/ci.yml`
- Deferred DB items: `context/deployment/deploy-plan.md:53-55`
- Rollback constraints: `context/foundation/infrastructure.md:79,91`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema, policies and functions

#### Automated

- [x] 1.1 Migration applies on a fresh local database: `npx supabase db reset` — 8ea1525
- [x] 1.2 Database lint reports no errors: `npx supabase db lint` — 8ea1525
- [x] 1.3 App gate still passes: `npm run lint`, `npx astro check`, `npm run build` — 8ea1525

#### Manual

- [x] 1.4 In local Studio the five tables show RLS enabled and `votes`/`comments` have no link or timestamp columns — 8ea1525

### Phase 2: Tests and contract

#### Automated

- [x] 2.1 All database tests pass locally: `npx supabase test db`
- [x] 2.2 App gate passes with typed client: `npm run lint`, `npx astro check`, `npm run build`
- [ ] 2.3 CI workflow runs `supabase test db` green on the PR

#### Manual

- [x] 2.4 Temporarily adding a `created_at` column to `votes` in a scratch migration makes the anonymity suite fail

### Phase 3: Production rollout

#### Automated

- [ ] 3.1 Local and remote migrations are in sync: `npx supabase migration list`
- [ ] 3.2 Security advisors report no errors for `studies`, `variants`, `study_links`, `votes`, `comments`

#### Manual

- [ ] 3.3 User approves the production push before it runs
- [ ] 3.4 Production site still serves `/` and signin after the push
