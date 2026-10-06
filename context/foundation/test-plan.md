# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-10-06

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the
   team is worried about X, and the failure would surface somewhere in
   <area>" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Database guarantees (one vote per link, anonymity, isolation, lifecycle) are proven where they are enforced — in the database, with pgTAP. App tests cover what the database cannot see: route protection, request → screen mapping, and pure presentation logic.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/migrations/`, `supabase/tests/`, `scripts/` (excluding generated `src/lib/database.types.ts` and `worker-configuration.d.ts`).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|-------------------------|--------|------------|--------------------------------|
| 1 | A new author page or endpoint is reachable without signing in, the participant link stops being public, or session cookies behave differently on Workers than locally | High | High | interview Q3 (path authentication); hot-spot dirs `src/pages/api` (10 changes/30d), `src/lib` (11 changes/30d); tech-stack.md (SSR on Cloudflare Workers) |
| 2 | An author reads or changes another author's study, results or links by supplying a foreign id (abuse: IDOR) | High | Medium | PRD NFR (isolation) and Access Control; interview Q1; roadmap S-05, S-06 (new author list/edit/delete surfaces) |
| 3 | One link yields two votes, an accepted vote is lost, or a vote is accepted for a closed or deleted study | High | Medium | PRD Guardrails, US-01 acceptance criteria; interview Q1; roadmap S-04, S-07 (closing and extra links change the vote path) |
| 4 | An author view lets the author tie a vote or comment to a link or person (new field, timestamp, ordering, usage flag) | High | Medium | PRD NFR (anonymity) and Access Control; interview Q1; roadmap S-03 Risk; archive one-time-link-voting plan (participant read must not reveal link usage) |
| 5 | A migration applies locally but breaks production: a load-bearing function contract or grant changes, or database and app ship in the wrong order | High | Medium | interview Q3 (Supabase migrations); hot-spot dirs `supabase/migrations` (5 changes/30d), `supabase/tests` (9 changes/30d); archive one-time-link-voting plan (DB push before app deploy) |
| 6 | The study lifecycle is wrong: voting in a draft, no auto-close after N, a deadline evaluated in the wrong time zone or not at all, extra links in a closed study, editing after start | Medium | High | PRD Business Logic, FR-014–FR-019; roadmap S-04 Unknowns (lazy deadline evaluation), S-06, S-07 |
| 7 | The author sees wrong results: tied variants get wrong places, or „X z N” does not follow added links | Medium | Medium | PRD FR-011, FR-013; archive live-results-and-comments plan (ranking computed in app, no unit test); roadmap S-07 Risk |

Risks #1–#5 are High impact; #1 is protected first. A full provider outage (Supabase, Cloudflare) is High × Low and belongs to observability, not this map.

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | Every author page and endpoint answers „redirect to sign-in” without a session — including encoded and dot-segment variants of the path (e.g. double-encoded `..`), which research confirmed can reach a protected endpoint; every participant route answers without one; a newly added route cannot silently escape the rule | „The smoke test covers `/dashboard`, so protection works”; „the router and the middleware see the same path” | How protection is declared and matched; full list of routes and their intended audience; session/cookie handling in the built Workers output | HTTP integration against the built preview (route × role matrix) | Enumerating today's routes only, with no check that fails when a new unclassified route appears |
| #2 | Author B gets not-found / nothing for every A-owned id on each page, endpoint and RPC, and can change nothing | „RLS covers it, so endpoints need no test” | Which reads go through RLS vs definer functions; how not-owned is reported (404 vs error); fixtures for two authors | pgTAP for RLS/RPC; HTTP integration with two accounts for pages/endpoints | Testing B only against B's own data (happy path) |
| #3 | Exactly one recorded vote per link, including two concurrent submissions and submissions after close or delete; counts match recorded votes | „The voted cookie prevents double votes” | The write path's atomicity; status checks; how close/delete interact with in-flight votes | pgTAP (concurrency via two sessions, status matrix) | Asserting the returned code only, not the recorded row counts |
| #4 | No author-reachable response carries a link reference, a timestamp, insertion order or link usage; the rule holds for every new field | „Current key sets are fine, so new fields will be too” | Every author-reachable read (pages, endpoints, RPCs); which columns exist on vote/comment/link rows | pgTAP on exact key sets and column inventory; HTTP check on endpoint JSON | Snapshotting today's shape with no rule that fails on an added field |
| #5 | A fresh database built only from migrations passes all tests and lint; generated types committed in the repo match the migrations; contract changes ship before the app that needs them | „It applied locally, so production is fine” | Migration workflow, type generation, deploy order, contract registry | CI gate (reset + test + lint + type-drift check) | Checking only that the migration applies |
| #6 | Each lifecycle transition and boundary (the N-th vote, deadline ± 1 minute in the author's zone, extra link after close) yields the right status and the right participant screen | „The stored status is current” (with lazy evaluation it may not be) | Where status is computed vs stored; time-zone handling; screen precedence for participants | pgTAP with a controlled clock; HTTP for the screen | Tests that depend on the real wall clock |
| #7 | Votes 5,5,2,0 give places 1,1,3,4; Polish vote wording is correct at 1/2/5/12/22; „X z N” reflects links added mid-study | „Expected values can be read from the code” (oracle problem) | Where ranking, wording and progress are computed; what N means after added links | Vitest unit (oracle from FR-011 and Polish grammar) | Re-implementing the algorithm inside the test |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|------------|-----------------|---------------|------------|--------|---------------|
| 1 | Access boundaries | Bootstrap the app test runner and prove every route answers correctly for anonymous, owner and foreign author | #1, #2 | Vitest + HTTP integration against preview, pgTAP gaps | researched | `context/changes/testing-access-boundaries/` |
| 2 | Database guarantees and migration safety | Close pgTAP gaps for one vote per link, anonymity and lifecycle, and lock migrations in CI | #3, #4, #5, #6 | pgTAP + CI gate (reset, lint, type drift) | not started | — |
| 3 | Results and screen logic | Prove ranking, wording, progress and participant screen precedence from independent oracles | #7, #6 (app side) | Vitest unit | not started | — |
| 4 | Critical loop and gates | One end-to-end run of create → vote → results at phone width, plus a local post-edit check on migrations | cross-cutting (#1, #3, #4) | Playwright e2e (one flow), post-edit hook, CI gates | not started | — |

Order rationale: #1 is the only High × High risk and needs the app runner that later phases reuse; database guarantees come next because S-04 and S-07 will change the vote path; unit logic is cheap and follows; one e2e flow closes the loop last.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer | Tool | Version | Notes |
|-------|------|---------|-------|
| database (integration) | pgTAP via `supabase test db` | Supabase CLI 2.117 | 5 suites; runs in CI; the main guarantee layer |
| HTTP smoke | `scripts/smoke.mjs` (no dependencies) | n/a | auth + dashboard redirect against the built preview in CI |
| unit + HTTP integration | none yet — see Phase 1 (Vitest via Astro `getViteConfig()`) | — | Astro Container API is still `experimental_`; prefer HTTP against preview for routes |
| e2e | none yet — see Phase 4 (Playwright) | — | one critical flow only |
| (optional) AI-native | post-edit hook running database tests on migration edits — checked: 2026-10-06 | n/a | When NOT to use: edits outside `supabase/`; never as a substitute for the CI gate |

Test-base profile: `sparse` — database layer covered by pgTAP; app code has only the HTTP smoke test.

**Stack grounding tools (current session):**
- Docs: Context7 — Astro testing guide (Vitest via `getViteConfig()`, Container API status); checked: 2026-10-06
- Search: Exa.ai — available, not needed (official docs sufficed); checked: 2026-10-06
- Runtime/browser: Claude in Chrome browser tools — possible manual verification aid, not a test layer; checked: 2026-10-06
- Provider/platform: Supabase MCP (advisors, migration list), GitHub CLI (PR checks) — read-only support for gates; checked: 2026-10-06

## 5. Quality Gates

| Gate | Where | Required? | Catches |
|------|-------|-----------|---------|
| lint + typecheck + build | local + CI (`deploy.yml` verify) | required | syntactic / type drift |
| database tests (pgTAP) | local + CI (`ci.yml` smoke) | required | broken DB guarantees |
| HTTP smoke against preview | CI (`ci.yml` smoke) | required | broken auth / adapter wiring |
| unit + HTTP integration | local + CI | required after §3 Phase 1 | route protection, IDOR, logic regressions |
| migration safety (fresh reset, db lint, type drift) | CI on PR | required after §3 Phase 2 | contract and ordering breaks |
| e2e on the critical loop | CI on PR | required after §3 Phase 4 | broken end-to-end study loop |
| post-edit hook on migrations | local (agent loop) | recommended after §3 Phase 4 | DB regressions at edit time |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase <N>."

### 6.1 Adding a database guarantee test (pgTAP)

- TBD — see §3 Phase 2 for the one-vote / anonymity / lifecycle pattern. Existing suites in `supabase/tests/` show fixtures and role switching today.

### 6.2 Adding a route-access test (new page or endpoint)

- TBD — see §3 Phase 1 for the anonymous / owner / foreign-author matrix pattern.

### 6.3 Adding a unit test for pure logic

- TBD — see §3 Phases 1 and 3 for the independent-oracle pattern (ranking, wording, progress).

### 6.4 Adding or changing a migration

- TBD — see §3 Phase 2 for the reset + test + lint + type-drift routine.

### 6.5 Adding an e2e test

- TBD — see §3 Phase 4; reserved for the full study loop, not per feature.

### 6.6 Per-rollout-phase notes

(Appended by each rollout phase.)

## 7. What We Deliberately Don't Test

- **UI look: snapshots, visual diffs, styling** — changes constantly and catches little. Re-evaluate if a visual regression reaches users twice. (Source: Phase 2 interview Q5.)
- **Load and performance** — closed groups, N ≤ 100, MVP scale. Re-evaluate if target scale grows (PRD Open Question 1). (Source: Phase 2 interview Q5.)
- **Starter auth pages beyond the smoke test** — covered end-to-end by the existing HTTP smoke; re-evaluate if password reset or new auth flows are added.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-10-06
- Stack versions last verified: 2026-10-06
- AI-native tool references last verified: 2026-10-06

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
