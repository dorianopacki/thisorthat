# Review fixes and follow-ups: image-variants

From `reviews/impl-review.md` (2026-10-19). F1–F5 and F7 are fixed in code; F8 was dismissed as a false positive. The steps below are for the PR description and for after the merge.

## Deploy order (put in the PR description)

- [ ] Run `npx supabase db push` **before** deploying the Worker. It applies `20261017120000_image_variants.sql` and `20261019120000_image_variants_hardening.sql`; CI does not apply migrations, and the app already calls the `jsonb` `create_study` / `update_study_draft`.
- [x] `SUPABASE_SECRET_KEY` is set as a Workers secret (done 2026-10-19). Without it, image ballots return the 500 screen.
- [ ] After the deploy is live: open a small change that drops the `text[]` wrappers of `create_study` and `update_study_draft`, removes their pgTAP assertions and regenerates the types (plan, Migration Notes).

## F6: orphaned objects and upload quota (backlog)

"No periodic sweep" is an explicit non-goal of this plan, so this is not a defect of S-08. It is still a real cost: failed best-effort removals, Workers killed between upload and RPC, and direct Storage API uploads all leave objects that no variant references, and nothing limits how many an author can upload.

- [ ] Open a backlog issue: a scheduled job that removes `variant-images` objects that no variant references and that are older than N hours (it must go through the Storage API; SQL deletes are blocked). Optionally add a per-owner object cap to the insert policy.
