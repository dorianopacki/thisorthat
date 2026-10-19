# Drop Text Variant Wrappers — Plan Brief

> Full plan: `context/changes/drop-text-variant-wrappers/plan.md`

## What & Why

S-08 (image variants) kept the old `text[]` signatures of `create_study` and `update_study_draft` as thin wrappers, so the app deployed before S-08 kept working between `db push` and deploy. The S-08 app is now live and calls only the `jsonb` signatures, so the wrappers are dead weight and a second, untested-by-the-app entry point into the write path. This change removes them.

## Starting Point

The wrappers live in `20261017120000_image_variants.sql`. The app never calls them, but about 45 pgTAP calls in 4 test files still go through them, most of them the create/update validation cases.

## Desired End State

One `jsonb` signature per function, unchanged (`p_variant_items`). Every validation case still runs, now as a `jsonb` call, and tests assert that the `text[]` signatures are gone. Types and contract docs no longer mention the wrappers. Production gets the migration after confirming the S-08 app is live.

## Key Decisions Made

| Decision                         | Choice                                                              | Why (1 sentence)                                                                            |
| -------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| pgTAP calls through the wrappers | Convert every one to `jsonb`; drop only wrapper-specific assertions | Keeps all validation coverage instead of guessing which cases are duplicates.               |
| Parameter name                   | Keep `p_variant_items`                                              | Renaming is a contract change that would need another deploy-order dance.                   |
| Branch                           | New `chore/drop-text-variant-wrappers` from current HEAD            | Avoids the merged branch name and carries the two archive commits into one PR.              |
| Phases                           | One phase                                                           | After `drop function` every old test call fails, so migration and tests must land together. |
| Drop style                       | Exact signatures, no `if exists`, no `cascade`                      | A wrong signature or unexpected dependant should fail loudly.                               |

## Scope

**In scope:** forward migration with two `drop function`; pgTAP conversion in 4 files; "signature is gone" assertions; regenerated `database.types.ts`; `contract-surfaces.md` cleanup; production push.

**Out of scope:** renaming parameters or other changes to the `jsonb` functions; pruning test cases; the orphaned-image sweep (F6); app code changes.

## Architecture / Approach

Database-only change. The migration removes two overloads; tests move from the positional `text[]` argument to an equivalent `jsonb` array of text items with identical content, so each case hits the same check with the same error code.

## Phases at a Glance

| Phase                                        | What it delivers                                        | Key risk                                            |
| -------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------- |
| 1. Drop the wrappers and move pgTAP to jsonb | Migration, converted tests, types, docs; then prod push | Losing a validation case while converting ~45 calls |

**Prerequisites:** S-08 app version deployed to production (confirmed working); local Docker/Supabase running.
**Estimated effort:** ~1 session, one phase.

## Open Risks & Assumptions

- Assumes production runs the S-08 app; an older deployed app would fail on create/edit after the push. Checked manually before the push.
- Rollback is a forward migration recreating the wrappers from the S-08 migration.

## Success Criteria (Summary)

- Creating and editing studies works locally and in production exactly as before.
- pgTAP keeps every validation case and proves the old signatures are gone.
- No generated type or doc mentions the wrappers.
