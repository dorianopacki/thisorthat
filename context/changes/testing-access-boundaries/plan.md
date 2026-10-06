# Test Rollout Phase 1 — Access Boundaries Implementation Plan

## Overview

Bootstrap the app test runner (Vitest) and prove test-plan risks #1 (route protection) and #2 (author isolation / IDOR). Route protection moves from a path-string prefix list to a single route-audience map that the middleware looks up by the route the router actually matched (`context.routePattern`). This closes the confirmed double-encoded `..` bypass by design. A filesystem test fails when a new page is not classified. An HTTP suite against the built preview proves the anonymous and two-author matrices, and a new pgTAP suite closes the database isolation gaps research listed.

## Current State Analysis

- Protection is `PROTECTED_ROUTES = ["/dashboard", "/studies", "/api/studies"]` matched against `context.url.pathname` (`src/middleware.ts:4,19`), answering 302 → `/auth/signin` (`:21`).
- **Confirmed bypass** (research Summary §1, reproduced on `astro dev` and `astro preview`): the router matches the decoded `/api/studies/../start` (id = `..`) while the middleware reads the URL-normalized `/api/start`. Unauthenticated `GET /api/studies/%252e%252e/results` → 500 (handler ran) and `POST /api/studies/%252e%252e/start` → 302 with an `?error=` (handler ran). No data was exposed, because the RPCs are `authenticated`-only.
- Nothing fails when a route is added without classification. The only rule is prose (`AGENTS.md:17`, `README.md:150`).
- Ownership is enforced only in the database: RLS, column grants, and `author_id = auth.uid()` checks inside the definer functions. The app translates "not owned" into a 404 page (`src/pages/studies/[id].astro:79-82`), a JSON 404 (`src/pages/api/studies/[id]/results.ts:18-22`), or a redirect to the 404 page (`src/pages/api/studies/[id]/start.ts:23`).
- pgTAP covers the main B-vs-A reads (`supabase/tests/study_isolation.test.sql:45-83`, `create_and_start_study.test.sql:278-306`) with specific gaps (research §3).
- No app test runner exists: `package.json` has no vitest/jest/playwright. `scripts/smoke.mjs` is the only HTTP check (8 steps, auth + `/dashboard`). CI's `smoke` job already provides local Supabase, `.env`/`.dev.vars` and the built preview on :4321 (`.github/workflows/ci.yml:14-43`).

## Desired End State

- `src/lib/route-access.ts` declares every route pattern under `src/pages/**` as `author`, `participant` or `public`. The middleware protects exactly the `author` patterns, looked up by `context.routePattern`.
- `npm run test:unit` fails if a file under `src/pages/**` has no entry in the map, or if an entry has no file behind it.
- `npm run test:http` (with `BASE_URL`) proves against the built preview:
  - Every author route answers 302 → `/auth/signin` without a session, including encoded, dot-segment and trailing-slash variants. No encoded variant ever runs a handler.
  - Participant and public routes work without a session.
  - Session cookies carry the expected attributes in the Workers build.
  - Author B gets the not-found translation for each of author A's study ids on every author page and endpoint, and changes nothing.
- `npx supabase test db` includes `author_isolation_gaps.test.sql`, covering every gap in research §3.
- CI's `smoke` job runs both suites. The docs and the test-plan cookbook (§6.2, §6.6, §4) describe how to add a route test.

### Key Discoveries:

- `context.routePattern` is part of Astro 7's `APIContext`, which is available in middleware. Its value is the matched route stripped of `src/pages` and the extension, e.g. `/studies/[id]` (`node_modules/astro/dist/types/public/context.d.ts:572-583`). Because it comes from the router's match, it is immune to the pathname-normalization gap.
- The HTTP pattern to reuse is `scripts/smoke.mjs:7-37`: a cookie jar, `redirect: "manual"`, an `Origin` header (required by `checkOrigin` for form posts) and a unique email per run.
- Signup works without email confirmation locally (`supabase/config.toml:204,209`), and the smoke script signs in explicitly after signup. Follow the same sequence.
- `POST /api/studies` accepts the form fields `title`, `participant_target` and a repeated `variant` (`src/pages/api/studies/index.ts:47-53`), and redirects to `/studies/<id>` (`:73`).
- `get_study_results` returns `status` for the owner (`supabase/migrations/20261002095727_study_data_model.sql:352-353`). Use it to prove A's draft is still `draft` after B's start attempt.
- `@types/node` is installed only transitively. Add it explicitly for the filesystem test.
- `checkOrigin: true` is the default (research §1). Every POST in tests must send `Origin: BASE_URL`.

## What We're NOT Doing

- No e2e or browser tests (Playwright is test-plan Phase 4), and no browser-level cookie checks. Cookie attributes are asserted on `Set-Cookie` headers only.
- No default-deny middleware. Unknown route patterns (Astro internals such as `/_image`, unmatched 404s) are treated as public. The unit classification test is the guard for `src/pages/**`.
- No `getViteConfig()` / Cloudflare vite plugin in Vitest. The plain Node config is a deliberate choice.
- No unit tests of pure modules (ranking, wording, progress belong to test-plan Phase 3).
- No pgTAP for votes/anonymity/lifecycle guarantees (test-plan Phase 2).
- No production-edge verification of `%25` normalization on Cloudflare (research Open Question). The fix makes it irrelevant.
- No new schema, migrations or RLS changes. This change only adds tests over the database boundary.
- No hooks, MCP setup or new CI jobs. Only one step is added to the existing `smoke` job.
- No changes to `scripts/smoke.mjs`. It stays as the auth smoke test.

## Implementation Approach

Fix the classification first (phase 1), so every later test asserts the intended behaviour and lands green. The HTTP suite iterates the route-audience map instead of a hand-written list. A route added and classified later is therefore probed automatically, and an unclassified one fails the unit test before it reaches HTTP. The two-author suite creates its fixtures through the app's own endpoints, with no service key and no seed file, so it also exercises the session path on the Workers build. pgTAP covers the boundary itself (phase 4); HTTP covers its translation to 404 / JSON 404 / redirect (phase 3).

## Critical Implementation Details

- **Probe before and after.** Before switching the middleware, run the research probes (`/api/studies/%252e%252e/results`, `POST /api/studies/%252e%252e/start`) against the preview and confirm they still misbehave. After the switch, the same probes must answer 302 → `/auth/signin`. The HTTP suite encodes the "after" state.
- **Node `fetch` normalizes raw `..` segments client-side.** Encoded variants (`%2e%2e`, `%252e%252e`, mixed case `%2E%2e`) are the ones that reach the server. A raw `..` probe tests the client, not the app.
- **Expected answer for path variants:** either 302 with `Location` exactly `/auth/signin`, or 404 (no route matched). A 2xx, a 5xx, or a redirect anywhere else means a handler ran without a session, and the test fails.

## Phase 1: Runner, route-audience map and middleware fix

### Overview

Install Vitest. Introduce the single route-audience map and make the middleware read it by `context.routePattern`. Add the filesystem classification test.

### Changes Required:

#### 1. Test runner

**File**: `package.json`, `vitest.config.ts` (new)

**Intent**: Add Vitest and `@types/node` as devDependencies, plus a plain Node-environment config with two projects: `unit` (no server) and `http` (requires `BASE_URL`). Each project gets its own npm script.

**Contract**: Scripts `test:unit` → the `unit` project (`tests/unit/**/*.test.ts`) and `test:http` → the `http` project (`tests/http/**/*.test.ts`). The `@/*` alias resolves to `./src/*`. The `http` project runs files sequentially, and its setup fails fast with a clear message when `BASE_URL` is unset. No `getViteConfig`.

#### 2. Lint and type-check coverage for tests

**File**: `eslint.config.js`

**Intent**: Test files stay under `strictTypeChecked`. Add a small block for `tests/**/*.ts` only if a rule genuinely conflicts (e.g. `no-console` is already a warning). Prefer explicit `import { describe, it, expect } from "vitest"` over globals.

**Contract**: `npm run lint` and `npx astro check` pass with the new files. Make no rule relaxations beyond what the tests need, and comment each one.

#### 3. Route-audience map

**File**: `src/lib/route-access.ts` (new)

**Intent**: One declarative map from route pattern to audience. It is the single source of truth that both the middleware and the tests read.

**Contract**: `export type RouteAudience = "author" | "participant" | "public"`. `export const ROUTE_AUDIENCE: Readonly<Record<string, RouteAudience>>`, keyed by Astro route pattern, with all 15 routes from research §1:

- author: `/dashboard`, `/studies/new`, `/studies/[id]`, `/api/studies`, `/api/studies/[id]/start`, `/api/studies/[id]/results`
- participant: `/v/[token]`, `/api/v/[token]`
- public: `/`, `/auth/signin`, `/auth/signup`, `/auth/confirm-email`, `/api/auth/signin`, `/api/auth/signup`, `/api/auth/signout`

Also export `requiresAuthor(routePattern: string): boolean`, which returns `true` only for `author` entries; unknown patterns return `false`. A one-line header comment states the rule: every new file under `src/pages/` needs an entry, and the unit test enforces it.

#### 4. Middleware

**File**: `src/middleware.ts`

**Intent**: Replace `PROTECTED_ROUTES` and the pathname prefix check with `requiresAuthor(context.routePattern)`. The `getUser()` call and the 302 → `/auth/signin` response stay unchanged.

**Contract**: The redirect target and status are unchanged. `locals.user` is still set on every request. `context.url.pathname` is no longer read for protection.

#### 5. Classification test

**File**: `tests/unit/route-access.test.ts` (new)

**Intent**: Walk `src/pages/**` and derive each file's route pattern:
- strip `src/pages` and the extension (`.astro`, `.ts`);
- `index` maps to its parent path (`/api/studies/index.ts` → `/api/studies`, `/index.astro` → `/`).

The test fails if any derived pattern is missing from `ROUTE_AUDIENCE` (an unclassified new route), or if any map key has no file (a stale entry). Separate cases assert `requiresAuthor` for an author, a participant, a public and an unknown pattern.

**Contract**: The failure message names the unclassified file and points to `src/lib/route-access.ts`.

### Success Criteria:

#### Automated Verification:

- Unit suite passes: `npm run test:unit`
- Adding a throwaway `src/pages/zz-probe.astro` makes `npm run test:unit` fail with the file named (then remove it)
- Linting passes: `npm run lint`
- Type check passes: `npx astro check`
- Build passes: `npm run build`
- Existing smoke still passes against the preview: `npm run smoke`

#### Manual Verification:

- Against `npm run preview`, unauthenticated `GET /api/studies/%252e%252e/results` and `POST /api/studies/%252e%252e/start` (with `Origin`) now answer 302 → `/auth/signin` (they answered 500 / 302-with-error before the change)
- The same two probes answer 302 → `/auth/signin` under `npm run dev`
- Signed in, `/dashboard`, `/studies/new` and an own `/studies/<id>` still render

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: HTTP route × role matrix (risk #1)

### Overview

Add the anonymous matrix against the built preview. It is generated from `ROUTE_AUDIENCE`, so new classified routes are probed without editing the test.

### Changes Required:

#### 1. HTTP helpers

**File**: `tests/http/client.ts` (new)

**Intent**: Port the smoke script's client into a typed helper, with one independent cookie jar per client so the tests can hold several identities. Add sign-up / sign-in helpers that create a unique account per run.

**Contract**: The client exposes `request(path, { method?, form? })`, which returns `{ status, location, body, setCookies }` with `redirect: "manual"` and `Origin: BASE_URL` on every request. Helper `newAuthor()` returns a signed-in client using the same signup → signin sequence as `scripts/smoke.mjs:44-58`.

#### 2. Anonymous matrix

**File**: `tests/http/route-access.test.ts` (new)

**Intent**: For each `ROUTE_AUDIENCE` entry, substitute sample values into the dynamic segments: a random uuid for `[id]`, and an unknown token for `[token]`. Then issue each route's real method or methods anonymously. The methods come from a small per-pattern table in the test. If an author pattern has no method in that table, the test fails, so the table has to grow with the map.

- **Author:** 302 with `Location` exactly `/auth/signin`.
- **Participant and public:** the response is not a redirect to `/auth/signin`, and the status is below 500.

**Contract**: Path-variant cases for each author route that has a dynamic or nested segment:
- `%2e%2e`, `%252e%252e` and `%2E%2e` used as the `[id]` segment;
- a trailing slash;
- a percent-encoded letter (`/%64ashboard`).

Each must answer exactly 302 → `/auth/signin` or 404 (see Critical Implementation Details). Prefix-collision paths (`/api/studiesX`, `/studiesfoo`) answer 404.

#### 3. Participant reachability and cookie attributes

**File**: `tests/http/route-access.test.ts`

**Intent**: Two things:
- Using a token read from a started study's owner page, anonymous `GET /v/<token>` answers 200. This proves the participant link is still public, beyond "not redirected". The fixture is shared with phase 3; create it once in a `beforeAll` via `newAuthor()`.
- After sign-in, each `sb-` session cookie in `Set-Cookie` carries `Path=/`, `SameSite=Lax` and `Secure`, since the preview is a non-DEV build.

**Contract**: The token is extracted from the owner's `/studies/<id>` HTML by its `/v/<token>` link.

### Success Criteria:

#### Automated Verification:

- HTTP suite passes against a fresh preview: `npm run build && npm run preview -- --port 4321` then `BASE_URL=http://localhost:4321 npm run test:http`
- Temporarily reverting the middleware to the old pathname check makes the encoded-variant cases fail (then restore)
- Linting passes: `npm run lint`
- Type check passes: `npx astro check`

#### Manual Verification:

- The test output lists every `ROUTE_AUDIENCE` entry by name, so a reviewer can see the matrix without reading code

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Two-author isolation over HTTP (risk #2)

### Overview

Prove the app translates "not owned" correctly on every author page and endpoint that takes an id, and that B changes nothing.

### Changes Required:

#### 1. Author isolation suite

**File**: `tests/http/author-isolation.test.ts` (new)

**Intent**: Fixtures in `beforeAll`: author A (`newAuthor()`) creates two studies through `POST /api/studies`, each with 2 variants, and reads both ids from the `Location` header. A starts the first (`POST /api/studies/<id>/start`); the second stays a draft. Author B is a second `newAuthor()` and creates one draft study of their own.

B's requests against each of A's ids (active and draft):

| Request | Expected |
|---|---|
| `GET /studies/<id>` | 404 |
| `GET /api/studies/<id>/results` | 404 with JSON `{"error":"not_found"}` |
| `POST /api/studies/<id>/start` | 302 to `/studies/<id>` with no `?error=`; following it as B gives 404 |

The same expectations apply to an unknown uuid and to a non-uuid id (`not-a-uuid`). B's `/dashboard` lists B's own study title and neither of A's.

Controls as A:
- `GET /api/studies/<draft id>/results` returns 200 with `status: "draft"` after B's start attempt.
- `GET /studies/<active id>` returns 200.

**Contract**: The assertions use status codes, `Location` and the JSON body. HTML is checked only for the presence or absence of study titles on `/dashboard`, and each fixture title is unique per run (it includes a timestamp).

### Success Criteria:

#### Automated Verification:

- HTTP suite passes: `BASE_URL=http://localhost:4321 npm run test:http`
- The suite passes twice in a row against the same database (unique emails and titles, no shared state)
- Linting passes: `npm run lint`
- Type check passes: `npx astro check`

#### Manual Verification:

- Reading the test names alone gives the B-vs-A matrix (route × A-active / A-draft / unknown / non-uuid)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: pgTAP isolation gaps

### Overview

Close every database gap from research §3 in a new suite, following the fixture and role-switching style of `supabase/tests/study_isolation.test.sql`.

### Changes Required:

#### 1. Gap suite

**File**: `supabase/tests/author_isolation_gaps.test.sql` (new)

**Intent**: Fixtures are inserted as the superuser:
- author A: a draft, an active and a closed study, each with variants; the active one has links;
- author B: one own draft with a variant and a link.

Assertions run as B (`set local role authenticated` + `request.jwt.claims`):

- **Reads:** B sees exactly their own study, variants and links (count and ids), not zero. `select used from study_links` → `42501`.
- **Variants:** B's update of A's variants (`content`, `position`) and delete of A's variants run without error; checked after `reset role`, 0 rows changed. B's insert into A's **active** study → `42501`.
- **Studies:** B's insert with `author_id` set to A → `42501` (column not granted). B's update of `participant_target` on A's draft changes 0 rows. B's update of `status` → `42501`.
- **study_links:** B's insert, update and delete of A's links → `42501`.
- **Functions:** `start_study` as B on A's active, closed and an unknown uuid → `P0002`. `get_study_results` as B on A's draft, closed and an unknown uuid → `null`.
- **After `reset role`:** all of A's rows are unchanged (titles, targets, statuses, variant content and positions, link count).

**Contract**: One transaction ending in `select * from finish(); rollback;`. The `plan(N)` count equals the number of assertions. Fixture uuids must not collide with the other suites; each suite rolls back, but use a distinct prefix for readability.

### Success Criteria:

#### Automated Verification:

- Database tests pass: `npx supabase test db`
- The new suite runs and reports its full plan count in the output

#### Manual Verification:

- Each gap in research §3 maps to at least one named assertion (cross-check the list)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: CI wiring and documentation

### Overview

Make the new suites a required CI signal and record how to add a route test.

### Changes Required:

#### 1. CI

**File**: `.github/workflows/ci.yml`

**Intent**: In the `smoke` job, run `npm run test:unit` and then `BASE_URL=http://localhost:4321 npm run test:http` right after `npm run smoke`, reusing the same preview and Supabase stack.

**Contract**: No new job or service. `supabase stop` stays last under `if: always()`.

#### 2. Docs

**Files**: `AGENTS.md`, `README.md`, `docs/reference/contract-surfaces.md`

**Intent**:
- `AGENTS.md:17` and `README.md:150`: replace "add paths to `PROTECTED_ROUTES`" with "classify every new page in `src/lib/route-access.ts`; `npm run test:unit` fails otherwise".
- `AGENTS.md` Testing section: replace "There is no unit or e2e suite for app code" with the two new commands.
- `contract-surfaces.md:130`: the results-endpoint note says protection comes from the route's `author` entry, not the `/api/studies` path prefix.

**Contract**: Docs only; no behaviour change.

#### 3. Test plan cookbook

**File**: `context/foundation/test-plan.md`

**Intent**:
- Fill §6.2 "Adding a route-access test": add a map entry, then check that the anonymous matrix picks it up automatically and that the method table has a row. For an author route that takes an id, add the B-vs-A row in `tests/http/author-isolation.test.ts` and, if a new RPC or table is involved, the matching pgTAP assertions. Give the locations, naming, a reference test and the run commands.
- Append a Phase 1 note to §6.6 (the routePattern fix and the encoded-path lesson).
- Update the §4 Stack row "unit + HTTP integration" to Vitest with its version.

**Contract**: Strategy sections §1–§3 and §5 are not edited, apart from what the orchestrator owns (§3 status).

### Success Criteria:

#### Automated Verification:

- Workflow file is valid YAML and the new steps appear in order: `npx --yes yaml-lint .github/workflows/ci.yml` (or equivalent parse)
- CI run on the PR passes the `smoke` job, including `test:unit` and `test:http`
- Linting passes: `npm run lint`

#### Manual Verification:

- Test-plan §6.2 is followable by someone adding a fictional `/studies/[id]/edit` page
- `AGENTS.md` and `README.md` no longer mention `PROTECTED_ROUTES`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- Route classification completeness, in both directions: unclassified file and stale entry.
- `requiresAuthor` for each audience and for an unknown pattern.

### Integration Tests:

- HTTP, anonymous: every map entry; encoded, dot-segment, trailing-slash and percent-encoded-letter variants; prefix collisions; participant link public with a real token; cookie attributes.
- HTTP, two authors: B vs A on `/studies/[id]`, `/api/studies/[id]/results` and `/api/studies/[id]/start` for active, draft, unknown and non-uuid ids; `/dashboard` lists only own studies; A controls.
- pgTAP: the full research §3 gap list, including "B sees own rows only".

### Manual Testing Steps:

1. Before phase 1, reproduce the research bypass probes against the preview. After phase 1, confirm 302 → `/auth/signin`.
2. Add a throwaway page without classifying it, and confirm `npm run test:unit` names it.
3. Revert the middleware locally, and confirm the encoded-variant HTTP cases fail.

## Performance Considerations

The `getUser()` call per request is unchanged, and the map lookup is O(1). The HTTP suite creates 2–3 accounts per run; expect it to add well under a minute to the CI `smoke` job.

## Migration Notes

There are no data or schema migrations. The middleware change is behaviour-preserving for every legitimate path; it only adds protection where the router and the pathname disagreed. To roll back, revert the middleware commit; the tests then fail loudly on the encoded variants.

## References

- Research: `context/changes/testing-access-boundaries/research.md`
- Test plan: `context/foundation/test-plan.md` (§2 risks #1, #2; §3 Phase 1; §5 gates; §6.2)
- Middleware: `src/middleware.ts:4,19,21`
- HTTP pattern: `scripts/smoke.mjs:7-37`
- pgTAP style: `supabase/tests/study_isolation.test.sql:1-102`
- Astro `routePattern`: `node_modules/astro/dist/types/public/context.d.ts:572-583`
- CI: `.github/workflows/ci.yml:14-43`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Runner, route-audience map and middleware fix

#### Automated

- [x] 1.1 Unit suite passes: `npm run test:unit` — 6a4a6ab
- [x] 1.2 Adding a throwaway `src/pages/zz-probe.astro` makes `npm run test:unit` fail with the file named (then remove it) — 6a4a6ab
- [x] 1.3 Linting passes: `npm run lint` — 6a4a6ab
- [x] 1.4 Type check passes: `npx astro check` — 6a4a6ab
- [x] 1.5 Build passes: `npm run build` — 6a4a6ab
- [x] 1.6 Existing smoke still passes against the preview: `npm run smoke` — 6a4a6ab

#### Manual

- [x] 1.7 Against `npm run preview`, unauthenticated encoded-`..` probes on results and start now answer 302 → `/auth/signin` — 6a4a6ab
- [x] 1.8 The same two probes answer 302 → `/auth/signin` under `npm run dev` — 6a4a6ab
- [x] 1.9 Signed in, `/dashboard`, `/studies/new` and an own `/studies/<id>` still render — 6a4a6ab

### Phase 2: HTTP route × role matrix (risk #1)

#### Automated

- [x] 2.1 HTTP suite passes against a fresh preview
- [x] 2.2 Temporarily reverting the middleware to the old pathname check makes the encoded-variant cases fail (then restore)
- [x] 2.3 Linting passes: `npm run lint`
- [x] 2.4 Type check passes: `npx astro check`

#### Manual

- [x] 2.5 The test output lists every `ROUTE_AUDIENCE` entry by name

### Phase 3: Two-author isolation over HTTP (risk #2)

#### Automated

- [ ] 3.1 HTTP suite passes: `BASE_URL=http://localhost:4321 npm run test:http`
- [ ] 3.2 The suite passes twice in a row against the same database
- [ ] 3.3 Linting passes: `npm run lint`
- [ ] 3.4 Type check passes: `npx astro check`

#### Manual

- [ ] 3.5 Reading the test names alone gives the B-vs-A matrix

### Phase 4: pgTAP isolation gaps

#### Automated

- [ ] 4.1 Database tests pass: `npx supabase test db`
- [ ] 4.2 The new suite runs and reports its full plan count in the output

#### Manual

- [ ] 4.3 Each gap in research §3 maps to at least one named assertion

### Phase 5: CI wiring and documentation

#### Automated

- [ ] 5.1 Workflow file is valid YAML and the new steps appear in order
- [ ] 5.2 CI run on the PR passes the `smoke` job, including `test:unit` and `test:http`
- [ ] 5.3 Linting passes: `npm run lint`

#### Manual

- [ ] 5.4 Test-plan §6.2 is followable by someone adding a fictional `/studies/[id]/edit` page
- [ ] 5.5 `AGENTS.md` and `README.md` no longer mention `PROTECTED_ROUTES`
