# S-08 Image Variants — Plan Brief

> Full plan: `context/changes/image-variants/plan.md`
> Research: `context/changes/image-variants/research.md`

## What & Why

Authors compare not only wording but also graphics (FR-003: "kilka wariantów tekstowych lub graficznych"). S-08 lets an author add image variants instead of or alongside text, and a participant sees them on a phone. The PRD forbids exposing unpublished images to anyone but the author and holders of a valid link (`prd.md:110`).

## Starting Point

Variants are text-only throughout: the DB check, the `text[]` RPC inputs, the ballot/results JSON contracts, the parsers, the renderers and a urlencoded form. Supabase Storage is enabled but unused, CI runs without the storage API, the app holds only the publishable key, and participants have no Supabase session (they reach data only through the `anon` definer RPC `get_ballot`).

## Desired End State

In the wizard, each variant is "Tekst" or "Grafika". An image variant needs a file and a 1–200 character description, and the browser shrinks the file to a 1600 px edge and ≤ 1 MiB WebP/JPEG. Images sit in a private bucket. The participant ballot on an active study shows them full width on a phone through 10-minute signed URLs. Once the study closes, only the author still sees them (in results). Edit and delete leave no orphaned files.

## Key Decisions Made

| Decision                 | Choice                                                                                           | Why (1 sentence)                                                                        | Source                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | -------------------------------------- |
| Participant image access | Secret key on the server + signed URLs (600 s), signed only after `get_ballot` accepts the token | CDN-served bytes, no Worker CPU per image, and access ends exactly when the ballot does | Plan                                   |
| Author access            | Author's own session; `storage.objects` policies on `owner_id = auth.uid()`                      | Mirrors table RLS, and the author id stays out of signed URLs                           | Plan (research)                        |
| Variant shape            | Text **or** image; studies may mix                                                               | Matches "zamiast lub obok" with one DB check                                            | Plan                                   |
| Description              | Required, 1–200 chars, stored in `content`; it is the alt text and the radio's name              | Accessibility, stable E2E locators, minimal contract change                             | Plan                                   |
| File limits              | Browser resize to a 1600 px edge, WebP (JPEG fallback), ≤ 1 MiB; input JPEG/PNG/WebP ≤ 10 MiB    | Avoids the "full-size originals" pre-mortem on the free quota                           | Plan (roadmap OQ 2)                    |
| After close              | Participants lose access; the author keeps it in results                                         | Keeps "closed = unknown token" (contract-surfaces)                                      | Plan                                   |
| Storage key              | `<uuid>.webp                                                                                     | jpg`in`variant-images`, referenced by `variants.image_path` (unique)                    | Variant ids change on every draft edit | Research |
| Upload transport         | Multipart form POST through the existing create/update routes                                    | Fits the native form pattern; no new route to classify                                  | Plan                                   |
| Phone test               | Playwright `mobile-chrome` (Pixel 7) project for one new spec                                    | Automates NFR §mobile without doubling the suite                                        | Plan                                   |

## Scope

**In scope:** schema/bucket/policies migration; `jsonb` variant RPCs; ballot/results contract keys; CI storage; the wizard image field with browser resize; server sniff/validation; upload, cleanup on failure/edit/delete; author thumbnails; secret-key signing module behind an import guard; phone ballot rendering; results images; pgTAP/unit/HTTP/E2E coverage.

**Out of scope:** mixed text+image in a single variant; participant access after close; server-side image transforms; an orphan sweep for crashed requests; an image proxy route; a mobile run of the existing specs; PNG transparency.

## Architecture / Approach

Author request (multipart) → the Worker sniffs and validates → uploads with the **author's session** to the private bucket → calls `create_study`/`update_study_draft` with `jsonb` variants, which check ownership and existence of each path in `storage.objects` → on failure, removes the new uploads; after an edit, removes the unreferenced ones. Participant `/v/[token]` → `get_ballot` (anon, definer) → only if non-null, `signParticipantImagePaths` (the **only** user of `SUPABASE_SECRET_KEY`) → the `<img>` loads from the Supabase CDN. Author pages sign with their own session (3600 s), once per SSR; results polling never re-signs.

## Phases at a Glance

| Phase                           | What it delivers                                                                                   | Key risk                                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1. Database and storage         | Bucket and policies, `kind`/`image_path`, `jsonb` RPCs, contract keys, CI storage, pgTAP isolation | Contract change across RPCs; temporary `text[]` wrappers bridge the push→deploy gap and are dropped in a follow-up migration |
| 2. Author: upload, edit, delete | Wizard image field, browser resize, multipart upload, cleanup, thumbnails                          | Orphaned objects across the upload → RPC → cleanup ordering                                                                  |
| 3. Participant and results      | Secret key, signing after `get_ballot`, phone ballot, results images                               | Secret key misuse; signing before the token check would leak images                                                          |
| 4. E2E on a phone               | Pixel 7 project + image ballot spec                                                                | Flaky image-load assertions; must wait for state, not time                                                                   |

**Prerequisites:** S-01 and S-02 are done. Production needs a manual `supabase db push` for Phase 1 and `wrangler secret put SUPABASE_SECRET_KEY` before the Phase 3 deploy.
**Estimated effort:** ~3–4 sessions across 4 phases (Phase 2 is the largest).

## Open Risks & Assumptions

- Assumes Supabase Free in production (no image transforms); the browser does all resizing.
- Safari versions that cannot encode WebP fall back to JPEG; quality may degrade on detailed banners near the 1 MiB cap.
- A signed URL can be forwarded for up to 10 minutes after the ballot loads, which the PRD's access rule accepts as within "holders of a valid link".
- The storage insert policy lets any signed-in user upload unreferenced objects (≤ 1 MiB, declared webp/jpeg, not sniffed) straight to the bucket with supabase-js. Without an orphan sweep these count against the free quota. This is accepted for the MVP: participants are only ever signed referenced paths.
- The Cloudflare Workers request-body limit was not confirmed in the docs consulted. The plan keeps a request at ≤ 6 MiB of images, well below the documented 128 MB Worker memory.

## Success Criteria (Summary)

- An author can build, edit and delete a mixed text/image study, and no files are left behind.
- A participant with a valid link to an active study sees the images on a phone and votes on them. With a closed, deleted or unknown link, no image is reachable.
- Author B and anonymous users cannot list, read, sign or reference author A's images (pgTAP + HTTP).
