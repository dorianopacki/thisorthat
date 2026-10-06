# Test Rollout Phase 1 — Access Boundaries — Plan Brief

> Full plan: `context/changes/testing-access-boundaries/plan.md`
> Research: `context/changes/testing-access-boundaries/research.md`

## What & Why

This phase bootstraps the app's test runner and proves the two highest risks in `context/foundation/test-plan.md`:
- **#1:** an author route is reachable without signing in, or the participant link stops being public;
- **#2:** author B reads or changes author A's study by supplying A's id.

Research confirmed a real gap: a double-encoded `..` in the path lets an anonymous request reach a protected endpoint. Today nothing fails when a new route is added without protection.

## Starting Point

- **Route protection:** a three-entry path-prefix list in `src/middleware.ts`, compared against the normalized pathname. The router matches a different string, which is the source of the bypass.
- **Ownership:** enforced only in the database (RLS, grants, owner checks inside the functions). pgTAP covers the main reads but not several write and function paths.
- **App tests:** none beyond an 8-step HTTP smoke script. CI already runs Supabase and the built preview.

## Desired End State

- One route-audience map declares every page as `author`, `participant` or `public`.
- The middleware enforces that map by the route the router actually matched, which closes the bypass.
- A unit test fails when a page is unclassified.
- An HTTP suite against the built Workers preview proves:
  - every author route redirects anonymous users, including encoded paths;
  - participant links stay public;
  - author B gets "not found" for every A-owned id and changes nothing.
- A new pgTAP suite closes the database gaps, and CI runs all of it.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Encoded-`..` bypass | Fix in this change via `context.routePattern` | Classifying by the matched route closes the whole normalization class instead of chasing encodings | Research → Plan |
| "New route can't escape" | Shared route-audience map in `src/lib/route-access.ts`, used by middleware and tests | The list the test checks is the list production enforces | Plan |
| Unknown route patterns | Treated as public (no default-deny) | Default-deny would gate 404s/internals; the unit test guards `src/pages/**` instead | Plan |
| Test runner | Vitest with a plain Node config (no `getViteConfig`) | Matches the test plan and avoids the unverified Cloudflare-plugin-in-Vitest path | Research → Plan |
| HTTP fixtures | Two authors via the app's own signup/signin/create endpoints | No service key or seed file; exercises the real Workers session path | Research |
| pgTAP scope | Full research §3 gap list, including "B owns a study" | Proves "RLS covers it" rather than assuming it | Plan |
| CI | Extra steps in the existing `smoke` job | Reuses its Supabase + preview; meets the §5 gate "required after Phase 1" | Plan |

## Scope

**In scope:** Vitest bootstrap, route-audience map, middleware fix, classification unit test, anonymous HTTP matrix (with path variants, participant reachability, cookie attributes), two-author HTTP suite, pgTAP gap suite, CI steps, docs and test-plan §6.2/§6.6/§4.

**Out of scope:** Playwright/e2e, browser cookie behaviour, default-deny middleware, pure-logic unit tests (Phase 3), vote/anonymity/lifecycle pgTAP (Phase 2), schema changes, production edge verification, changes to `scripts/smoke.mjs`.

## Architecture / Approach

`ROUTE_AUDIENCE` (pattern → audience) is the single source:
- the middleware calls `requiresAuthor(context.routePattern)`;
- the unit test diffs the map against `src/pages/**`;
- the HTTP suite generates its anonymous matrix from the map.

The isolation proof has two layers: pgTAP for the database boundary itself, and HTTP for how the app translates "not owned" into a 404 page, a JSON 404, or a redirect to the 404.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Runner, map, middleware fix | Vitest, `route-access.ts`, routePattern middleware, classification test | Middleware regression for legitimate paths. Mitigated by the existing smoke run and manual signed-in checks |
| 2. HTTP route × role matrix | Anonymous matrix from the map, encoded variants, public participant link, cookie attributes | Node `fetch` normalizes raw `..`; only encoded variants are meaningful |
| 3. Two-author isolation over HTTP | B vs A on every id-taking author route; dashboard lists only own; A controls | Fixture creation through the app's forms depends on `Origin` and the form shape |
| 4. pgTAP isolation gaps | `author_isolation_gaps.test.sql` covering research §3 | Plan count drift; fixture id collisions with other suites |
| 5. CI wiring and docs | Suites in the CI `smoke` job; AGENTS/README/contract docs; test-plan cookbook §6.2 | CI job time grows (expected under a minute) |

**Prerequisites:** local Supabase (Docker) running; `.env`/`.dev.vars` configured; built preview for phases 2–3.
**Estimated effort:** ~2–3 sessions across 5 phases.

## Open Risks & Assumptions

- Assumes `context.routePattern` is populated for API routes in both the dev and built handlers. The phase 1 manual probes on `dev` and `preview` verify this.
- Whether Cloudflare's production edge normalizes `%25` stays unverified; after the fix it no longer matters for protection.
- Signup followed by explicit signin is assumed to yield a session cookie, as the smoke script already does.

## Success Criteria (Summary)

- The research bypass probes answer 302 → `/auth/signin`, and a test fails if that regresses.
- Adding a page without classifying it fails `npm run test:unit` in CI.
- Author B cannot see or change any A-owned study through any page, endpoint or RPC, and both the HTTP and pgTAP suites prove it on every PR.
