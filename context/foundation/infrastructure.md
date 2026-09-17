---
project: thisorthat
researched_at: 2026-09-16
recommended_platform: Cloudflare Workers (static assets + SSR)
runner_up: Netlify
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro + React islands (10x Astro Starter), Supabase (external)
  runtime: Cloudflare workerd (@astrojs/cloudflare adapter)
---

## Recommendation

**Deploy on Cloudflare Workers (with static assets), not Cloudflare Pages.**

The stack was already selected with Cloudflare as its deployment target, the developer is familiar with Cloudflare, and cost minimization is the top priority — Workers Free (100k requests/day) covers MVP traffic of 10k–100k requests/month at $0. Cloudflare passed all four heavily-weighted criteria (CLI, managed runtime, agent-readable docs, deterministic deploy + `wrangler rollback`). Realtime (FR-013) runs browser → Supabase directly, so the platform needs no persistent connections, and single-region (Poland/EU) traffic removes any disadvantage of an edge-only runtime. Workers is preferred over Pages because Cloudflare steers new projects to Workers and current `@astrojs/cloudflare` majors target Workers by default.

## Platform Comparison

Interview constraints: persistent connections — don't know (realtime handled by Supabase, so no hard filter applied); cost — minimize; familiarity — Cloudflare; geography — single region; co-location — external providers fine.

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | MVP cost | Rank |
|---|---|---|---|---|---|---|---|
| Cloudflare Workers | Pass | Pass | Pass | Pass | Partial | $0 (Paid $5/mo if CPU limit hit) | 1 |
| Netlify | Partial | Pass | Pass | Pass | Pass | $0–9/mo | 2 |
| Vercel | Pass | Pass | Pass | Pass | Pass | $0 non-commercial only; Pro $20/mo | 3 |
| Railway | Partial | Pass | Pass | Pass | Pass | $5–40/mo, no free tier | 4 |
| Render | Pass | Pass | Pass | Pass | Pass | ~$25–40/mo (workspace fee since Apr 2026) | 5 |
| Fly.io | Pass | Partial | Pass | Pass | Partial | $5–15/mo, no free tier | 6 |

- **Cloudflare** — `wrangler deploy` / `rollback` / `tail` are GA; per-product `llms.txt` and markdown pages; `nodejs_compat` default-on from compatibility date 2026-08-04. MCP scored Partial: Cloudflare-managed remote MCP servers exist but the remote MCP ecosystem is still evolving (2026). Won on cost and familiarity weights.
- **Netlify** — GA Astro adapter, `netlify logs` (2026), official GA MCP server, `llms.txt`. CLI Partial: no dedicated rollback subcommand (UI/API "publish deploy"). No WebSockets (not needed). EU function region likely paid-tier only. Credit-based free plan (300 credits) workable at low end.
- **Vercel** — Official Astro hosting partner, mature CLI (`rollback`, `promote`, `logs`), GA MCP server, `llms.txt`. Penalized on cost: Hobby is non-commercial only; default function region is iad1 (US) — must be pinned to EU. WebSockets public beta (June 2026, not needed).
- **Railway** — Strong GA remote MCP (April 2026), `llms.txt`. CLI Partial: rollback to arbitrary deployment is dashboard-only. No free tier; Railpack builder is beta; EU region may be Pro-gated for Hobby.
- **Render** — All criteria pass (GA MCP, `llms.txt`, rollbacks, deploy hooks), but heavily penalized on cost: free web services spin down after 15 min (~50 s cold start), free Postgres expires after 30 days, and a mandatory workspace fee was added in April 2026.
- **Fly.io** — Mature `flyctl`, but requires owning a Dockerfile (`fly launch` Astro detection bug), no free tier since Oct 2024, `fly mcp server` explicitly experimental, autostop/WebSocket edge cases.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

$0 for MVP traffic, one-command deploy and instant rollback, excellent agent-readable docs, and the starter already targets it. Astro 6+ dev server runs on real `workerd`, giving high local/production parity. Developer familiarity reduces ramp-up during a three-week after-hours timeline.

#### 2. Netlify

Equally low-friction for Astro SSR with an official GA MCP server and free tier. Scored below Cloudflare because rollback is not a CLI verb, EU function region pinning likely requires a paid plan, and there is no familiarity advantage.

#### 3. Vercel

Most polished tooling and first-class Astro support. Scored third because the Hobby plan forbids commercial use (Pro $20/mo) — conflicting with cost-minimization — and the US default region needs explicit EU configuration to sit near Supabase.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **No runtime image optimization.** `sharp` is unsupported in `workerd`, so Astro's image transforms don't work at runtime; the PRD's image variants need client-side processing before upload, Supabase image transformations (Pro plan only), or paid Cloudflare Images.
2. **10 ms CPU time per invocation on Free.** SSR rendering plus Supabase session validation and JSON parsing can exceed it on heavier pages (results view), producing error 1102 and forcing the $5/mo Paid plan.
3. **Pages → Workers drift.** `tech-stack.md` says `cloudflare-pages`, but new work should target Workers; older tutorials (`Astro.locals.runtime.env`, Pages Functions, `_routes.json`) break with current adapter majors.
4. **Network hop to Supabase on every SSR request.** Edge colo → Supabase EU adds latency per query; pages issuing several sequential queries will feel slow.
5. **Two secret stores.** Runtime secrets (`wrangler secret put`) and CI secrets (GitHub Actions) are separate and easy to desynchronize.

### Pre-Mortem — How This Could Fail

The author scaffolded the starter and followed a 2024 blog post to deploy on Cloudflare Pages. After a routine dependency bump, the adapter switched its default output to Workers and removed `Astro.locals.runtime.env`; the build failed on merge to main, and nobody noticed because CI only reported to email. Image uploads worked locally, but production served full-size originals because no transform pipeline existed, so result pages loaded multi-megabyte images and Supabase's free storage quota filled faster than expected. On launch day the author sent 100 voting links at once; the results page, doing several Supabase round-trips with heavy SSR, intermittently hit the 10 ms CPU cap and returned error 1102. Rolling back didn't help because a Supabase migration had already shipped with the release. The preview URL, left public, leaked an unfinished study. The platform itself was fine — the failure came from unpinned versions, an undecided image strategy, no CPU-budget monitoring, and no rollback plan covering the database.

### Unknown Unknowns

- `workers.dev` and preview version URLs are publicly reachable unless disabled or protected with Cloudflare Access.
- `compatibility_date` in `wrangler.jsonc` changes runtime behavior: before 2026-08-04 `nodejs_compat` must be set explicitly or `@supabase/ssr` fails with `Dynamic require of "stream" is not supported`.
- `wrangler rollback` reverts code only — Supabase migrations and storage changes are not rolled back.
- Environment access in current Astro/adapter majors is `import { env } from "cloudflare:workers"`; research reported inconsistent version pairings (Astro 6 / adapter v13 vs Astro 7 / adapter v14) — verify against the versions actually installed by the starter.
- D1 free-tier limits became enforced on 2026-09-01 — irrelevant while data stays in Supabase, but a trap if anyone "just adds D1" for caching.

## Operational Story

- **Preview deploys**: `wrangler versions upload` on each PR (GitHub Actions) produces a version preview URL; protect `*.workers.dev` previews with Cloudflare Access or disable them; fork PRs don't receive secrets, so previews run only for same-repo branches.
- **Secrets**: Supabase URL / anon key / service keys stored as Workers secrets (`wrangler secret put`) for runtime; `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` stored in GitHub Actions secrets for deploys; only the author reads them; rotate by `wrangler secret put` with the new value, then revoke the old key in Supabase/Cloudflare.
- **Rollback**: `wrangler rollback` (previous version) or `wrangler rollback <version-id> --message "<reason>"`; takes effect in seconds; database migrations must be reverted separately with a forward-fix migration in Supabase.
- **Approval**: human approves merges to `main` (production deploy), secret rotation, custom domain / DNS changes, and any Supabase schema-destructive migration; an agent may unattended run builds, preview uploads, `wrangler tail`, `wrangler deployments list`, and read-only log queries.
- **Logs**: `wrangler tail --format pretty` for live runtime logs; `wrangler deployments list` / `wrangler versions list` for release history; `gh run view --log` for pipeline logs; Workers Logs (observability enabled in `wrangler.jsonc`) for retained history.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Image variants can't be generated at runtime (`sharp` unsupported) | Devil's advocate | H | M | Decide before implementation: resize/compress in the browser before upload to Supabase Storage; set `imageService: "passthrough"` (or equivalent) in the adapter config |
| Free-plan 10 ms CPU limit exceeded on SSR results page (error 1102) | Devil's advocate / Pre-mortem | M | M | Keep results page thin (client-side fetch + Supabase Realtime); watch Workers metrics for CPU time; upgrade to Workers Paid ($5/mo) if errors appear |
| Following Pages-era tutorials breaks the build (`Astro.locals.runtime.env`, Pages Functions) | Unknown unknowns / Research finding | H | M | Deploy as a Worker with static assets; use `import { env } from "cloudflare:workers"`; pin exact Astro/adapter versions in `package.json` |
| `@supabase/ssr` fails without Node compat | Research finding | M | H | Set `compatibility_date` ≥ 2026-08-04 or add `compatibility_flags: ["nodejs_compat"]` in `wrangler.jsonc`; smoke-test login in preview |
| Rollback does not revert Supabase migrations | Unknown unknowns / Pre-mortem | M | H | Ship migrations backward-compatible (expand → contract); deploy migration separately from code; write forward-fix migrations |
| Public preview / `workers.dev` URLs expose unfinished studies | Unknown unknowns | M | M | Disable `workers_dev` for production, protect previews with Cloudflare Access |
| Runtime and CI secrets drift apart | Devil's advocate | M | M | Keep a checklist of required secrets in README; add a CI step that fails if expected bindings are missing |
| Adapter/Astro version guidance inconsistent across sources | Research finding | M | L | Verify against installed versions and official adapter CHANGELOG before writing config |
| Latency from edge → Supabase EU on multi-query pages | Devil's advocate | L | L | Batch queries / use RPCs; consider Hyperdrive only if direct Postgres access is introduced |

## Getting Started

1. After `/10x-bootstrapper`, check installed versions: `npm ls astro @astrojs/cloudflare wrangler` and read the adapter CHANGELOG for the installed major (Workers target, `cloudflare:workers` env access, image service options).
2. Authenticate and verify: `npx wrangler login`, then `npx wrangler whoami`.
3. Configure `wrangler.jsonc` for a Worker with static assets: set `name: "thisorthat"`, `compatibility_date` ≥ `2026-08-04` (or add `nodejs_compat`), enable `observability`, and set `workers_dev: false` once a custom domain is attached.
4. Add runtime secrets: `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_ANON_KEY` (plus any service key used server-side); mirror local values in `.dev.vars`.
5. First deploy and verify: `npm run build && npx wrangler deploy`, then `npx wrangler tail` while testing login, study creation, image upload and live results; confirm `npx wrangler rollback` lists the previous version.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup
- Production-scale architecture (multi-region, HA, DR)
