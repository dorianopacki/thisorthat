# S-08 Image Variants Implementation Plan

## Overview

An author can add image variants to a study instead of or alongside text variants (FR-003). A participant sees them on a phone in the ballot (NFR §mobile). The images live in a private Supabase Storage bucket and are reachable only by the study's author and by holders of a valid link while the study is active (NFR §izolacja, `context/foundation/prd.md:110`). Storage is never publicly readable (`context/foundation/roadmap.md:198`).

## Current State Analysis

- Variants are text-only at every layer: `content text not null check (char_length(btrim(content)) between 1 and 2000)` (`supabase/migrations/20261002095727_study_data_model.sql:35`), `p_variants text[]` in `create_study` / `update_study_draft`, a `{variant_id, content}` ballot contract pinned by `supabase/tests/get_ballot.test.sql:63-64`, string-only parsers, text renderers, and a urlencoded wizard form (`src/components/studies/StudyWizard.tsx:169`). Full inventory: `research.md` → "Text assumptions S-08 must change".
- Storage is enabled but unused: no bucket, no `storage.objects` policy, no `.storage` call (`supabase/config.toml:109-118`). **CI starts local Supabase with `storage-api` excluded** (`.github/workflows/ci.yml`, "Start local Supabase" step), so the storage schema and API are absent there today.
- The only Supabase key the app holds is the publishable key (`.env.example:5`, `astro.config.mjs:19-24`). Participants have no Supabase session; `/v/[token]` reads through the definer RPC `get_ballot` as `anon` (`src/pages/v/[token].astro:52`).
- `update_study_draft` deletes and re-inserts all variants, so variant ids change on every draft edit (`supabase/migrations/20261015221845_edit_and_delete_study.sql:118-123`). Study deletion cascades only through Postgres FKs.
- The runtime cannot transform images (`astro.config.mjs:18` passthrough; `context/foundation/infrastructure.md:57`), and the Free plan has a 10 ms CPU cap (`infrastructure.md:58`).

## Desired End State

- In the wizard and on the draft edit page, an author picks "Tekst" or "Grafika" for each variant. An image variant takes a JPEG/PNG/WebP file and a required description of 1–200 characters. Before submit, the browser scales the image to a 1600 px long edge and encodes it as WebP (JPEG fallback) at ≤ 1 MiB. Text and image variants can be mixed, 2–6 variants in total.
- Files are stored in the private bucket `variant-images` as `<uuid>.webp|jpg`, owned by the author (`owner_id`). Authors upload, read and delete through their own session.
- On an active study, `/v/[token]` shows each image variant as a full-width image whose alt text is the description; the radio's accessible name is the description. The image URLs are Supabase signed URLs with a 600 s TTL, created on the server with `SUPABASE_SECRET_KEY` **only after** `get_ballot` returned a ballot. For a closed, deleted or unknown token, no image URL is issued.
- The draft page, edit page and results page show image variants through signed URLs created with the author's session.
- Edit and delete leave no orphaned objects on the success path. Uploads made by a request whose RPC fails are removed.
- A Playwright `mobile-chrome` (Pixel 7) project runs an image-ballot spec end to end.

Verify: `npx supabase test db`, `npm run test:unit`, `npm run test:http`, `npx playwright test`, plus the manual checks per phase.

### Key Discoveries:

- Supabase private buckets serve files only through a JWT-authorized download or a signed URL, and signing requires SELECT permission under `storage.objects` RLS (Supabase docs: Storage → Buckets → Access model; Storage → Access control).
- `storage.objects.owner_id` is set to the uploader's `auth.uid()`, so ownership policies need no folder convention and the object name need not contain the author id. The name ends up inside participant-visible signed URLs, so it must not reveal the author.
- `context/archive/2026-10-06-testing-access-boundaries/research.md:37`: a secret-key path in S-08 must act only after a check against RLS or a token.
- Review rules that apply here: revoke `anon` on new or recreated functions and test it (`context/archive/2026-10-15-study-closing-rules/reviews/plan-review.md:70-86`); validate identically on client, server and DB (`context/archive/2026-10-05-create-and-start-study/reviews/impl-review.md:26-52`); classify every new route (none planned here).
- A contract change needs a forward-fix migration, regenerated types (`npx supabase gen types typescript --local > src/lib/database.types.ts`) and updated pgTAP tests (`docs/reference/contract-surfaces.md:3`).

## What We're NOT Doing

- No variant carrying both text and an image; no study-level "all images" mode.
- No participant access to images after a study closes, and no read-only view of a closed ballot for participants.
- No server-side image processing, Supabase image transformations or Cloudflare Images.
- No periodic sweep for orphaned objects left by crashed requests (only success and RPC-failure paths clean up).
- No proxy route for images and no new route in `ROUTE_AUDIENCE`.
- No mobile run of the existing E2E specs (that stays in test-plan rollout Phase 4).
- No changes to `cast_vote`, `start_study`, `close_study`, `add_study_links` or `list_author_studies`.
- No preservation of PNG transparency (the image is flattened when the browser encodes it as JPEG).

## Implementation Approach

The work goes database first, so the contract is settled and tested before any UI depends on it. Phase 1 changes the schema, functions and storage rules, and adapts the app only enough to keep text studies working. Phase 2 adds the author's upload path, which needs no secret key. Phase 3 introduces the secret key, used only for participant signing and placed behind a narrow module. Phase 4 adds phone-level E2E coverage.

## Critical Implementation Details

- **Secret key ordering.** `SUPABASE_SECRET_KEY` is used in exactly one place: signing participant image paths in `/v/[token]` after `get_ballot` returned non-null. The admin module exports only a signing function, never a client, and a unit test pins its single importer.
- **Upload → RPC → cleanup ordering.** New files are uploaded before the RPC, because the RPC checks that each `image_path` exists and is owned by the caller. If the RPC fails, the request removes the files it just uploaded. After a successful `update_study_draft`, it removes the paths that were present before but are no longer referenced. Delete reads the study's image paths before deleting the row and removes the objects after the delete succeeds.
- **Polling must not re-sign.** The results island polls every 10 s (`src/components/studies/StudyResults.tsx:6,33,65`). Image URLs are signed once in SSR and passed in keyed by `variant_id` (variants cannot change after start); polled `image_path` values are ignored for rendering.
- **CI storage.** `storage-api` must be removed from the `supabase start -x` exclusion list, or any migration that touches `storage.*` fails in CI.

## Phase 1: Database and storage

### Overview

Add the bucket, its storage policies, the variant kind/image columns, `jsonb` variant input for create and update, and `kind`/`image_path` in the ballot and results output. Adapt the app minimally so text studies behave exactly as before.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_image_variants.sql`

**Intent**: Introduce the schema, storage and function changes in one forward migration that follows the repo's grant/revoke conventions.

**Contract**:

- Enum `public.variant_kind ('text','image')`; `variants.kind variant_kind not null default 'text'`; `variants.image_path text null`.
- Check: `(kind = 'text' and image_path is null) or (kind = 'image' and image_path ~ '^[0-9a-f-]{36}\.(webp|jpg)$' and char_length(btrim(content)) <= 200)`. The existing 1–2000 `content` check stays, so the description is 1–200.
- Partial unique index on `variants(image_path) where image_path is not null`, so one object cannot back two variants or two studies.
- Column grants extended to `kind` and `image_path` for insert/update by `authenticated` (draft-only RLS still applies).
- Bucket `variant-images`: `public = false`, `file_size_limit = 1048576`, `allowed_mime_types = {image/webp,image/jpeg}`. It is created by `insert into storage.buckets`, not by `config.toml`, so local, CI and prod share one source.
- `storage.objects` policies, all scoped to `bucket_id = 'variant-images'`, `to authenticated` only:
  - insert, with a check that the name matches the same pattern;
  - select and delete `using (owner_id = (select auth.uid()::text))`.

  There is no update policy and nothing for `anon`.

- `create_study` and `update_study_draft` gain `p_variants jsonb` overloads (an array of `{kind, content, image_path}`). The existing `text[]` signatures stay as thin `security invoker` wrappers that map each element to `{kind:'text', content, image_path:null}` and call the `jsonb` version, so the live app keeps working whichever lands first, `db push` or deploy. They keep their current grants (revoked from `public, anon`) and are dropped in a follow-up migration (see Migration Notes). The `jsonb` functions:
  - keep the 2–6 count check, the CRLF/blank handling and the existing error codes;
  - per element, validate `kind`, the content length for that kind, and that `image_path` is null for text;
  - for image variants, require the path to exist in `storage.objects` with `bucket_id = 'variant-images'` and `owner_id = auth.uid()::text`;
  - explicitly reject a duplicate `image_path`, both within the payload and against variants of any other study (`update_study_draft` excludes its own study, whose variants it is about to replace), raising `23514`. The partial unique index stays as a backstop, but its `23505` must never be the user-facing path;
  - raise `23514` on any variant-shape violation.

  `create_study` stays `security invoker` and `update_study_draft` stays `security definer`. Revoke from `public, anon`; grant to `authenticated`.

  > **Implementation note (2026-10-17):** PostgREST picks an overload by argument names only. If two overloads share every name, the call fails with PGRST203. The `jsonb` overloads therefore name the parameter `p_variant_items jsonb`, while the `text[]` wrappers keep `p_variants`. `studyRpcArgs`, the types and `contract-surfaces.md` use `p_variant_items`. Wherever this plan says `p_variants jsonb`, read it as `p_variant_items`.

- `get_ballot` and `get_study_results` are recreated with per-variant keys `kind` and `image_path` added. All other keys and the gating rules stay unchanged. Grants are as before.

#### 2. CI storage

**File**: `.github/workflows/ci.yml`

**Intent**: Run the storage API in CI so storage migrations, policies and later HTTP tests work.

**Contract**: Remove `storage-api` from the `npx supabase start -x …` list. `imgproxy` stays excluded.

#### 3. Types and contract docs

**Files**: `src/lib/database.types.ts`, `docs/reference/contract-surfaces.md`

**Intent**: Regenerate the types and record the new shapes as load-bearing contracts.

**Contract**:

- Update the `create_study` and `update_study_draft` headings and their variant-element shape.
- Update the `get_ballot` and `get_study_results` key lists.
- Add a `## Storage: variant-images` section covering the bucket, policies, naming, the TTLs (participant 600 s, author 3600 s) and the secret-key ordering rule.
- Add the image limits to `## Limits`.

#### 4. Minimal app adaptation

**Files**: `src/lib/study-form.ts`, `src/pages/v/[token].astro`, `src/lib/study-results.ts`

**Intent**: Keep text studies working against the new contracts, without UI changes yet.

**Contract**:

- `studyRpcArgs` sends `p_variants` as `[{kind:'text', content, image_path:null}]`.
- `parseBallot` and `parseStudyResults` accept the added keys and still require string `content`.

#### 5. pgTAP

**Files**: `supabase/tests/get_ballot.test.sql` (exact-key pin at 41-73), `supabase/tests/study_anonymity.test.sql` (exact results-variant key count at 111-130, 5 → 7), `supabase/tests/create_and_start_study.test.sql`, `supabase/tests/study_deadline.test.sql` and `supabase/tests/edit_and_delete_study.test.sql` (their `text[]` calls keep working through the wrappers; add `jsonb` cases; the `has_function_privilege(... text[] ...)` assertion at `edit_and_delete_study.test.sql:133` stays until the wrappers are dropped), new `supabase/tests/image_variants.test.sql`

**Intent**: Pin the new contracts and the storage isolation matrix.

**Contract**:

- Pin the new ballot keys exactly as `{variant_id, kind, content, image_path}`.
- The variant check rejects:
  - a text variant with a path;
  - an image variant without a path;
  - a description longer than 200 characters;
  - a malformed path.
- `create_study` and `update_study_draft` raise `23514` when author B references A's object, a missing object, or a path already used by another variant.
- Storage isolation:
  - B selects 0 of A's `variant-images` rows;
  - B's delete removes nothing. Storage's `protect_objects_delete` trigger raises 42501 on any direct SQL `DELETE`, so the test first runs `set local storage.allow_delete_query = 'true'` inside its transaction and then asserts 0 affected rows. App code never deletes objects with SQL; cleanup goes only through the Storage API (`remove`);
  - `anon` sees no rows.
- `anon` cannot execute either new write RPC, nor the `text[]` wrappers.
- The `text[]` wrappers still create and update a text-only study.
- Fixture objects are inserted as superuser with an explicit `owner_id`.

### Success Criteria:

#### Automated Verification:

- Migration applies on a fresh local stack: `npx supabase db reset`
- pgTAP suite passes, including `image_variants.test.sql`: `npx supabase test db`
- Types regenerate with no diff after commit: `npx supabase gen types typescript --local > src/lib/database.types.ts`
- Static checks pass: `npm run lint && npx astro check && npm run build`
- Existing HTTP and unit suites pass unchanged: `npm run test:unit && npm run test:http`

#### Manual Verification:

- In local Studio, `variant-images` is private with a 1 MiB limit and webp/jpeg MIME types only
- Creating, editing and starting a text-only study in the UI behaves exactly as before

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Author: upload, edit, delete

### Overview

Authors create and edit studies with image variants. Files are resized in the browser, validated on the server and uploaded with the author's session, and objects are cleaned up on failure, edit and delete. The draft and edit pages show image variants.

### Changes Required:

#### 1. Limits and file checks

**Files**: `src/lib/study-limits.ts`, new `src/lib/image-file.ts`

**Intent**: One set of named limits shared by client and server, plus a server-side content sniff that does not trust the declared MIME type.

**Contract**:

- Limits: `MAX_IMAGE_BYTES = 1_048_576`, `MAX_IMAGE_INPUT_BYTES = 10_485_760` (client pre-check only), `MAX_IMAGE_EDGE = 1600`, `MAX_IMAGE_DESCRIPTION_LENGTH = 200`, and the accepted input types (jpeg/png/webp) and stored types (webp/jpeg).
- `sniffImageType(bytes) → 'webp' | 'jpg' | null` from the magic bytes (`RIFF….WEBP`, `FF D8 FF`).

#### 2. Wizard and variant field

**Files**: `src/components/studies/StudyWizard.tsx`, `src/components/studies/VariantField.tsx`, new `src/lib/image-resize.ts`

**Intent**: Let each variant switch between "Tekst" and "Grafika". An image variant has a file input, a preview and a required description. The file is resized before submit and the form posts `multipart/form-data`.

**Contract**:

- The form gets `encType="multipart/form-data"`.
- Per-position field names: `variant.<i>.kind`, `variant.<i>.content`, `variant.<i>.image` (File), and `variant.<i>.image_path` (hidden, the existing path when it is kept in edit).
- The resize runs in the file input's `onChange`, not at submit time: `handleSubmit` (`StudyWizard.tsx:160-166`) lets the native POST through, so an async resize at submit would race it. While any resize is pending, submit is blocked (button disabled and `handleSubmit` prevents default). The submit itself stays native.
- `image-resize.ts`: `createImageBitmap` with `imageOrientation: 'from-image'` → canvas at most 1600 px on the long edge → `toBlob('image/webp')`. If the resulting blob type is not webp, it falls back to `image/jpeg`. Quality steps down until the file is ≤ `MAX_IMAGE_BYTES`; otherwise a field error is shown. The resized file replaces the input's file through `DataTransfer`.
- Client validation mirrors the server: count 2–6, a description of 1–200 for images, an image required for a new image variant.

#### 3. Server form handling, upload and cleanup

**Files**: `src/lib/study-form.ts`, `src/pages/api/studies/index.ts`, `src/pages/api/studies/[id]/update.ts`, `src/pages/api/studies/[id]/delete.ts`, new `src/lib/variant-images.ts`

**Intent**: Parse the indexed fields, validate them, upload new files with the author's session client, call the RPC, and clean up objects so that none are orphaned on the success and RPC-failure paths.

**Contract**:

- `readStudyForm` returns `variants: Array<{kind, content, image?: File, image_path?: string}>`.
- `validateStudyForm` adds:
  - for image variants, either a new file (≤ 1 MiB, with a sniffed type) or a kept `image_path` that belongs to this draft's current variants;
  - the description length check.
- `variant-images.ts` (session client only) provides:
  - `uploadVariantImages(supabase, files) → paths`, which names objects `crypto.randomUUID()` + the sniffed extension, with the content type set from the sniffed type;
  - `removeVariantImages(supabase, paths)`, best effort, which logs failures.
- create: upload → `create_study` → on error remove the uploaded paths.
- update: read the current paths (author RLS) → upload → `update_study_draft` → on error remove the uploaded paths; on success remove `old − kept`.
- delete: read the paths → delete the row → remove the paths.
- Errors use the existing redirect + message pattern. Add a message for an invalid or oversized image.
- `formData()` stays wrapped in the existing try/catch pattern.

#### 4. Author views

**Files**: `src/pages/studies/[id].astro`, `src/pages/studies/[id]/edit.astro`

**Intent**: Show image variants on the draft page and pre-fill the edit wizard with kind, description, kept path and preview.

**Contract**:

- Select `kind, image_path` alongside `content`.
- Sign the paths with the session client: `createSignedUrls(paths, 3600)`.
- `StudyWizardInitial.variants` becomes `{kind, content, image_path?, preview_url?}[]`.

#### 5. Tests

**Files**: new `tests/unit/study-form.test.ts`, new `tests/unit/image-file.test.ts`, new `tests/http/image-variants.test.ts`, `tests/http/client.ts` (multipart helper and new field names; `createStudy` at :152), and the existing HTTP tests that post `variant` fields: `tests/http/author-isolation.test.ts:100`, `tests/http/edit-and-delete-study.test.ts:31`, `tests/http/route-access.test.ts:38,49`, `tests/http/study-closing.test.ts:78`

**Intent**: Cover parsing, validation, sniffing, the upload and cleanup flows, and cross-author isolation over HTTP.

**Contract**:

- Unit:
  - indexed parsing with mixed kinds;
  - kept versus new image;
  - a missing image for an image variant;
  - a 201-character description;
  - sniffing of webp/jpeg/png/text.
- HTTP:
  - create with a small WebP shows it on the draft page through a signed URL that returns 200;
  - a non-image file renamed `.webp` is rejected;
  - a file of 1 MiB + 1 byte is rejected;
  - an edit that replaces an image leaves the old object gone (verified with a supabase-js client signed in as the fixture author);
  - deleting the study removes its objects;
  - author B cannot see A's image in any author view (existing B-vs-A matrix extended with an image study).
- Fixtures use `uniqueSuffix()` and clean up after themselves.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the new form and file-sniff tests: `npm run test:unit`
- HTTP tests pass, including `image-variants.test.ts`: `npm run test:http`
- pgTAP suite still passes: `npx supabase test db`
- Static checks pass: `npm run lint && npx astro check && npm run build`

#### Manual Verification:

- A 6 MB phone photo uploads, ends up ≤ 1 MiB at a 1600 px long edge, and keeps its orientation
- Mixed text and image variants can be created, edited (keep, replace, switch kind) and saved; the previews match the stored images
- After deleting a study, its objects are gone in Studio → Storage

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Participant ballot and results

### Overview

Participants see image variants on the ballot through short-lived signed URLs, created with the secret key only after the token was accepted. Authors see images in results, signed once per page load.

### Changes Required:

#### 1. Secret key and signing module

**Files**: `astro.config.mjs`, `.env.example`, new `src/lib/supabase-admin.ts`, `.github/workflows/ci.yml`, new `tests/unit/supabase-admin-usage.test.ts`

**Intent**: Add `SUPABASE_SECRET_KEY` as a server-only secret and expose one narrow capability, signing participant image paths, behind a guard on who imports it.

**Contract**:

- `envField.string({ context: "server", access: "secret", optional: true })` named `SUPABASE_SECRET_KEY`.
- `.env.example` documents it as server-only and never exposed to the browser.
- `supabase-admin.ts` exports only `signParticipantImagePaths(paths: string[]): Promise<Map<string, string>>`, using a non-persisting supabase-js client and `createSignedUrls(paths, 600)` on `variant-images`. It throws if the key is missing.
- CI writes `SUPABASE_SECRET_KEY` (the local `SERVICE_ROLE_KEY` from `supabase status -o env`) into `.env` and `.dev.vars`.
- The unit test asserts that `src/pages/v/[token].astro` is the only file under `src/` importing `supabase-admin`.

#### 2. Ballot

**Files**: `src/pages/v/[token].astro`, `src/components/voting/BallotForm.tsx`

**Intent**: Render image variants for phones, signing only after a non-null ballot.

**Contract**:

- Order: `get_ballot` → on null, render "Badanie jest zakończone" with no signing call → otherwise sign the `image_path`s of the image variants → render.
- A signing failure renders the existing error screen with status 500. A per-item error in the `createSignedUrls` result (for example, a missing object) counts as a failure too: a ballot that silently drops one image would skew the vote.
- The `BallotForm` variant becomes `{variant_id, kind, content, image_url?}`. An image option renders `<img src alt={content} loading="lazy" decoding="async" referrerpolicy="no-referrer">`, full card width with height auto and no horizontal overflow. The radio's accessible name is `content`.
- The existing `no-store` and `same-origin` headers are kept.

#### 3. Results

**Files**: `src/pages/studies/[id].astro` (results section), `src/components/studies/StudyResults.tsx`, `src/lib/study-results.ts`

**Intent**: Show image variants in the ranking, without re-signing on every poll.

**Contract**:

- SSR signs the results image paths with the session client (`createSignedUrls(paths, 3600)`) and passes `imageUrls: Record<variant_id, string>` to the island.
- `ResultVariant` gains `kind` and `image_path`. The island renders the image from `imageUrls` by `variant_id` and ignores the polled `image_path` for rendering.
- Accepted limit: a results tab left open for more than 3600 s shows broken thumbnails until the page is reloaded. A per-item signing error leaves that variant without a thumbnail (results stay usable; text is still shown).

#### 4. Tests

**Files**: new or extended `tests/http/image-variants.test.ts`, `tests/http/study-closing.test.ts`

**Intent**: Prove the signing gate and the anonymity of the participant read path.

**Contract**:

- An active image study's ballot HTML contains `/storage/v1/object/sign/variant-images/` URLs that return 200 with an image content type.
- After a manual close, and for an unknown token, the response contains no `/object/sign/` and matches the existing "Badanie jest zakończone" behavior.
- A used and an unused link of the same study render the same variant set.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the admin-import guard: `npm run test:unit`
- HTTP tests pass, including the ballot-signing and closed-study cases: `npm run test:http`
- Static checks pass: `npm run lint && npx astro check && npm run build`

#### Manual Verification:

- On a real phone, the ballot of an image study shows full-width images, no horizontal scroll, and voting works
- After closing the study, reloading the ballot shows "Badanie jest zakończone" and the previously loaded image URL stops working after 10 minutes
- The results page shows thumbnails that do not flicker or reload across 10 s polls

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: E2E on a phone

### Overview

Add a phone-device Playwright project that runs one spec covering the full image loop. It is driven with `/10x-e2e`.

### Changes Required:

#### 1. Playwright project

**File**: `playwright.config.ts`

**Intent**: Add a mobile project limited to the image spec, and keep the desktop suite unchanged.

**Contract**:

- Project `mobile-chrome`: `devices['Pixel 7']`, depends on `setup`, uses the same `storageState`, `testMatch: /image-variants\.spec\.ts/`.
- The desktop project gets `testIgnore` for that spec.

#### 2. Spec

**Files**: new `tests/e2e/image-variants.spec.ts`, `tests/e2e/fixtures/` (two small committed images)

**Intent**: An author creates a mixed study with two images and one text variant, then starts it. A participant opens a link at phone width, sees both images (`getByRole('img', { name: <description> })`), the page has no horizontal scroll, and the participant votes for an image variant by its radio name and sees the confirmation.

**Contract**:

- Follows the CLAUDE.md rules: role/label/text locators, no `waitForTimeout`, a unique title suffix, and the study deleted in cleanup.

### Success Criteria:

#### Automated Verification:

- The mobile spec passes: `npx playwright test --project=mobile-chrome`
- The full E2E suite passes: `npx playwright test`
- Deliberate break: removing the `alt` from the ballot `<img>` makes the spec fail

#### Manual Verification:

- The Playwright trace of the mobile run shows images rendered at phone width

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- Form parsing and validation of indexed mixed variants; image sniffing; the admin-module import guard.

### Integration Tests:

- pgTAP: the variant shape check, RPC image ownership and existence, path uniqueness, `storage.objects` isolation (B and anon), and the exact ballot keys.
- HTTP: the upload, replace and delete cleanup flows; rejection of a wrong type or oversize file; ballot signing only for active studies; the author-isolation matrix with an image study.
- E2E: the mobile image ballot loop.

### Manual Testing Steps:

1. Upload a large phone photo, then check its stored size, dimensions and orientation.
2. Edit a draft: keep one image, replace one, switch one to text; check Storage for leftovers.
3. Vote on a phone; close the study; reload the ballot.

## Performance Considerations

Images are served by the Supabase CDN, not the Worker. The Worker only parses multipart forms (≤ 6 × 1 MiB) and makes one batch signing call per ballot render. Lazy loading defers below-the-fold images on phones.

## Migration Notes

- Production migrations are applied manually (`npx supabase db push`) — CI does not run them. Apply the Phase 1 migration before deploying the app code, because the app calls the new `jsonb` signatures. The temporary `text[]` wrappers keep the currently deployed app working in the gap between push and deploy.
- After the deploy is live in production, a follow-up migration (its own small change) drops the `text[]` wrappers of `create_study` and `update_study_draft`, removes their pgTAP assertions, and regenerates the types.
- Before the Phase 3 deploy, set the production secret: `npx wrangler secret put SUPABASE_SECRET_KEY` (the project's secret/service-role key). Without it, image ballots return the 500 error screen.
- Existing variants backfill to `kind = 'text'` through the column default; no data migration is needed.

## References

- Related research: `context/changes/image-variants/research.md`
- Roadmap slice: `context/foundation/roadmap.md:188-198` (S-08, issue #13)
- Ballot pattern: `src/pages/v/[token].astro:31-52`
- Access-boundary warning: `context/archive/2026-10-06-testing-access-boundaries/research.md:37`
- Supabase Storage access control and signed URLs: https://supabase.com/docs/guides/storage/security/access-control, https://supabase.com/docs/guides/storage/buckets/fundamentals

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database and storage

#### Automated

- [x] 1.1 Migration applies on a fresh local stack
- [x] 1.2 pgTAP suite passes, including image_variants.test.sql
- [x] 1.3 Types regenerate with no diff after commit
- [x] 1.4 Static checks pass
- [x] 1.5 Existing HTTP and unit suites pass unchanged

#### Manual

- [x] 1.6 variant-images bucket is private with 1 MiB and webp/jpeg limits
- [x] 1.7 Text-only study create/edit/start behaves as before

### Phase 2: Author: upload, edit, delete

#### Automated

- [ ] 2.1 Unit tests pass, including form and file-sniff tests
- [ ] 2.2 HTTP tests pass, including image-variants.test.ts
- [ ] 2.3 pgTAP suite still passes
- [ ] 2.4 Static checks pass

#### Manual

- [ ] 2.5 Large phone photo is resized to ≤ 1 MiB, 1600 px, correct orientation
- [ ] 2.6 Mixed variants create/edit (keep, replace, switch kind) with matching previews
- [ ] 2.7 Deleting a study removes its storage objects

### Phase 3: Participant ballot and results

#### Automated

- [ ] 3.1 Unit tests pass, including the admin-import guard
- [ ] 3.2 HTTP tests pass, including ballot-signing and closed-study cases
- [ ] 3.3 Static checks pass

#### Manual

- [ ] 3.4 Phone ballot shows full-width images, no horizontal scroll, voting works
- [ ] 3.5 Closed study shows the closed message and old image URL expires
- [ ] 3.6 Results thumbnails stay stable across 10 s polls

### Phase 4: E2E on a phone

#### Automated

- [ ] 4.1 Mobile spec passes on mobile-chrome
- [ ] 4.2 Full E2E suite passes
- [ ] 4.3 Deliberate break: removing img alt fails the spec

#### Manual

- [ ] 4.4 Mobile trace shows images rendered at phone width
