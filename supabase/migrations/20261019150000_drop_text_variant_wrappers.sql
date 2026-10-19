-- drop-text-variant-wrappers: remove the temporary text[] signatures of
-- create_study and update_study_draft. Forward-only.
--
--   * image-variants (S-08, 20261017120000_image_variants.sql) kept them as
--     thin security invoker wrappers over the jsonb overloads, so the app
--     deployed before S-08 kept working between `db push` and deploy.
--   * the S-08 app calls only the jsonb signatures (p_variant_items) and is
--     live in production, so nothing calls the wrappers any more.
--   * exact signatures, no `if exists` and no `cascade`: a wrong signature or
--     an unexpected dependant fails the migration instead of passing silently.
--   * the jsonb overloads, their parameter names and grants are unchanged.
--     p_variant_items keeps its name: renaming it would change the PostgREST
--     contract and need another deploy-order step.

drop function public.create_study(text, integer, text[], timestamp, text);

drop function public.update_study_draft(uuid, text, integer, text[], timestamp, text);
