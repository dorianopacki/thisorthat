# Test stack

## E2E

<!-- Written by /10x-e2e-setup. Re-run it to change this section; other skills only read it. -->

- runner: Playwright Test, @playwright/test 1.63.0
- config: playwright.config.ts
- single-spec command: npx playwright test tests/e2e/<name>.spec.ts
- full-suite command: npx playwright test
- base URL: http://localhost:4321
- port: 4321 (detected from the `astro preview` default — astro.config.mjs sets no server.port; detected default 4321, override with E2E_PORT)
- web server command: npm run build && npm run preview -- --port $E2E_PORT; reuseExistingServer outside CI
- auth setup project: setup (tests/e2e/auth.setup.ts), credentials from E2E_USERNAME / E2E_PASSWORD in .dev.vars (local Supabase only; never .env, which may point at the hosted project)
- E2E user provisioning: `npx supabase db reset` wipes auth.users, and the setup then fails with „Invalid login credentials”. Re-create the user via the local auth admin API with the service role key from `npx supabase status -o env`: `POST http://127.0.0.1:54321/auth/v1/admin/users` (headers `apikey` + `Authorization: Bearer <SERVICE_ROLE_KEY>`, body `{"email": "<E2E_USERNAME>", "password": "<E2E_PASSWORD>", "email_confirm": true}`), or add the user in Studio (http://127.0.0.1:54323 → Authentication, auto-confirm)
- Windows: a running `astro preview` locks `dist/`, so `npm run build` fails with EPERM. Stop it first with `npx astro preview stop`
- storageState: playwright/.auth/user.json (gitignored)
- seed: tests/e2e/seed.spec.ts — protects #1: an author page is reachable without signing in, or the session cookie behaves differently on the Workers runtime than locally
- browser CLI: playwright-cli, command skill at .claude/skills/playwright-cli/SKILL.md
- updated: 2026-10-15
