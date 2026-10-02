---
project: thisorthat
plan_created_at: 2026-09-17
status: draft — awaiting human approval
platform: Cloudflare Workers (static assets + SSR) — NOT Cloudflare Pages
sources:
  - context/foundation/infrastructure.md
  - context/foundation/tech-stack.md
ci: GitHub Actions (auto-deploy on merge to main)
---

# Deploy Plan — thisorthat on Cloudflare Workers

This plan covers connecting Cloudflare and deploying for the first time, based on `infrastructure.md`. Every phase has checkboxes. Tick them as you go so this file shows what was actually done.

**Legend**
- 🤖 The agent can do this unattended.
- 👤 Human only: this needs the dashboard, touches secrets, or is irreversible (see the production-access rules in CLAUDE.md).
- ⚠️ Edge case. Each one has recovery steps.

**Hard rules for the whole plan**
- Deploy with `wrangler deploy` (Workers). **Never** use `wrangler pages deploy`. Current `@astrojs/cloudflare` (v13+ for Astro 6, v14.x for Astro 7) no longer supports Pages.
- Read environment values with `import { env } from "cloudflare:workers"` (or `astro:env`). **Never** use `Astro.locals.runtime.env`, which was removed in Astro 6.
- Keep secrets out of git, `.mcp.json` and chat. Store them only as Workers secrets, GitHub Actions secrets, or in your local `.dev.vars` / `.env` (both gitignored).

---

## Phase 0 — Prerequisites (must be in place before anything else)

### 0.1 Local toolchain
- [x] Node.js is version 22 LTS or newer: `node -v`. Current Astro and Wrangler 4 need Node ≥ 22. (v24.21.0 verified 2026-09-17)
- [x] npm is installed: `npm -v`. The package manager in `tech-stack.md` is npm. (11.19.0 verified 2026-09-17)
- [x] git is installed and your identity is set: `git config user.name` / `git config user.email`. (git 2.47.1, identity set, verified 2026-09-17)
- [x] Wrangler CLI works (confirmed by user 2026-09-17): `npx wrangler --version` (4.133.0 verified on 2026-09-17; the project-local version is **4.131.1**, which gets pinned in Phase 1).
- [x] GitHub CLI is installed: `gh --version` (2.100.0 verified).
- [x] 👤 GitHub CLI is logged in: `gh auth login`, then `gh auth status`. (Logged in as `dorianopacki`, verified 2026-09-17.)

### 0.2 Source code
- [x] 👤 The GitHub repository exists (confirmed by user 2026-09-17). Record its URL here: `https://github.com/dorianopacki/thisorthat` (private, created 2026-09-17).
- [x] The repo is cloned locally and contains the bootstrapped **10x Astro Starter**, with `package.json` and `astro.config.mjs` present. If it hasn't been bootstrapped, run `/10x-bootstrapper` first. ✅ The app code is in `C:\10xdevs` (verified 2026-09-17). `git init` on `main` and initial commit `8983d62` done 2026-09-17, with `origin` set. ✅ Pushed to `origin/main` on 2026-09-17, after adding the `workflow` scope to `gh`. ⚠️ Git's global Windows credential manager signs in as a different GitHub account (`Dorian210598`), so this repo uses `gh auth git-credential` through **local** git config only. `.gitignore` was hardened to cover `.env.*`, `.dev.vars.*` and `.claude.json`.
- [x] `npm ci && npm run build` succeeds locally **before** any Cloudflare work. (Passed 2026-09-17, after `npm ci` restored the missing `@rolldown/binding-win32-x64-msvc`. npm 11 blocked the `workerd` and `esbuild` postinstall scripts; revisit in Phase 6 if `astro preview` fails.)
- [x] `.gitignore` includes `.dev.vars*`, `.env*`, `.wrangler/`, `dist/` and `node_modules/`.

### 0.3 Cloudflare account
- [x] 👤 You have a Cloudflare account (confirmed by user 2026-09-17). `npx wrangler whoami` shows OAuth for account `9224026f20909f037d51f92e7d6b90e3`.
- [x] 👤 Record the Account ID for CI: `9224026f20909f037d51f92e7d6b90e3`.
- [x] 👤 Choose and register your `*.workers.dev` subdomain: Dashboard → Workers & Pages → it's shown on the overview page. The first deploy fails if none is registered. (**`dorianwew.workers.dev`**, registered 2026-09-17.)
- [x] 👤 Decide whether you'll use a custom domain for the MVP (yes/no). **Decision 2026-09-17: no.** The MVP runs on `*.workers.dev`; skip the custom-domain step in Phase 7. If yes, the zone must already be on Cloudflare DNS (that's Phase 7).

### 0.4 Supabase cloud project
- [x] 👤 You have a Supabase project (confirmed by user 2026-09-17). Record the project ref: `ykszrmagqyituwiqcsvk`, and the region, ideally an EU one: `eu-west-1`.
- [x] 👤 Collect: Project URL (`https://ykszrmagqyituwiqcsvk.supabase.co`), publishable/anon key, and the service_role/secret key **only if** server code needs it (it should be rare). (Stored in the local `.env` as `SUPABASE_URL` / `SUPABASE_KEY` by the user on 2026-09-17; the names get aligned with Phase 4.)
- [x] 👤 The database schema and migrations are applied to the cloud project: `supabase db push` or `supabase migration list` shows local and remote in sync. ✅ 2026-10-02 (change `study-data-model`, F-01): `20261002095727_study_data_model.sql` pushed with `supabase db push` after user approval; `migration list` shows local = remote. Tables: `studies`, `variants`, `study_links`, `votes`, `comments`. (History: on 2026-09-17 the first deploy shipped the starter without a schema.)
- [x] RLS is enabled on every table exposed through the API. Check with Supabase advisors: `get_advisors` → security. ✅ 2026-10-02: all five `public` tables have RLS on; advisors show no ERROR. The remaining findings are intended: INFO no-policy on `votes`/`comments` (function-only access); WARN definer functions `cast_vote` (anon/authenticated) and `get_study_results` (authenticated); WARN leaked-password protection (Auth setting, not this change).
- [ ] ⏸️ Deferred to S-03: Realtime (FR-013): the result tables are added to the `supabase_realtime` publication, and RLS allows anonymous voters to read the rows they should see.
- [ ] ⏸️ Deferred to S-08: Storage: the image bucket exists, with policies for authenticated upload and public or signed read.
- [ ] ⚠️ **Free projects pause after about 7 days without activity.** Note this in your calendar, or plan to upgrade before a public launch (see Edge cases E6).

### 0.5 Access boundary (least privilege)
- [x] 👤 Create a **scoped Cloudflare API token** for CI. (Created and stored as the GitHub secret `CLOUDFLARE_API_TOKEN` on 2026-09-17; the Phase 4 `gh secret set` for this token is already done.) Dashboard → My Profile → API Tokens → template **"Edit Cloudflare Workers"**, limited to **this account only** (plus a zone, only if a custom domain is used). No DNS edit, no billing.
- [ ] 👤 Keep the broad OAuth login (`wrangler login`) for local use only. It has write access to D1, KV, secrets_store, containers, email and more. Consider `wrangler logout` once CI is working and using a scoped token locally through the `CLOUDFLARE_API_TOKEN` env var instead.

---

## Phase 1 — Verify versions and project config (🤖)

- [x] Check the installed versions: `npm ls astro @astrojs/cloudflare @astrojs/react wrangler @supabase/supabase-js @supabase/ssr`. (2026-09-17: astro 7.3.2, @astrojs/cloudflare 14.3.1, @astrojs/react 6.0.5, wrangler 4.131.1, @supabase/supabase-js 2.116.0, @supabase/ssr 0.12.7)
- [x] Confirm the pairing matches the adapter CHANGELOG: Astro 6 ↔ adapter v13, Astro 7 ↔ adapter v14. If they don't match, run `npx @astrojs/upgrade` rather than bumping packages one at a time. (Astro 7 ↔ adapter v14: OK.)
- [x] Pin exact versions (no `^`) for `astro`, `@astrojs/cloudflare` and `wrangler` in `package.json`. (Pinned to 7.3.2 / 14.3.1 / 4.131.1 on 2026-09-17.) The pre-mortem traced a failed build to an unpinned adapter bump.
- [x] `astro.config.mjs` has `output: "server"` (or static with per-route `prerender = false`) and `adapter: cloudflare({ imageService: "passthrough" })`. Using `passthrough` is a decision taken in the risk register: `sharp` doesn't run in workerd, and `cloudflare-binding` would need a paid Images binding. (`output: "server"` was already set; `imageService: "passthrough"` added 2026-09-17 and the build passes. Env is read through `astro:env` server secrets `SUPABASE_URL` / `SUPABASE_KEY`, which matches the hard rules.)
- [x] Remove any Pages-era leftovers: `_routes.json`, `functions/`, `pages_build_output_dir`, and uses of `Astro.locals.runtime`. Check with `grep -rn "locals.runtime\|pages_build_output_dir" src/ wrangler.*`. (None found on 2026-09-17. `Astro.session` isn't used anywhere either, which matters for Phase 3.)
- [x] Keep path aliases in `tsconfig.json` only, not duplicated in `astro.config.mjs` (see Edge cases E3).

## Phase 2 — `wrangler.jsonc` (🤖, reviewed by 👤)

- [x] Create or adjust `wrangler.jsonc`: (Done 2026-09-17 with Worker name **`thisorthat`**. It keeps the starter's `not_found_handling: "404-page"`. `vars` holds `SUPABASE_URL`, the name the app reads through `astro:env`, not `PUBLIC_SUPABASE_URL`. `kv_namespaces` is left out: the adapter injects the `SESSION` binding itself, see Phase 3.)

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "thisorthat",
  "main": "@astrojs/cloudflare/entrypoints/server",
  "compatibility_date": "2026-09-01",          // ≥ 2026-08-04 → nodejs_compat on by default
  "compatibility_flags": ["nodejs_compat"],    // explicit anyway; belt and braces for @supabase/ssr
  "assets": { "directory": "./dist", "binding": "ASSETS" },
  "observability": { "enabled": true },
  "workers_dev": true,                          // flip to false once custom domain is live (Phase 7)
  "preview_urls": false,                        // public version-preview URLs off until Access protects them
  "kv_namespaces": [
    { "binding": "SESSION", "id": "<filled in Phase 3>" }
  ],
  "vars": {
    "PUBLIC_SUPABASE_URL": "https://<ref>.supabase.co"
  }
}
```

- [x] Compare the `main` and `assets` values with what the installed adapter version generates. Run `npx astro build` and look at `dist/_worker.js` / `dist/server/wrangler.json`. **If they differ, the adapter's values win.** (2026-09-17: the adapter writes `dist/server/wrangler.json` with `main: entry.mjs` and `assets.directory: ../client`, derived from `wrangler.jsonc`, and `wrangler deploy` uses that generated file. Nothing to reconcile.)
- [x] `npx wrangler types` generates `worker-configuration.d.ts`, which gives typed `env` access. ⚠️ It also reads key names from `.env`, so `CLOUDFLARE_API_TOKEN` shows up in `Env`: only the name, no value.
- [x] `npx wrangler check startup` (or `npx wrangler deploy --dry-run --outdir .wrangler/dry`) passes, and the bundle is **under 3 MiB gzipped** (the Free plan limit). (`--dry-run` passed 2026-09-17: 29 modules, 2065 KiB raw / **456 KiB gzip**. Bindings: `SESSION` (KV, injected by the adapter), `ASSETS`, `SUPABASE_URL`.)

## Phase 3 — Cloudflare resources (🤖 creates, 👤 approves)

- [x] **Sessions KV:** the adapter turns on Astro sessions with KV binding `SESSION` by default. Run `npx wrangler kv namespace create SESSION` and paste the `id` into `wrangler.jsonc`. (Created 2026-09-17 with id `9ce77ff9998d44d8a7d9d39f351b6e37` and added to `wrangler.jsonc`; the dry run shows the binding with that id. It was created even though `Astro.session` isn't used yet, because the adapter always injects the binding, and an explicit id avoids auto-provisioning in CI.)
  - ⚠️ If the app uses **only Supabase cookie auth** and never calls `Astro.session`, you can skip this, but check that the deploy doesn't complain about a missing `SESSION` binding (see Edge cases E4).
- [x] Don't add D1, R2 or Hyperdrive. Data stays in Supabase, and D1 free-tier limits have been enforced since 2026-09-01. (Confirmed 2026-09-17: the only bindings are `SESSION`, `ASSETS` and `SUPABASE_URL`.)

## Phase 4 — Secrets and environment variables

The split matters here: `PUBLIC_*` values get **inlined into the client bundle at build time**, while runtime secrets are read by the Worker per request.

> **Updated 2026-09-17 to match the code.** The app reads only `SUPABASE_URL` / `SUPABASE_KEY` through `astro:env/server` (server context, `access: "secret"`), in `src/lib/supabase.ts` and `src/lib/config-status.ts`. No `PUBLIC_*` variables are used, so **nothing is inlined at build time and CI needs no Supabase values** (E9 doesn't apply for now). If a browser island later needs Supabase for FR-013 Realtime, add `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` then, as GitHub Actions build env.

| Name | Where | Why |
|---|---|---|
| `SUPABASE_URL` | `.env` (local), `wrangler.jsonc` `vars` (committed, public) | Server Supabase client |
| `SUPABASE_KEY` (publishable/anon key) | `.env` (local), **Workers secret** | Server Supabase client. Use the publishable key, not service_role. |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secret (✅ set 2026-09-17) | CI deploy (the scoped token from 0.5) |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secret | CI deploy |

- [x] 🤖 Create `.dev.vars.example` and `.env.example` with placeholder values, committed as the secrets checklist. (2026-09-17: `.env.example` documented. No `.dev.vars` is needed, because `astro dev` reads `.env`.)
- [x] 👤 Fill in `.dev.vars` and `.env` locally (gitignored). (`.env` has `SUPABASE_URL` and `SUPABASE_KEY`, filled in by the user on 2026-09-17.)
- [x] 👤 Set the runtime secrets: `npx wrangler secret put SUPABASE_KEY` (the Worker name `thisorthat` comes from `wrangler.jsonc`). (Done 2026-09-17.)
  - ⚠️ `wrangler secret put` before the first deploy creates an empty Worker. That's fine, but see Edge cases E5 if a name mismatch shows up.
- [x] 👤 Set the GitHub secrets: ~~`gh secret set CLOUDFLARE_API_TOKEN`~~ (done 2026-09-17), `gh secret set CLOUDFLARE_ACCOUNT_ID -R dorianopacki/thisorthat`. (The Supabase GitHub secrets aren't needed, see the note above.)
- [x] 🤖 Verify: `npx wrangler secret list` shows `SUPABASE_KEY`, and `gh secret list` shows `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. (Verified 2026-09-17.)

## Phase 5 — Supabase ↔ Cloudflare integration

- [ ] 👤 Supabase → Authentication → URL Configuration:
  - Site URL: `https://thisorthat.dorianwew.workers.dev` (switch to the custom domain in Phase 7).
  - Redirect URLs: `http://localhost:4321/**`, `https://thisorthat.dorianwew.workers.dev/**`.
- [ ] 👤 Email: the built-in SMTP is **heavily rate-limited (a few emails per hour)** and meant for testing only. For launch, configure custom SMTP (Resend, Postmark, etc.) or turn off email confirmation for the MVP (a deliberate decision). **Decision 2026-09-17: option B.** Email confirmation stays on; custom SMTP (e.g. Resend) must be configured **before a public launch**. Until then signups are limited to a few confirmation emails per hour. Leave this box open until SMTP is live.
- [x] 🤖 Server Supabase client uses `@supabase/ssr` `createServerClient` with `cookies.getAll/setAll` mapped to `Astro.cookies`. Cookies must be `secure`, `sameSite: "lax"`, `path: "/"`. (2026-09-17: `src/lib/supabase.ts` was already correct. `path` and `sameSite` come from the library defaults; `cookieOptions: { secure: !import.meta.env.DEV }` was added. `signUp` sets no `emailRedirectTo`, so confirmation links use the Supabase **Site URL**, which makes the step above essential.)
- [x] 🤖 Middleware refreshes the session on each SSR request, and skips static assets so you don't burn CPU time. (`src/middleware.ts` calls `auth.getUser()` per request. Static assets are served by the `ASSETS` layer before the Worker runs, so the middleware never sees `/_astro/*`. `getUser()` is network I/O, not CPU time; watch it in Phase 7.)
- [ ] ⏸️ Deferred (feature not built yet): Realtime results page: the subscription runs **in the browser island** (not SSR), per FR-013 and the CPU-limit mitigation.
- [ ] ⏸️ Deferred (feature not built yet): Images: resize and compress in the browser before uploading to Storage (the `passthrough` decision from Phase 1).
- [ ] ⏸️ Deferred (no bucket yet, see 0.4): Storage CORS/policies: uploads from the production origin work (tested in Phase 6).

## Phase 6 — Local production-parity check (🤖)

- [x] `npm run build` succeeds. (2026-09-17)
- [ ] `npx astro preview` (runs on workerd) passes a smoke test: sign up/log in, create a study, upload an image, open the vote link in a private window, vote, and watch results update live. **Partial pass 2026-09-17:** home, signin, signup and 404 pages render; `/dashboard` redirects anonymous users to `/auth/signin`; signin with a non-existent account reaches cloud Supabase and returns `Invalid login credentials`; `/_astro/*` assets are served with `public, max-age=31536000, immutable`. **Not run:** `npm run smoke` signs up a throwaway `@example.com` account in the **production** Supabase project, which with email confirmation on (option B) uses the SMTP quota and leaves junk users. Study, upload, vote and live-results steps are deferred until those features exist. Run the full signup flow manually with a real inbox.
- [x] No `Dynamic require of "stream"`, `require is not defined` or `MessageChannel is not defined` errors in the console (see Edge cases E1 and E2). (None in the `astro preview logs` output on 2026-09-17.)

## Phase 7 — First production deploy (👤 approves, 🤖 runs)

- [x] 👤 **Gate:** Phases 0–6 are all ticked. Approve the deploy. (User approved 2026-09-17, with the deferred items in 0.4/5/6 and the open Supabase URL Configuration step in Phase 5 accepted as known gaps.)
- [x] 🤖 `npm run build && npx wrangler deploy`. Record the version ID: `71d3d4fb-a881-4ed4-83c5-d128eeade3a5` (deployed 2026-09-17T11:12Z; 2063.61 KiB raw / 456.59 KiB gzip, startup 22 ms).
- [x] 🤖 `npx wrangler deployments list` shows exactly one active version. (`71d3d4fb…` at 100%.)
- [x] 🤖 In a separate terminal, run `npx wrangler tail --format pretty` while repeating the Phase 6 smoke test against `https://thisorthat.dorianwew.workers.dev`. (2026-09-17: `/`, `/auth/signin`, `/auth/signup` → 200; unknown path → 404; `/dashboard` anonymous → 302 `/auth/signin`; `POST /api/auth/signin` with a non-existent account → 302 `?error=Invalid login credentials`, so production reaches cloud Supabase. Tail: `outcome: ok`, no exceptions, **cpuTime 9 ms** on the signin request.)
  - ⚠️ 9 ms CPU is close to the Free plan's 10 ms limit (E7). Watch the CPU-time metric in Phase 9; the first request after deploy includes isolate warm-up, so this may be a worst case.
- [x] 🤖 Check response headers and the pages: no 1102 (CPU exceeded), no 500s, and static assets served with cache headers. (`/_astro/Layout.Cmw-cuza.css` → `public, max-age=31536000, immutable`.)
- [ ] ⏭️ Skipped (decision 0.3: no custom domain for MVP). (Optional) Custom domain: add `"routes": [{ "pattern": "example.com", "custom_domain": true }]`, redeploy, update the Supabase Site URL and Redirect URLs, then set `workers_dev: false` and redeploy.
- [x] 🤖 Rollback dry run: `npx wrangler versions list` shows the rollback target. **Don't actually roll back** unless something is broken. (2026-09-17: the only earlier version is `24f4e97a…`, the empty Worker created by `wrangler secret put` (source "Secret Change"). ⚠️ **There is no useful rollback target yet**; rolling back now would take the site down. The first real rollback target appears after the next deploy.)

## Phase 8 — CI/CD with GitHub Actions (🤖 writes, 👤 merges)

- [x] 🤖 `.github/workflows/deploy.yml`: (Written 2026-09-17 on branch `ci/deploy-workflow`, PR #1. Jobs: `verify` (npm ci, astro sync, lint, astro check, build; no Supabase env needed) → `deploy-production` (push to `main`) / `preview-upload` (same-repo PRs). The existing `ci.yml` triggered on `master`, so it had never run; it now targets `main` and keeps only its local-Supabase `smoke` job, and its duplicate build job, which referenced unset Supabase secrets, was removed. Local `npm run lint` fails on Windows only because of CRLF (`core.autocrlf=true` vs prettier); CI on Linux is clean. ⚠️ wrangler-action treats `#` in `command` as a comment, so `--message "PR #1"` was cut to `PR`; changed to `PR-<n>`.)
  - Triggers: `push` to `main` (production), `pull_request` (build + preview upload).
  - Steps: checkout → `actions/setup-node@v4` (node 22, npm cache) → `npm ci` → `npm run lint` / `npm test` if present → `npm run build` with `PUBLIC_*` env from secrets/vars.
  - `main`: `cloudflare/wrangler-action@v3` with `command: deploy`, `apiToken`, `accountId`, and `wranglerVersion` pinned to the version in `package.json`.
  - PR: `command: versions upload --message "PR #${{ github.event.number }}"` runs only when `github.event.pull_request.head.repo.full_name == github.repository`, because fork PRs get no secrets.
  - `concurrency: { group: deploy-production, cancel-in-progress: false }` so two merges can't race each other.
- [ ] 👤 Branch protection on `main`: require the PR plus a passing build check.
- [ ] 👤 GitHub notifications for failed workflow runs are turned on. The pre-mortem found that CI failures went unnoticed.
- [x] 🤖 Open a test PR. The build passes and a preview version is uploaded. (PR #1, 2026-09-17: `verify` pass 1m24s, `smoke` pass 2m51s, `preview-upload` pass 44s, `deploy-production` skipped as expected. Version `264d49a8…` uploaded; production stayed at 100% on `71d3d4fb…`.)
- [ ] 👤 Merge. The production deploy succeeds and `wrangler deployments list` shows the new version.
- [ ] ⚠️ If the dashboard's **Workers Builds** (Cloudflare Git integration) was also connected, disconnect it. Two deploy pipelines racing each other is a classic drift problem.

## Phase 9 — Operability and handover

- [ ] 🤖 README "Deploy & operate" section: required secrets, deploy/rollback/tail commands, and who approves what.
- [ ] 👤 Cloudflare notifications (email) for Worker errors/usage. Watch the CPU-time metric for the first week.
- [ ] 👤 Supabase: check the pause policy, usage (storage quota), and whether backups are on (PITR is paid only).
- [ ] 🤖 Save anything surprising from this run to `context/foundation/lessons.md` with `/10x-lesson`.
- [ ] 👤 Set `status: executed` in this file's frontmatter and record the production URL.

---

## Edge cases and extra support steps

**E1 — `Dynamic require of "stream" is not supported` (@supabase/ssr)**
- Cause: Node compatibility isn't enabled, or `compatibility_date` is older than 2026-08-04 ([supabase#37592](https://github.com/supabase/supabase/issues/37592)).
- Fix: add `"compatibility_flags": ["nodejs_compat"]` and a current `compatibility_date`, then rebuild. If it keeps happening, make sure you're on the latest `@supabase/ssr` and not importing `@supabase/supabase-js/dist/main` directly.

**E2 — `require is not defined` / `MessageChannel is not defined` at build or run time**
- Cause: a CommonJS dependency or the React server renderer is bundled for the wrong target ([astro#15796](https://github.com/withastro/astro/issues/15796), fixed upstream).
- Fix: run `npx @astrojs/upgrade` so Astro, the adapter and `@astrojs/react` are upgraded together. Don't mix majors.

**E3 — `astro dev` crash: `Unexpectedly unable to find a component instance for route /`**
- Cause: workerd panics on an unresolved module specifier, often a path alias ([astro#17868](https://github.com/withastro/astro/issues/17868)).
- Fix, in this order:
  1. Define aliases in `tsconfig.json` only.
  2. Set `vite.ssr.optimizeDeps.noDiscovery: true`.
  3. Use relative imports for island components.
  4. Delete `node_modules/.vite` and restart.

**E4 — Deploy error about a missing `SESSION` KV binding**
- Fix: create the namespace (Phase 3), or set the adapter's `sessionKVBindingName` / session driver to match. Don't delete the binding while `Astro.session` is still used anywhere.

**E5 — Worker name mismatch (secrets "vanish" after deploy)**
- Cause: the secrets were set on a Worker whose `name` differs from `wrangler.jsonc` (for example, a Worker created in the dashboard).
- Fix: run `npx wrangler secret list --name thisorthat`, then set the secrets again on the correct name. 👤 Delete the stray Worker in the dashboard, since that's irreversible.

**E6 — Supabase project paused or unreachable**
- Symptom: every SSR request fails with fetch errors or timeouts, and the Worker itself is fine.
- Fix: 👤 restore it in the Supabase dashboard (or with the `restore_project` MCP tool, after your approval). Before launch, either upgrade or make sure there's regular activity.

**E7 — Error 1102 / CPU time exceeded (Free plan, 10 ms)**
- Confirm with `wrangler tail` and the dashboard CPU-time metric.
- Fix: move heavy work to client islands, batch Supabase queries into an RPC, prerender static pages (`export const prerender = true`).
- If that's not enough: 👤 upgrade to Workers Paid ($5/mo) and set `"limits": { "cpu_ms": 50 }`.

**E8 — Login works locally but not in production (redirect loop / no session)**
- Check:
  1. The Supabase Redirect URLs include the production origin with `/**`.
  2. Cookies are `secure` (production is HTTPS; localhost isn't).
  3. Middleware writes the refreshed cookies onto the response.
  4. Only one production origin is in use, since `workers.dev` and the custom domain don't share cookies.

**E9 — Client bundle has `undefined` Supabase URL/key**
- Cause: the `PUBLIC_*` values weren't present **at build time** in CI. Workers secrets alone don't help here.
- Fix: pass them as `env:` on the GitHub Actions build step (Phase 8).

**E10 — Bad release in production**
1. 🤖 `npx wrangler rollback --message "<reason>"` (you'll be asked to confirm; pass `-y` only in approved automation).
2. ⚠️ Rollback **does not** revert Supabase migrations. Write a forward-fix migration (👤 approval for anything destructive).
3. Record the incident in `lessons.md`.

**E11 — Rotating a leaked key**
1. 👤 Create a new key in Supabase or Cloudflare.
2. `wrangler secret put` / `gh secret set` with the new value.
3. Redeploy.
4. 👤 Revoke the old key. Never revoke before the new one is live.

**E12 — Public preview URLs expose unfinished studies**
- Keep `preview_urls: false` until 👤 Cloudflare Access (Zero Trust, free up to 50 users) protects `*.workers.dev`. Then turn previews back on for PRs.

---

## Human-only actions (never automated)
- Creating accounts and API tokens, and setting or rotating secret values
- DNS and custom-domain changes
- Deleting a Worker, KV namespace, Supabase project, bucket or table, and running destructive migrations
- Merging to `main` (the production deploy trigger)
- Upgrading plans and anything related to billing

## References
- Astro Cloudflare adapter docs: https://docs.astro.build/en/guides/integrations-guide/cloudflare/
- supabase/supabase#37592: https://github.com/supabase/supabase/issues/37592
- withastro/astro#15796: https://github.com/withastro/astro/issues/15796
- withastro/astro#15237 (`Astro.locals.runtime.env` removed): https://github.com/withastro/astro/issues/15237
- withastro/astro#17868: https://github.com/withastro/astro/issues/17868
