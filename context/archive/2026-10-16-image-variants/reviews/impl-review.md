<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: S-08 Image Variants

- **Plan**: context/changes/image-variants/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-19
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Plan drift check: every contract bullet in Phases 1–4 is MATCH. There is no DRIFT and nothing MISSING. The four user-approved deviations are present: the numbered file-input label, `tests/http/storage.ts` reading `.dev.vars`, the E2E cleanup removing Storage objects, and the ballot radio's `aria-label` with no visible caption. The other extras are benign:

- signing is skipped on the "used" screen;
- cleanup runs after a partial upload failure;
- the author-side signing helper is shared;
- extra pgTAP cases.

Success criteria:

- **Re-run on HEAD during this review:** unit tests (119), lint (0 errors), astro check (0 errors).
- **Green earlier on 2026-10-19:** pgTAP 379/379 and HTTP 214/214. No SQL or server code changed after those runs.
- **Green after the last code change:** full E2E 6/6.
- **Type drift:** clean at gate 1.3; no migration changed after that.
- **Not re-run:** `db reset`. Docker Desktop kept stopping, and a reset wipes the local E2E user.
- **Manual rows:** all were confirmed by the user during the run.

## Findings

### F1 — Direct variant writes skip the image ownership check

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261017120000_image_variants.sql:62-63
- **Detail**: The migration grants `insert (kind, image_path)` and `update (kind, image_path)` on `public.variants` to `authenticated`. The draft-only insert and update policies (`20261002095727_study_data_model.sql:153,164`) let an author write their own draft's rows straight through PostgREST. That path checks only the path format and the partial unique index; the owner check exists only inside `create_study` / `update_study_draft`. So author B can point a draft variant at an object of A's that no variant references, for example an object left behind after a cleanup failure, start the study, and `signParticipantImagePaths` (secret key, bypasses Storage RLS) serves A's image. B has to know the UUID, but UUIDs show up in participants' signed URLs. The app never writes `variants` directly (only `.select`), and no pgTAP test covers a direct write as `authenticated`. Verified by reading the code, not reproduced live.
- **Fix A ⭐ Recommended**: In a forward migration, revoke the two column grants (writes go only through the RPCs), and add a pgTAP case: B inserting or updating a variant with A's object is refused.
  - Strength: Removes the bypass completely. Nothing in the app depends on direct writes (grep: `from("variants")` is only ever selected).
  - Tradeoff: Direct writes to `kind`/`image_path` stop working. No caller uses them today.
  - Confidence: HIGH — the RPCs are the only write path and they run their own checks.
  - Blind spot: Whether the old direct insert policy on `variants` is still needed for `content`/`position`. It is out of scope here, and the column grants for those stay as they are.
- **Fix B**: Add a trigger on `variants` that checks the image object's `owner_id` against the study's author.
  - Strength: Covers every write path, including future ones.
  - Tradeoff: Logic that already lives in the RPCs is duplicated, and the trigger must be `security definer` to see `storage.objects`.
  - Confidence: MED — more code to get right.
  - Blind spot: How the trigger interacts with the RPCs' replace-all strategy in `update_study_draft`.
- **Decision**: FIXED, a variant of Fix B. Fix A would have broken `create_study`, which is security invoker and inserts `kind`/`image_path` as the caller. Instead, `20261019120000_image_variants_hardening.sql` adds a security definer BEFORE INSERT/UPDATE trigger that checks the object's owner against the study's author (23514), and revokes the direct UPDATE grant on `(kind, image_path)`. 3 pgTAP cases were added to `image_variants.test.sql`, and the rule is in `contract-surfaces.md`.

### F2 — An author can swap the image behind a started study

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261017120000_image_variants.sql:72-90
- **Detail**: The delete policy lets an author delete their own object even when a started study's variant references it, and the insert policy checks only the name pattern. So through the Storage API an author can `remove(x.webp)` and then `upload(x.webp, otherBytes)`, which changes a variant while the vote is running. Text variants can't change after start; images can. Between the remove and the re-upload, every ballot of that study returns 500 (signing throws on a missing object).
- **Fix**: Add `and not exists (select 1 from public.variants v where v.image_path = name)` to the delete policy, and the same rule to insert, through a `security definer` helper so it sees every author's variants. Add pgTAP cases.
  - Strength: Both app removal paths (`update.ts` after the RPC, `delete.ts` after the row delete) remove only objects that are no longer referenced, so they keep working. This also closes F3.
  - Tradeoff: Storage policies now depend on `public.variants`, and the helper needs careful `search_path` hardening.
  - Confidence: MED — Storage RLS with a definer helper is a well-known pattern, but this is its first use in this repo.
  - Blind spot: Storage API behaviour on a policy-refused remove (an error or a silent no-op) — the best-effort cleanup only logs it either way.
- **Decision**: FIXED. The same forward migration (`20261019120000_image_variants_hardening.sql`) adds the `private` schema (not exposed by PostgREST) with the security definer `private.variant_image_in_use(name)`, and the insert and delete policies now also require `not private.variant_image_in_use(name)`. 3 pgTAP cases were added. The `tests/http/image-variants.test.ts` `afterAll` now deletes the run's studies before removing objects, and it asserts the result.

### F3 — Two concurrent draft edits can leave a variant pointing at a deleted object

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/studies/[id]/update.ts:42-52, 76-79
- **Detail**: `currentPaths` is read before the RPC and without a lock. Tab 1 replaces image x and Tab 2 keeps it; both read `{x}`. Tab 1 commits, then Tab 2 commits with x, then Tab 1 removes x. The draft now points at a missing object; after start every ballot of that study returns 500, because `start_study` doesn't check that images exist. A delete racing an update orphans the newly uploaded object in the same way.
- **Fix**: Closed by F2's delete policy, under which removing a still-referenced object is refused. Without F2, re-query which paths are still referenced just before `removeVariantImages`.
- **Decision**: FIXED by the F2 delete policy. Tab 1's `remove(x)` is refused while Tab 2's committed draft references x.

### F4 — No request-size check before `formData()`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/studies/index.ts:25, src/pages/api/studies/[id]/update.ts:31
- **Detail**: `request.formData()` buffers the whole multipart body before the 1 MiB-per-file and 2–6 count checks run, and nothing checks `Content-Length` (routes or middleware). A signed-in user can post a body as large as the Workers limit into a 128 MB isolate.
- **Fix**: Before `formData()`, redirect with `IMAGE_MESSAGE` when `Content-Length` is missing or above about 7 MiB (6 × 1 MiB plus text overhead). Add an HTTP test for the oversized body.
- **Decision**: FIXED. `MAX_STUDY_FORM_BYTES` (7 MiB) is in `study-limits.ts`, and `studyFormTooLarge(request)` in `study-form.ts` is called before `formData()` in both routes. The HTTP test posts a valid study plus an 8 MiB extra field, which only the guard refuses.

### F5 — Each upload is buffered twice

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/variant-images.ts:40-48
- **Detail**: `uploadVariantImages` reads each whole file with `arrayBuffer()` to sniff it again, although validation already sniffed its first 12 bytes. That is at most 6 MiB after validation, which is acceptable within the 10 ms CPU budget but avoidable.
- **Fix**: Sniff with `sniffImageFile(file)` and pass the `File` straight to `upload`.
- **Decision**: FIXED. `uploadVariantImages` now sniffs with `sniffImageFile` (12 bytes) and passes the `File` straight to `upload`.

### F6 — Uploads have no quota, and nothing removes orphaned objects

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261017120000_image_variants.sql:72-76, src/lib/variant-images.ts:20-31
- **Detail**: Any signed-in user can upload any number of 1 MiB webp/jpeg objects straight through the Storage API. Failed best-effort removals and killed Workers leave orphaned objects. "No periodic sweep" is an explicit non-goal of the plan, so this is accepted scope; it is recorded here for the backlog because of the storage cost.
- **Fix**: Add a follow-up roadmap item: a scheduled sweep of unreferenced objects older than N hours, and optionally a per-owner cap.
- **Decision**: FIXED as a follow-up, not code. It is an explicit plan non-goal; the backlog item (orphan sweep plus an optional per-owner cap) is in `follow-ups/review-fixes.md`.

### F7 — Ballot image URLs expire after 10 minutes and load lazily

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/voting/BallotForm.tsx:122, src/lib/supabase-admin.ts:11
- **Detail**: With `loading="lazy"` and a 600 s TTL, a participant who scrolls to an image below the fold more than 10 minutes after opening the ballot gets a broken image and may vote without seeing it. The page is `no-store`, so a reload re-signs the URLs.
- **Fix**: Use `loading="eager"` on the ballot (at most 6 images of 1 MiB or less), and/or an image `onError` that shows a "Odśwież stronę" hint.
- **Decision**: FIXED. The ballot `<img>` uses `loading="eager"` (at most 6 images of 1 MiB or less), and the E2E spec comment was updated.

### F8 — A late resize error can land on the wrong variant

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/studies/StudyWizard.tsx (`onImageStatusChange` handler)
- **Detail**: The status is applied by `variant.key`, but the error goes through `setVariantError(index, …)` with the render-time `index`. If a variant is removed while a slower resize is still running, the error message shows under the wrong position.
- **Fix**: Look up the current index by `variant.key` inside the state update before setting the error.
- **Decision**: DISMISSED, false positive. `VariantField` reports through `reportStatus.current`, a ref refreshed on every render with the latest `onImageStatusChange` closure, so `index` is current when a late resize result arrives.
