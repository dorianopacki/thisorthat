# Drop Text Variant Wrappers Implementation Plan

## Overview

Remove the two temporary `text[]` signatures of `create_study` and `update_study_draft` that `image-variants` (S-08) kept so the previously deployed app would keep working between `db push` and deploy. The app now calls only the `jsonb` signatures (`p_variant_items`), and the S-08 app version is live in production, so nothing uses the wrappers any more. This is the follow-up promised in the S-08 plan's Migration Notes and in `context/archive/2026-10-16-image-variants/follow-ups/review-fixes.md`.

## Current State Analysis

- The wrappers are `language sql security invoker` functions that map every `text[]` entry to `{kind: 'text', content, image_path: null}` and call the `jsonb` version. They are revoked from `public, anon` and granted to `authenticated` (`supabase/migrations/20261017120000_image_variants.sql:255-283` and `:472-502`).
  - `public.create_study(text, integer, text[], timestamp, text)`
  - `public.update_study_draft(uuid, text, integer, text[], timestamp, text)`
- The app never calls them: no `p_variants` occurrence in `src/` or `tests/`, only in the generated `src/lib/database.types.ts:220` and `:269`.
- pgTAP still depends on them heavily. About 45 calls use `array[...]` across 4 files, most of them the _validation_ cases of create and update (2–6 variant count, blank content, variant length, N range, blank or long title, deadline), plus a few assertions about the wrappers themselves:
  - `supabase/tests/create_and_start_study.test.sql` (e.g. :44, :89–145, :387)
  - `supabase/tests/edit_and_delete_study.test.sql` (e.g. :58–100, :133, :154–190, :291–298, :306–407)
  - `supabase/tests/study_deadline.test.sql`
  - `supabase/tests/image_variants.test.sql` (:110, :116, :140–150, :285 onwards, and the wrapper cases at the end)
- `docs/reference/contract-surfaces.md:94` and `:108` describe the wrappers as "Temporary `text[]` wrapper … dropped in a follow-up migration".

## Desired End State

- Only the `jsonb` signatures of `create_study` and `update_study_draft` exist, with unchanged parameter names (`p_variant_items`), grants and behaviour.
- Every validation case that went through a wrapper still exists, now as a `jsonb` call with the same expected error code and description. The pgTAP plan counts change only by the removed wrapper-specific assertions and the added "signature is gone" assertions.
- `database.types.ts` has one overload per function; `contract-surfaces.md` no longer mentions the wrappers.
- Production: the migration is applied after confirming the deployed app is the S-08 version.

Verify: `npx supabase db reset`, `npx supabase test db`, type drift check, `npm run lint && npx astro check && npm run build`, `npm run test:unit`, `npm run test:http`.

### Key Discoveries:

- PostgREST picks an overload by argument names; the `jsonb` parameter was named `p_variant_items` to avoid PGRST203 next to `p_variants` (`context/archive/2026-10-16-image-variants/plan.md`, Phase 1 implementation note). With one signature left the name could change, but that would be a contract change requiring a deploy-order dance again, so it stays.
- `null::text[]` in `create_and_start_study.test.sql:145` reaches the `jsonb` function through the wrapper today, so converting it to `null::jsonb` keeps the same path and error code.
- Production migrations are applied manually (`npx supabase db push`); CI does not run them.

## What We're NOT Doing

- No rename of `p_variant_items` back to `p_variants`, and no other change to the `jsonb` functions, their grants or the app.
- No pruning of test cases that look duplicated between the former `text[]` and existing `jsonb` cases: every converted case stays.
- No changes to earlier migrations (forward-only).
- No work on the orphaned-image sweep (F6 of the S-08 review); that is a separate backlog item.

## Implementation Approach

One phase, because the migration and the tests must land together: after `drop function`, every `array[...]` call in pgTAP fails. Work happens on a new branch `chore/drop-text-variant-wrappers` created from the current HEAD, which also carries the two unmerged `chore(archive)` commits, so a single PR closes both.

## Phase 1: Drop the wrappers and move pgTAP to jsonb

### Overview

Add a forward migration that drops both `text[]` signatures, convert every pgTAP call that used them to the equivalent `jsonb` call, replace the wrapper-specific assertions with "signature no longer exists" checks, regenerate the types and update the contract docs.

### Changes Required:

#### 1. Branch

**Intent**: Keep the work off the already-merged `feat/generate-extra-links`, and carry the two archive commits into the same PR.

**Contract**: `git switch -c chore/drop-text-variant-wrappers` from the current HEAD, before the first edit.

#### 2. Migration

**File**: `supabase/migrations/<timestamp>_drop_text_variant_wrappers.sql`

**Intent**: Remove the temporary compatibility signatures now that nothing calls them.

**Contract**: `drop function public.create_study(text, integer, text[], timestamp, text);` and `drop function public.update_study_draft(uuid, text, integer, text[], timestamp, text);` (exact signatures, no `if exists`, no `cascade`, so a wrong signature or an unexpected dependant fails loudly). The header comment names S-08 and why it is safe now. The `jsonb` overloads are untouched.

#### 3. pgTAP

**Files**: `supabase/tests/create_and_start_study.test.sql`, `supabase/tests/edit_and_delete_study.test.sql`, `supabase/tests/study_deadline.test.sql`, `supabase/tests/image_variants.test.sql`

**Intent**: Keep all validation coverage while removing the dependency on the dropped signatures.

**Contract**:

- Every positional `array['A', 'B']` variants argument becomes the equivalent `jsonb` array of text items (`'[{"kind": "text", "content": "A"}, {"kind": "text", "content": "B"}]'::jsonb`), and `null::text[]` becomes `null::jsonb`. Content with whitespace, blank entries and `repeat(...)` lengths are preserved exactly, so each case still hits the same check (build the JSON with `jsonb_build_array` / `jsonb_build_object` where `repeat` or quoting makes a literal awkward). Descriptions and expected error codes stay the same.
- Assertions that exist only because of the wrappers are removed: their `has_function_privilege(... text[] ...)` checks, "anon: permission denied on the … text[] wrapper", and "the text[] wrapper still creates/updates …".
- Added in `image_variants.test.sql`: `hasnt_function` (or an equivalent `to_regprocedure(...) is null` check) for both `text[]` signatures.
- Each file's `plan(N)` is updated to the new count.

#### 4. Types

**File**: `src/lib/database.types.ts`

**Intent**: Match the database after the drop.

**Contract**: Regenerated with `npx supabase gen types typescript --local`, then formatted with Prettier like the committed file. The `p_variants: string[]` overloads disappear; nothing else changes.

#### 5. Contract docs

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Stop describing signatures that no longer exist.

**Contract**: Remove the two "Temporary `text[]` wrapper" paragraphs (`create_study` and `update_study_draft` sections), and any other wrapper mention.

### Success Criteria:

#### Automated Verification:

- Migration applies on a fresh local stack: `npx supabase db reset`
- pgTAP passes with no `text[]` call left: `npx supabase test db`, and `grep -nE "(create_study|update_study_draft)\([^)]*array\[|text\[\]" supabase/tests/*.sql` matches nothing except the `hasnt_function` checks
- Generated types match the committed file (no drift after formatting)
- Static checks pass: `npm run lint && npx astro check && npm run build`
- Unit and HTTP suites pass unchanged: `npm run test:unit && npm run test:http`

#### Manual Verification:

- Production runs the S-08 app version (an image study can be created) before the migration is pushed
- `npx supabase db push` applies only this migration, and the security advisors show no new ERROR
- Creating and editing a study in production still works after the push

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Integration Tests:

- pgTAP: every former wrapper case now runs against the `jsonb` signature with the same expected code; the dropped signatures are asserted absent.
- HTTP: the existing create/edit suites prove the app path (which already uses `jsonb`) is unaffected.

### Manual Testing Steps:

1. Confirm production serves the S-08 version (create an image study).
2. `npx supabase db push --dry-run`, then `npx supabase db push`.
3. Create and edit a study in production.

## Migration Notes

Push only after the S-08 app version is live; an older deployed app would call the dropped `text[]` signatures and fail. Rollback, if ever needed, is a forward migration that recreates the wrappers from `20261017120000_image_variants.sql:255-283` and `:472-502`.

## References

- S-08 plan, Migration Notes: `context/archive/2026-10-16-image-variants/plan.md`
- Follow-up: `context/archive/2026-10-16-image-variants/follow-ups/review-fixes.md`
- Wrappers: `supabase/migrations/20261017120000_image_variants.sql:255-283`, `:472-502`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Drop the wrappers and move pgTAP to jsonb

#### Automated

- [x] 1.1 Migration applies on a fresh local stack — cd6afc3
- [x] 1.2 pgTAP passes with no text[] call left — cd6afc3
- [x] 1.3 Generated types match the committed file — cd6afc3
- [x] 1.4 Static checks pass — cd6afc3
- [x] 1.5 Unit and HTTP suites pass unchanged — cd6afc3

#### Manual

- [x] 1.6 Production runs the S-08 app version before the push — cd6afc3
- [x] 1.7 db push applies only this migration; no new advisor ERROR — cd6afc3
- [x] 1.8 Creating and editing a study in production still works — cd6afc3
