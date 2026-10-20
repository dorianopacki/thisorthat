# Repository Guidelines

ThisOrThat is a preference-testing MVP (A/B studies with per-voter invite links) built on the 10x Astro Starter: Astro SSR, React islands, TypeScript, Tailwind v4 and Supabase, deployed to Cloudflare Workers. Requirements: @context/foundation/prd.md. Architecture detail: @CLAUDE.md.

## Hard Rules

- Server code runs in workerd, not Node; use only APIs available under `nodejs_compat` (@wrangler.jsonc).
- Declare new env vars in the `env.schema` of @astro.config.mjs and import them from `astro:env/server`; never read `process.env`. Add values to both `.env` and `.dev.vars`.
- `createClient()` from `@/lib/supabase` returns `null` when Supabase is unconfigured; every caller must handle that branch.
- `set:html` in `.astro` files is an ESLint error.
- Never write to `context/archive/`.

## Project Structure

- `src/pages/` routes; `src/pages/api/` form endpoints that respond with redirects and pass errors via `?error=`.
- `src/components/` Astro and React components; `src/components/ui/` shadcn/ui (@components.json); `src/lib/` Supabase client and `cn()`.
- `src/middleware.ts` sets `locals.user` and protects routes by `context.routePattern`; classify every new file under `src/pages/` in `src/lib/route-access.ts` (`author` / `participant` / `public`) — `npm run test:unit` fails otherwise.
- `supabase/` local Supabase config; `scripts/smoke.mjs` auth smoke test; `context/` PRD, tech-stack hand-off, change logs.

## Commands

- `npm run dev` — dev server on workerd at http://localhost:4321.
- `npm run lint` / `npm run lint:fix` — type-checked ESLint.
- `npx astro check` — type-check `.astro` files.
- `npm run build` — production build.
- `npx supabase start` — local Supabase stack (Docker).
- `npx supabase test db` — pgTAP database tests in `supabase/tests/` (Docker; stack must be running).
- `npx supabase migration new <name>` — new migration in `supabase/migrations/`; forward-fix only, never edit a committed migration. Then regenerate types: `npx supabase gen types typescript --local > src/lib/database.types.ts` (run from Git Bash so the file is UTF-8) and `npx prettier --write` it.
- `npm run smoke` — auth-flow check against a running server (`BASE_URL`).
- `npm run test:unit` — Vitest unit tests in `tests/unit/` (no server).
- `npm run test:http` — Vitest HTTP tests in `tests/http/` against a running build: `npm run build && npm run preview`, then `BASE_URL=http://localhost:4321 npm run test:http` (local Supabase must be running).

## Coding Style

- Prettier (@.prettierrc.json): 2 spaces, double quotes, semicolons, 120 columns, Tailwind class sorting.
- ESLint `strictTypeChecked` (@eslint.config.js): prefix intentionally unused vars with `_`; `no-console` warns outside `scripts/`.
- Use the `@/*` alias for imports from `src/`.
- React components are PascalCase `.tsx`: default export for page-level islands (`SignInForm`), named exports for building blocks (`FormField`). Hydrate islands explicitly, e.g. `client:load`.

## UI / Design Tokens

- The app has one dark theme. Tokens live in `src/styles/global.css` (`:root` + `@theme inline`); values and contrast ratios are documented in `context/changes/brand-palette-dashboard/palette.md` (after archiving: `context/archive/…-brand-palette-dashboard/palette.md`).
- Components live in `src/components/ui/` (shadcn/ui). Check that folder before building a new one; add missing ones with `npx shadcn@latest add <name>`.
- In `.astro` files style links and badges with `buttonVariants` / `badgeVariants` (from `@/components/ui/button` and `@/components/ui/badge`) instead of hand-written classes.
- No colour literals (hex, `rgb(`, `oklch(`, `text-purple-300`, `bg-white/10`) or arbitrary values (`-[3px]`) in views; use roles such as `bg-primary`, `bg-card`, `text-muted-foreground`, `border-border`, `ring-ring`.
- Links on the dark background use `text-link`; `brand-1/2/3` are for gradients and decoration only, never for text.
- `tests/unit/design-tokens.test.ts` scans the cleaned views; add every view you move to tokens to its `CLEANED_FILES` list.

## Testing

Database guarantees (author isolation, vote anonymity, `cast_vote` behaviour) are pgTAP suites in `supabase/tests/`, run with `npx supabase test db` (Docker required); CI runs them in @.github/workflows/ci.yml. CI's `ci-passed` job aggregates all checks and gates deploys; merge a PR only when `gh pr checks` shows `ci-passed` passing (branch protection is unavailable on this plan). Any schema change ships as a new forward-fix migration (`npx supabase migration new`) with matching tests and an update to @docs/reference/contract-surfaces.md. Route access (anonymous matrix, encoded paths, author B against author A's ids) is covered by the Vitest suites `tests/unit/` and `tests/http/`; how to add a case for a new route: @context/foundation/test-plan.md §6.2. There is no e2e suite yet. Before finishing a change, run `npm run lint`, `npx astro check` and `npm run build`. Run `npm run smoke` after touching auth or dependencies.

## Commits & Pull Requests

The Husky pre-commit hook runs `lint-staged`; CI runs on pushes and PRs to `main` (merge rule: see Testing).

## Security & Configuration

`.env` and `.dev.vars` are gitignored; copy @.env.example. Set production secrets with `npx wrangler secret put`.
