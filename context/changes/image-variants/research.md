---
date: 2026-10-16T23:30:25+02:00
researcher: Claude (Opus 5.5) for dorian.opacki
git_commit: 5f5bc14e4a346c1da3ec30f7a802aa90a1ae63bb
branch: feat/generate-extra-links
repository: dorianopacki/thisorthat
topic: "S-08 image-variants — current text-only variant model, private file storage options and access rules that image variants must extend"
tags:
  [
    research,
    codebase,
    variants,
    storage,
    get_ballot,
    get_study_results,
    create_study,
    update_study_draft,
    access-control,
    mobile,
  ]
status: complete
last_updated: 2026-10-16
last_updated_by: Claude (Opus 5.5)
---

# Research: S-08 `image-variants`

**Date**: 2026-10-16T23:30:25+02:00
**Researcher**: Claude (Opus 5.5) for dorian.opacki
**Git Commit**: 5f5bc14e4a346c1da3ec30f7a802aa90a1ae63bb
**Branch**: feat/generate-extra-links (research taken on this branch; `generate-extra-links` is not yet merged/archived)
**Repository**: dorianopacki/thisorthat

## Research Question

What does the codebase provide today for study variants, file storage and access control, and what must S-08 change so that an author can add image variants (instead of or alongside text, FR-003), a participant can view them on a phone (NFR §mobile), and images stay reachable only by the study's author and holders of a valid link (NFR §izolacja, `context/foundation/prd.md:110`) — with no public read from storage (`context/foundation/roadmap.md:198`)?

## Summary

- **Variants are text-only at every layer.** The table has no kind/path column and `content text not null check (char_length(btrim(content)) between 1 and 2000)` (`supabase/migrations/20261002095727_study_data_model.sql:35`). Both write RPCs take `p_variants text[]` (`…/20261015170000_study_deadline_zone_hardening.sql:92`, `…/20261015221845_edit_and_delete_study.sql:34`), both read RPCs emit `content` as a string (`…/20261015130000_study_closing_rules.sql:101`, contract pinned by `supabase/tests/get_ballot.test.sql:63-64`), and both client parsers reject non-string `content` (`src/pages/v/[token].astro:22`, `src/lib/study-results.ts:49`). The full list of text assumptions is in "Text assumptions S-08 must change" below.
- **Storage is unused and unconfigured.** `[storage] enabled = true` with a global `file_size_limit = "50MiB"` (`supabase/config.toml:109-112`); the only bucket block is a commented-out template (`:114-118`). No migration touches `storage.buckets`/`storage.objects`, and a grep of `src/` found no `.storage` call.
- **No server-side key can read a private bucket on behalf of a participant.** The only Supabase key is the publishable/anon key (`.env.example:5`, `astro.config.mjs:19-24`); no service-role key exists in the env schema, `wrangler.jsonc` or `src/` (grep of `SERVICE_ROLE|service_role` hit only `.env.example:5`). Participants have no Supabase session — `/v/[token]` calls the definer RPC `get_ballot` as `anon` (`src/pages/v/[token].astro:52`, grant `…/20261015130000_study_closing_rules.sql:116`). A `storage.objects` policy for `anon` cannot see the link token, so token-scoped image access needs either a new secret key on the server or a definer-function path. This is the central design choice for the plan (options A–D below).
- **Variant ids are not stable across draft edits.** `update_study_draft` deletes all variants and re-inserts them (`…/20261015221845_edit_and_delete_study.sql:118-123`), so storage keys tied to `variant_id` would be orphaned on every edit. Study deletion cascades only through Postgres FKs (`…/20261015221845_edit_and_delete_study.sql:18-21`); storage objects need explicit cleanup on edit and delete.
- **Runtime: no server-side image processing.** `sharp` does not run in workerd and the adapter uses `imageService: "passthrough"` (`astro.config.mjs:18`, `context/foundation/infrastructure.md:57`); the infra risk register recommends resizing/compressing in the browser before upload (`infrastructure.md:87`) and names "full-size originals served" as a pre-mortem failure (`infrastructure.md:65`). The Free plan's 10 ms CPU cap (`infrastructure.md:58`) argues against byte-handling in the Worker.
- **Open product input:** the per-study image count/size limit is unanswered (`roadmap.md:197`, `roadmap.md:223`); the roadmap allows the plan to assume a conservative limit.

## Detailed Findings

### Data model and RPCs

- Table `variants(id, study_id, position, content, unique(study_id, position), unique(id, study_id))` (`…study_data_model.sql:31-38`). `votes` and `comments` reference variants through the composite FK `(variant_id, study_id)` with cascade (`…study_data_model.sql:49-64`).
- Grants: `anon` has none; `authenticated` has `select, delete`, `insert (study_id, position, content)` and `update (position, content)` (`…study_data_model.sql:96,105-107`). A new column needs its own column grant only if direct writes are wanted; all current app writes go through RPCs.
- RLS: authors select own rows; insert/update/delete only while the parent study is `draft` (`…study_data_model.sql:142-191`).
- The 2–6 count is enforced inside the RPCs, not by a table constraint (`…/20261005075735_create_and_start_study.sql:8-9`; limits `src/lib/study-limits.ts:6-7,11`).
- Functions touching variants (latest definitions, as reported by the inspected migrations):

| Function                                                  | Definition                                                 | Mode            | Granted to            | Variant handling                                                                                          |
| --------------------------------------------------------- | ---------------------------------------------------------- | --------------- | --------------------- | --------------------------------------------------------------------------------------------------------- |
| `create_study(text,int,text[],timestamp,text)`            | `…/20261015170000_study_deadline_zone_hardening.sql:22-92` | invoker (`:31`) | authenticated (`:92`) | count 2–6, blank check, inserts `btrim(content)`                                                          |
| `update_study_draft(uuid,text,int,text[],timestamp,text)` | `…/20261015221845_edit_and_delete_study.sql:30-128`        | definer         | authenticated         | same checks; delete-all + re-insert (`:118-123`)                                                          |
| `start_study(uuid)`                                       | `…/20261016181615_generate_extra_links.sql:86-143`         | definer         | authenticated         | counts variants only                                                                                      |
| `get_ballot(text)`                                        | `…/20261015130000_study_closing_rules.sql:88-116`          | definer, stable | anon, authenticated   | `{title, variants:[{variant_id, content}]}` only when effective status is `active` (`:112`)               |
| `get_study_results(uuid)`                                 | `…/20261015130000_study_closing_rules.sql:123-168`         | definer, stable | authenticated         | per variant `{variant_id, position, content, vote_count, comments[]}`, scoped to `author_id = auth.uid()` |
| `cast_vote(text,uuid,jsonb)`                              | `…/20261015150000_study_closing_vote_path.sql:27-170`      | definer         | anon, authenticated   | uses variant ids only; content-independent                                                                |

### Author flow (create/edit)

- The wizard posts a native form with no `enctype` (urlencoded) (`src/components/studies/StudyWizard.tsx:169`); each variant is `<textarea name="variant">` (`src/components/studies/VariantField.tsx:32-34`); state is `{key, value: string}` (`StudyWizard.tsx:42-45`) with client checks at `:107-119`.
- Server parsing: `readStudyForm` reads `form.getAll("variant")` as strings with CRLF normalization (`src/lib/study-form.ts:36-50`), `validateStudyForm` repeats count/blank/length (`:65-71`), `studyRpcArgs` sends `p_variants: string[]` (`:79-86`), `studyRpcErrorMessage` maps 22023/23514 (`:89-94`).
- Endpoints: `src/pages/api/studies/index.ts:10,17` (create), `src/pages/api/studies/[id]/update.ts:16,23` (update). Every mutating API route inspected reads `request.formData()`; none reads JSON bodies.
- Edit page selects only `content` (`src/pages/studies/[id]/edit.astro:35-50`); draft page renders `{variant.content}` (`src/pages/studies/[id].astro:44-57,142-146`).

### Participant flow (ballot on a phone)

- `/v/[token]` sets `Cache-Control: no-store`, `Referrer-Policy: same-origin`, `X-Robots-Tag: noindex` (`src/pages/v/[token].astro:31-33`) and calls `get_ballot` through the server client (`:52`); no browser Supabase client is involved.
- Variants are shuffled per token by a generic Fisher–Yates (`src/lib/ballot-order.ts:27`) — type-agnostic.
- `BallotForm` renders each option as `<label>` + radio + "Wariant N" + `{variant.content}` (`src/components/voting/BallotForm.tsx:86-110`), so the radio's accessible name is the text; the E2E spec selects by that name (`tests/e2e/one-link-one-vote.spec.ts:19`). Image variants need alt text / a label to keep this working.
- Layout is a single-column card `max-w-lg p-5 sm:p-8` (`src/pages/v/[token].astro:86`); no image or aspect-ratio handling exists.
- Vote POST sends only `variant_id` and `comment:<id>` (`src/pages/api/v/[token].ts:43-67`) — unaffected.

### Results flow

- `parseStudyResults` requires string `content` (`src/lib/study-results.ts:45-56`); `StudyResults.tsx:161` renders text.
- The results island polls `/api/studies/[id]/results` every 10 s (`src/components/studies/StudyResults.tsx:6,33,65`), and the endpoint passes `get_study_results` through (`src/pages/api/studies/[id]/results.ts:14-24`). If image URLs are signed per response, they change on every poll — relevant to caching and to avoiding image re-downloads.

### Storage, keys and authorization

- Storage config and absence of buckets/policies: see Summary. Image transformation is commented out in `config.toml` and is a Pro-plan feature per `infrastructure.md:57`.
- Single client factory, cookie-based, server-only (`src/lib/supabase.ts:7-25`); middleware sets `locals.user` and gates by `requiresAuthor(routePattern)` (`src/middleware.ts:5-23`).
- Author isolation is RLS on `author_id = (select auth.uid())` (`…study_data_model.sql:123-202`); migrations revoke `anon` EXECUTE on new functions (e.g. `…/20261015221845_edit_and_delete_study.sql:23-24,127-128`).
- The link token is the participant's only credential (`study_links.token`, `…study_data_model.sql:43`).
- Anonymity invariants a participant image path must keep (`docs/reference/contract-surfaces.md:11,31`): no participant-reachable read may reveal whether a link was used, and a closed/deleted study must look like an unknown token. Because `get_ballot` returns null unless active, gating images on the same rule ends participant image access when the study closes; authors keep access via results.
- Routes: every page/route pattern must be classified in `ROUTE_AUDIENCE` (`src/lib/route-access.ts:10-33`, `/v` entries `:31-32`), enforced by `tests/unit/route-access.test.ts` and `tests/http/route-access.test.ts:89-97`. A new upload or image route must be added there.
- No CSP or global security headers are configured; the only per-response headers found are on `/v` routes.

### Access-pattern options (evidence, not a decision)

| Option                                                | How participants get images                                 | For                                                                                                    | Against                                                                                                                                                                                        |
| ----------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Private bucket + server-signed short-lived URLs    | `/v/[token]` SSR validates via RPC, then signs object paths | Bytes served by Supabase CDN, no Worker CPU per image                                                  | Signing for anon needs a secret key (none exists) or an anon `storage.objects` policy that cannot be token-scoped; signed URLs are shareable until expiry; re-signed on each 10 s results poll |
| B. Worker proxy route, e.g. `/v/[token]/img/[id]`     | Route checks token with a definer RPC, streams object       | Same rule as `get_ballot`; `no-store`/referrer headers controllable; nothing exposed but the token URL | Worker must still read the object (secret key or definer path); one Worker invocation per image; no CDN caching; new `ROUTE_AUDIENCE` entry                                                    |
| C. Storage RLS on `auth.uid()` for authors            | — (authors only)                                            | Mirrors table RLS; author's cookie session already reaches the server client                           | Does not solve participants; must be combined with A or B                                                                                                                                      |
| D. Image bytes in Postgres, returned by a definer RPC | Existing `get_ballot`-style path                            | Reuses anon + definer model, FK cascade deletes for free                                               | DB/RPC payload bloat; JSON parsing + inlining in SSR risks the 10 ms CPU cap (`infrastructure.md:58`)                                                                                          |

`context/archive/2026-10-06-testing-access-boundaries/research.md:37` already flagged that "a service-key path in S-08 storage" would be reachable anonymously if a route acts before an RLS-checked call — any option that introduces a secret key must validate token/ownership first.

### Text assumptions S-08 must change

1. DB check on `content` (`…study_data_model.sql:35`) and column grants (`:106-107`).
2. `p_variants text[]` signatures of `create_study` and `update_study_draft` — a signature change means drop + recreate, regenerated `src/lib/database.types.ts` (`:128-145,198-205,234-242`) and contract-doc updates (`docs/reference/contract-surfaces.md:75,85,138-156`).
3. Delete-and-reinsert in `update_study_draft` (`…/20261015221845_edit_and_delete_study.sql:118-123`) vs. storage object lifetime.
4. Exact JSON keys of `get_ballot` / `get_study_results`, pinned by `supabase/tests/get_ballot.test.sql:63-64` and the contract doc.
5. Urlencoded text-only author form (`StudyWizard.tsx:169`, `VariantField.tsx:32-34`, `study-form.ts:36-50,79-86`) and edit page (`edit.astro:35-50`).
6. Character-based validation messages and limits (`study-limits.ts`, `study-form.ts:65-71,89-94`).
7. String-only parsers (`v/[token].astro:22`, `study-results.ts:49`) and text renderers (`BallotForm.tsx:108`, `StudyResults.tsx:161`, `studies/[id].astro:145`).
8. Radio accessible name = text, relied on by `tests/e2e/one-link-one-vote.spec.ts:19`.

## Code References

- `supabase/migrations/20261002095727_study_data_model.sql:31-38` — `variants` table and content check
- `supabase/migrations/20261015130000_study_closing_rules.sql:88-116` — current `get_ballot`
- `supabase/migrations/20261015130000_study_closing_rules.sql:123-168` — current `get_study_results`
- `supabase/migrations/20261015170000_study_deadline_zone_hardening.sql:22-92` — current `create_study` (invoker)
- `supabase/migrations/20261015221845_edit_and_delete_study.sql:30-128` — `update_study_draft`, delete+reinsert at `:118-123`
- `supabase/config.toml:109-118` — storage enabled, no buckets
- `src/lib/supabase.ts:7-25` — only Supabase client (publishable key)
- `src/lib/study-form.ts:36-94` — server form parsing/validation/RPC args
- `src/components/studies/StudyWizard.tsx:169` — urlencoded form
- `src/components/voting/BallotForm.tsx:86-110` — ballot option rendering
- `src/pages/v/[token].astro:31-33,52,86` — participant headers, RPC call, mobile card
- `src/lib/route-access.ts:10-33` — route audience map
- `astro.config.mjs:18-24` — passthrough image service, env schema

## Architecture Insights

- All participant reads go through `SECURITY DEFINER` RPCs granted to `anon`; anon has no table privileges. Any image read path for participants should keep this shape (token validated in SQL, same `active` rule as `get_ballot`).
- All writes from the app go through RPCs; tables carry draft-only RLS as a second line.
- Mutating routes are native form POSTs parsed with `formData()`; a file upload fits that pattern only with `multipart/form-data` (or a separate upload step).
- Test layers to extend (`vitest.config.ts`, `playwright.config.ts`): pgTAP (`supabase/tests/study_isolation.test.sql`, `author_isolation_gaps.test.sql`, `study_anonymity.test.sql`, `get_ballot.test.sql`), HTTP (`tests/http/author-isolation.test.ts`, `route-access.test.ts`), E2E (`tests/e2e/`). The recipe for a new route is `context/foundation/test-plan.md:127-145`. Playwright has only a Desktop Chrome project — there is no mobile project for the phone requirement.

## Historical Context (from prior changes)

- `context/archive/2026-10-02-study-data-model/plan.md:42,233` — image variants and storage bucket explicitly deferred to S-08; F-01 added no kind column (supported by the migration at `…study_data_model.sql:31-38`).
- `context/foundation/roadmap.md:96` — F-01 risk: storage extends the schema only in its own slice. Supported.
- `context/archive/2026-10-05-create-and-start-study/plan-brief.md:35`, `…/2026-10-05-one-time-link-voting/plan-brief.md:32`, `…/2026-10-06-live-results-and-comments/plan-brief.md:40` — each deferred images to S-08.
- `context/archive/2026-10-06-testing-access-boundaries/research.md:37,139` — warns about a service-key path in S-08 and asks for the same isolation matrix on bucket policies.
- Review rules from earlier slices that apply here:
  - revoke `anon` on new functions and test it (`context/archive/2026-10-15-study-closing-rules/reviews/plan-review.md:70-86`);
  - validate identically on client, server and DB (`context/archive/2026-10-05-create-and-start-study/reviews/impl-review.md:26-52`);
  - guard the public path against malformed input (`context/archive/2026-10-05-one-time-link-voting/reviews/impl-review.md:31-82`);
  - author result pages are `no-store` (`context/archive/2026-10-06-live-results-and-comments/reviews/impl-review.md:26-34`);
  - classify every new route, including server islands (`context/archive/2026-10-06-testing-access-boundaries/reviews/impl-review.md:47-98`).
- `context/foundation/infrastructure.md:57,65,87` — client-side resize before upload; full-size originals are a named failure mode. Still applicable.

## Related Research

- `context/archive/2026-10-06-testing-access-boundaries/research.md`
- `context/archive/2026-10-15-study-closing-rules/research.md`

## Open Questions

1. **Secret key or not?** Options A and B need server-side read access to a private bucket. Introducing a Supabase secret/service-role key (new `envField`, Workers secret, second client) vs. a definer-only path. Owner: user/plan. Nothing in the repo forbids it; `.env.example:5` deliberately excludes it today.
2. **Per-study image count and size limit** (`roadmap.md:197,223`). Without an answer, the plan assumes a conservative limit.
3. **Should participants see images after close?** `get_ballot` semantics imply no; authors keep access via results. Not specified in the PRD.
4. **Supabase production plan** — decides whether image transforms are available (Pro only); `infrastructure.md` implies Free.
5. **Cloudflare Workers request-body limit for uploads** — not recorded in the repo; verify against current Cloudflare docs during planning if uploads pass through the Worker.
6. **Mixed text+image variant** — FR-003 allows "zamiast lub obok"; whether a single variant can carry both text and an image (vs. one or the other) is a product choice for the plan.
