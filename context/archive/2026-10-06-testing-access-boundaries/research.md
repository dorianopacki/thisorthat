---
date: 2026-10-06T12:47:13+02:00
researcher: Claude (Opus 5.5) with dorian.opacki
git_commit: 49524e5
branch: chore/live-results-and-comments-closeout
repository: thisorthat
topic: "Ground test-plan rollout Phase 1 — access boundaries (risks #1 route protection, #2 author isolation / IDOR)"
tags: [research, testing, middleware, auth, rls, idor, pgtap, vitest, ci]
status: complete
last_updated: 2026-10-06
last_updated_by: Claude (Opus 5.5)
---

# Research: Ground test-plan rollout Phase 1 — access boundaries

**Date**: 2026-10-06T12:47:13+02:00
**Researcher**: Claude (Opus 5.5) with dorian.opacki
**Git Commit**: 49524e5 (working tree also holds uncommitted `context/foundation/test-plan.md`, `roadmap.md`)
**Branch**: chore/live-results-and-comments-closeout
**Repository**: thisorthat

## Research Question

Ground rollout Phase 1 of `context/foundation/test-plan.md` ("Access boundaries"), covering:

- **Risk #1** — an author page or endpoint is reachable without sign-in, the participant link stops being public, or session cookies behave differently on Workers than locally. Prove: every author route redirects to sign-in without a session, every participant route works without one, and a new unclassified route makes a test fail. Challenge: "the smoke test covers `/dashboard`, so protection works". Avoid: enumerating today's routes only.
- **Risk #2** — an author reads or changes another author's data via a foreign id (IDOR). Prove: author B gets not-found / nothing for every A-owned id on each page, endpoint and RPC, and changes nothing. Challenge: "RLS covers it, so endpoints need no test". Avoid: testing B only against B's own data.

Hot-spot evidence (likelihood only): `src/pages/api` (10/30d), `src/lib` (11/30d). Stack: Astro 7 SSR on Cloudflare Workers, Supabase, pgTAP in CI, no app runner.

## Summary

1. **Route protection is one prefix list in middleware, and it has a confirmed bypass.** `src/middleware.ts:4` protects `/dashboard`, `/studies`, `/api/studies` with exact-or-subpath matching (`:19`) and answers 302 → `/auth/signin` (`:21`). A double-encoded dot segment (`%252e%252e`) makes the router dispatch to a protected endpoint while the middleware sees an unprotected path. **Reproduced on 2026-10-06 against both `astro dev` and the built `astro preview` (workerd)**, unauthenticated:
   - `GET /api/studies/%252e%252e/results` → `500 {"error":"server_error"}` (the endpoint ran; expected 302).
   - `POST /api/studies/%252e%252e/start` → 302 to `/?error=Nie udało się rozpocząć badania…` (the endpoint ran).
   - `/studies/%252e%252e` → 404; `/api/studies/x/results`, `/studies/x/../../dashboard`, `/dashboard` → 302 (protected as expected).
   No data was exposed on these probes: the endpoints call RPCs granted only to `authenticated`, so `anon` is refused and the endpoints answer an error. The risk is the class: any future protected route whose code acts before or without an RLS-checked call (e.g. a service-key path in S-08 storage) would be reachable anonymously. Not verified: whether Cloudflare's edge normalizes `%25` before the Worker in production.
2. **Nothing fails when a new route is added without classification.** No route manifest or classification test exists. A complete route list is derivable from the filesystem (15 files under `src/pages/**` today) or the built manifest (same 15 plus Astro internals `/_image`, `/_server-islands/[name]`).
3. **Ownership is enforced only in the database; the app has no ownership checks.** All app queries use one anon/publishable-key client with the user's cookie session (`src/lib/supabase.ts:7-25`); no service-role key is used anywhere in code. RLS (`studies`, `variants`, `study_links`), column grants, and definer checks (`start_study`, `get_study_results` filter `author_id = auth.uid()`) are the real boundary. App routes translate not-owned into 404 page / JSON 404 / redirect.
4. **pgTAP covers the main B-vs-A reads, with specific gaps.** Covered: B sees 0 rows of A's studies/variants/links, B's update/delete of A's studies changes 0 rows, B's variant insert into A's draft is refused, `get_study_results(A active)` → null, `start_study(A draft)` → P0002. Not covered (list in Detailed Findings §3): B update/delete of A's variants, B insert into A's active study, B setting `author_id`, B on `start_study`/`get_study_results` for A's active/closed/draft/unknown ids, B owning their own study ("own rows only" vs "zero rows").
5. **The app layer has no tests for either risk.** `scripts/smoke.mjs` covers 8 steps around `/`, `/dashboard` and auth endpoints only; no `/studies*`, `/api/studies*`, `/v/*`, `/api/v/*`, encoded paths, or foreign-author cases.
6. **Test infrastructure:** no Vitest/Playwright installed. CI's `smoke` job already has local Supabase, a built preview on :4321 and `.dev.vars`; an HTTP suite fits there. Two authors can be created through the app's own signup + signin (local `enable_confirmations = false`). `getViteConfig` would pull the Cloudflare vite plugin into Vitest (unverified compatibility); new `*.test.ts` files would fall under strict ESLint and `astro check` as configured today.

Response-guidance verdicts for the test plan: **#1 guidance holds and is sharpened** — the matrix must include path-normalization variants, not only "anonymous vs signed-in", and the "new route must fail" check is confirmed missing. **#2 guidance holds** — "RLS covers it" is true for current routes (the database is the only boundary) but unproven for several write paths and for the HTTP translation of not-owned ids.

## Detailed Findings

### 1. Route inventory and middleware (Risk #1)

Middleware (`src/middleware.ts`):

- `:4` `const PROTECTED_ROUTES = ["/dashboard", "/studies", "/api/studies"];`
- `:9-15` every request (public and 404 included) builds a client and calls `supabase.auth.getUser()`; a null client sets `user = null` (fail-closed for protected routes).
- `:19` `pathname === route || pathname.startsWith(\`${route}/\`)`; `:21` redirect `/auth/signin` (302, no return-to) — also for the JSON endpoint (`docs/reference/contract-surfaces.md:130`).

Inventory (15 files; audience inferred from code/comments):

| Route | Methods | Intended audience | Protected by middleware |
|---|---|---|---|
| `/` `src/pages/index.astro` | GET | any | no |
| `/auth/signin`, `/auth/signup`, `/auth/confirm-email` | GET | anonymous (signed-in users are not redirected away) | no |
| `/dashboard` | GET | author | yes |
| `/studies/new` | GET | author | yes |
| `/studies/[id]` | GET | owning author (404 otherwise, `src/pages/studies/[id].astro:79-82`) | yes |
| `/v/[token]` | GET | participant, public | no (intended) |
| `/api/auth/signin`, `/api/auth/signup`, `/api/auth/signout` | POST | anonymous / any | no |
| `/api/studies` | POST | author (`create_study`) | yes |
| `/api/studies/[id]/start` | POST | owning author (`start_study`) | yes |
| `/api/studies/[id]/results` | GET (JSON) | owning author (`get_study_results`) | yes |
| `/api/v/[token]` | POST | participant, public (`context/archive/2026-10-05-one-time-link-voting/plan.md:186`) | no (intended) |

Astro internal routes in the built manifest: `/_image`, `/_server-islands/[name]` (no server islands used). No custom `404.astro`.

Path normalization (from the built runtime, `dist/server/chunks/`, hashed filenames; inspected 2026-10-06):

- trailing slash ignored (`"trailingSlash":"ignore"`); `/dashboard/` is protected via `startsWith`.
- case-sensitive; `/DASHBOARD` is unprotected but matches no route → 404.
- `decodeURI` applied repeatedly (≤10 times, else 400); `/%64ashboard` → `/dashboard` → protected. `%2F` is not decoded → no route match → 404.
- prefix collisions (`/api/studiesX`, `/studiesfoo`) are unprotected but match no route today; a future file such as `src/pages/studies-archive.astro` would be unprotected.
- **Confirmed bypass:** router matches the decoded string `/api/studies/../start` (id = `..`) while the middleware reads `context.url.pathname`, which the URL setter resolves to `/api/start`. Probe results in Summary §1 (both `astro dev` on :4321 and `astro preview` on :4322).

Sessions / cookies / runtime differences:

- `src/lib/supabase.ts:11-23` — `createServerClient`, `cookieOptions: { secure: !import.meta.env.DEV }`; path `/`, `sameSite: lax` from library defaults; reads raw `Cookie` header, writes via `Astro.cookies.set`.
- Middleware uses `getUser()`, never `getSession()` (no `getSession` in `src/`).
- `astro.config.mjs` — `output: "server"`, Cloudflare adapter, `SUPABASE_URL`/`SUPABASE_KEY` optional server secrets; no `security` block → default `checkOrigin` (manifest shows `checkOrigin:true`).
- `wrangler.jsonc` — KV `SESSION` binding present but `Astro.session` unused; `SUPABASE_URL` in vars, `SUPABASE_KEY` secret.
- Dev vs preview: `import.meta.env.DEV` toggles the `Secure` cookie flag (`src/lib/supabase.ts:13`, `src/pages/api/v/[token].ts:30`) and `auth/confirm-email.astro:4` copy. In CI preview, cookies are `Secure` over `http://localhost`; `scripts/smoke.mjs` ignores cookie attributes, so a browser-only cookie drop would not show there. Dev and built handler match routes differently (`devMatch` vs `app.match`, `dist/server/entry.mjs:118-122`); the bypass probe gave the same results on both.
- `checkOrigin`: rejects form posts with a foreign or `null` Origin (history: `Referrer-Policy: no-referrer` caused 403, `context/archive/2026-10-05-one-time-link-voting/reviews/impl-review.md:31-42`); does not apply to non-form content types (`…/impl-review.md:53`). HTTP tests posting forms must send `Origin` (as `scripts/smoke.mjs` does).

### 2. Author isolation (Risk #2) — database boundary

Grants (`supabase/migrations/20261002095727_study_data_model.sql:95-111`): `authenticated` has `studies` select/delete + insert/update of `(title, participant_target)` only; `variants` select/delete + insert `(study_id, position, content)` + update `(position, content)`; `study_links` select `(id, study_id, token)` only; nothing on `votes`/`comments`; `anon` has no table privileges. `author_id` defaults to `auth.uid()` and is in no grant; `status` is in no grant.

RLS (`…study_data_model.sql:117-202`, all `to authenticated`, `(select auth.uid())`):

| Table | Command | Condition |
|---|---|---|
| studies | select / insert / delete | `author_id = auth.uid()` |
| studies | update | own and `status = 'draft'` |
| variants | select | parent study owned |
| variants | insert / update / delete | parent owned and draft |
| study_links | select | parent study owned |

Functions and not-owned behaviour:

| Function | Mode / grant | Ownership | Not-owned or unknown id |
|---|---|---|---|
| `create_study` (`20261005075735_create_and_start_study.sql:36`) | invoker, `authenticated` | via grants + RLS; takes no id | n/a |
| `start_study` (`…create_and_start_study.sql:86`) | definer, `authenticated` | `author_id = auth.uid() for update` (`:99-104`) before the status check | raises `P0002` (`:106-108`) — also for a foreign active study, so no existence oracle |
| `get_study_results` (`…study_data_model.sql:345`) | definer, `authenticated` only (`:389-390`) | `author_id = auth.uid()` (`:385-386`) | `null` |
| `cast_vote`, `get_ballot` | definer, `anon` + `authenticated` | token is the credential (by design) | `study_ended` / `null` |

### 3. Author isolation (Risk #2) — app translation and existing tests

App routes (`src/lib/supabase.ts` is the only client; no `SERVICE_ROLE`/`sb_secret` in `src/` — grep 2026-10-06):

- `/studies/[id]` — RLS select (`src/pages/studies/[id].astro:26-30`); non-uuid `22P02` tolerated (`:32`); not-owned/unknown/non-uuid → HTTP 404 page (`:79-82`); other errors throw → 500.
- `/api/studies/[id]/start` — `start_study`; `P0002`/`22P02` → redirect to `/studies/<id>` which renders 404 (`start.ts:23`).
- `/api/studies/[id]/results` — `get_study_results`; `22P02` or `null` → JSON 404, other errors → JSON 500 (`results.ts:18-22`).
- `/api/studies` (POST form: `title`, `participant_target`, repeated `variant`; `src/pages/api/studies/index.ts:47-53`) — `create_study`; no id.
- `/dashboard` — RLS select with no app-side `author_id` filter (`src/pages/dashboard.astro:10-12`).

Existing pgTAP coverage, author B against A (`supabase/tests/`):

- `study_isolation.test.sql`: B sees 0 studies/variants/links (`:45-47`); B variant insert into A's draft → `42501` (`:49-55`); B update of A's title and delete of A's studies change 0 rows (`:57-67`, verified `:77-83`); `get_study_results(A active)` as B → null (`:69-73`); anon denied everywhere (`:89-102`).
- `create_and_start_study.test.sql`: `start_study(A draft)` as B → `P0002` (`:278-283`); no `auth.uid()` → `P0002` (`:287-292`); A's draft unchanged (`:296-306`).
- `get_ballot.test.sql`: B holding A's token gets the same ballot as anon (`:136-146`) — token access by design.

Gaps (not covered by any test, inspected suites = all 5 files in `supabase/tests/`):

- B update (`content`, `position`) or delete of A's variants; B insert into A's **active** study.
- B insert with `author_id` = A; B update of `participant_target`; B update of `status`.
- `study_links` write attempts and `select used` as B (tested only as owner/anon).
- `start_study` as B on A's active/closed study and on an unknown uuid; `get_study_results` as B for A's draft/closed and unknown uuid.
- No fixture where B owns a study, so "B sees only own rows" is unproven (only "B sees zero").
- App layer: no test that `/studies/<A id>`, `/api/studies/<A id>/results`, `/api/studies/<A id>/start` give 404 / JSON 404 / redirect-to-404 for B, nor the non-uuid and unauthenticated cases.

Upcoming author surfaces that will need the same matrix (roadmap): S-04 manual close + deadline (new owner-checked status write), S-05 dashboard progress (needs a per-study responded count), S-06 edit/delete endpoints taking study and variant ids, S-07 extra links (definer write), S-08 storage bucket policies for images (`context/foundation/roadmap.md:139-199`).

### 4. Test infrastructure

- No test runner: `package.json:5-14` scripts are dev/build/preview/lint/lint:fix/format/smoke; no vitest/jest/playwright in devDependencies or `node_modules`.
- `tsconfig.json:3-4` includes `**/*` (excludes only `dist`); `eslint.config.js:17-22` applies `strictTypeChecked` with `projectService`; relaxations only for `scripts/**/*.mjs` (`:73-78`). New `*.test.ts` files would be linted and type-checked as app code; untyped globals would fail.
- CI `ci.yml` job `smoke` (`:14-43`): Supabase start (excluding studio, mailpit, etc.), `supabase test db`, writes `.env` + `.dev.vars` from `API_URL`/`ANON_KEY`, `npm run build`, `npm run preview -- --port 4321 &`, `npm run smoke`, `supabase stop`. `deploy.yml` `verify` (`:13-27`) runs lint/check/build without Supabase.
- `astro preview` runs the built worker in workerd via `@cloudflare/vite-plugin` (`node_modules/@astrojs/cloudflare/dist/index.js:365`, preview entrypoint) — inferred, consistent with the 2026-10-06 probe on :4322.
- Two authors: local `supabase/config.toml:204,209` (`enable_signup = true`, `enable_confirmations = false`); no `seed.sql`. `scripts/smoke.mjs` shows the pattern: unique email, manual redirects, own cookie jar, `Origin` header. Inferred (not run): two jars → two authors A and B; A creates and starts a study via `/api/studies` and `/api/studies/<id>/start`.
- Vitest + Astro: `getViteConfig` is exported (`node_modules/astro/dist/config/index.js:4-46`) and runs integration hooks, so the Cloudflare vite plugin would be injected (`node_modules/@astrojs/cloudflare/dist/index.js:173-196`) — compatibility with Vitest not verified and not documented in the installed packages. `astro:env/server` imports (`src/lib/supabase.ts`, `src/lib/config-status.ts`) do not resolve outside Astro's pipeline.
- Pure, runtime-free modules (relevant to Phase 3, not this phase): `src/lib/ballot-order.ts`, `study-limits.ts`, `study-links.ts`, `study-results.ts`, `utils.ts`.

## Code References

- `src/middleware.ts:4,9-15,19,21` — protected prefix list, per-request `getUser`, match rule, 302 redirect
- `src/lib/supabase.ts:7-25` — single anon-key server client, `secure: !import.meta.env.DEV`
- `src/pages/studies/[id].astro:26-32,79-82` — RLS read, 22P02 tolerance, 404
- `src/pages/api/studies/[id]/start.ts:16-23` — `start_study`, P0002/22P02 → redirect
- `src/pages/api/studies/[id]/results.ts:14-22` — JSON 404/500 mapping
- `src/pages/api/studies/index.ts:47-61` — create form fields, `create_study`
- `src/pages/dashboard.astro:10-12` — RLS-only list
- `supabase/migrations/20261002095727_study_data_model.sql:95-111,117-202,345-390` — grants, RLS, `get_study_results`
- `supabase/migrations/20261005075735_create_and_start_study.sql:36,86-108` — `create_study` invoker, `start_study` owner filter
- `supabase/tests/study_isolation.test.sql:45-102` — existing B-vs-A and anon cases
- `supabase/tests/create_and_start_study.test.sql:278-306` — `start_study` as B
- `scripts/smoke.mjs:5-66` — HTTP smoke pattern (cookie jar, Origin, manual redirects)
- `.github/workflows/ci.yml:14-43` — smoke job with Supabase + preview
- `supabase/config.toml:204,209` — signup on, confirmations off locally

## Architecture Insights

- The database is the only authorization boundary for author data; the app is a thin translator (RLS/definer result → 404 / redirect / JSON). Tests of Risk #2 therefore have two cheap layers: pgTAP for the boundary itself, HTTP for the translation.
- The middleware is authentication-only and declarative (one prefix list). Its weak points are classification (a new route is silently public) and path normalization (router and middleware see different paths). Both are testable from outside via HTTP against the built preview; the built preview runs the same workerd path CI and production use.
- Because every protected endpoint today calls an `authenticated`-only RPC, the confirmed bypass is defence-in-depth, not a data leak; a future route doing work before an RLS-checked call would turn it into one.

## Historical Context (from prior changes)

- `context/archive/2026-10-02-study-data-model/plan.md` — F-01 chose RLS + definer functions with `search_path = ''` and pgTAP role switching; the basis of the database boundary.
- `context/archive/2026-10-05-create-and-start-study/plan.md` — `start_study` filters ownership before status to avoid an existence oracle (supported by `…create_and_start_study.sql:99-108`).
- `context/archive/2026-10-05-one-time-link-voting/reviews/impl-review.md:31-42,53` — `Referrer-Policy: no-referrer` broke `checkOrigin` (403); `checkOrigin` does not cover non-form content types. Supported by current code (`src/pages/v/[token].astro:28-33`).
- `context/archive/2026-10-06-live-results-and-comments/plan.md` — results endpoint placed under `/api/studies` to inherit `PROTECTED_ROUTES`; the confirmed bypass shows that inheritance is path-string based.
- `AGENTS.md:17`, `README.md:150` — "add protected paths to `PROTECTED_ROUTES`" is the only documented rule; no enforcement.

## Related Research

None — first `research.md` in this repository (`context/changes/**` and `context/archive/**` contain plans and reviews only).

## Open Questions

- Does Cloudflare's production edge normalize `%25`-encoded dot segments before the Worker? Not verifiable locally; affects production exposure of the bypass, not the local/CI test.
- Fix vs test for the bypass: the rollout phase can assert the expected behaviour (302 for encoded variants); whether to fix the middleware in this change or a separate change is a planning decision.
- Vitest with `getViteConfig` + Cloudflare adapter: unverified. An HTTP suite against the preview needs no Vite integration (plain Node `fetch`, as `scripts/smoke.mjs` does); the runner choice is a planning decision.
- Whether signup alone sets a session cookie with confirmations off (smoke signs in explicitly) — not checked.
