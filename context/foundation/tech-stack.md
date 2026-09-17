---
starter_id: 10x-astro-starter
package_manager: npm
project_name: thisorthat
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: true
  has_ai: false
  has_background_jobs: false
---

## Why this stack

A solo frontend developer shipping a web app for study authors and anonymous voters in three after-hours weeks needs a starter that covers login, a database, file storage for image variants, and deployment out of the box. The 10x Astro Starter (Astro + React + TypeScript + Supabase + Cloudflare Pages) is the recommended default for web apps in JS/TS, clears all four agent-friendly gates, and matches the author's React background. Supabase covers email/password auth, per-author data isolation, image storage, and the live result updates required by FR-013. Scheduled closing (FR-016) is evaluated when a link or results page is opened, so no background jobs are needed; payments and AI are out of scope. Bootstrapper confidence is first-class, so expect occasional manual steps. CI runs on GitHub Actions with auto-deploy on merge to main.
