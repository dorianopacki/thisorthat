# Review fixes — generate-extra-links

From `reviews/impl-review.md` (2026-10-16). Steps for the PR description and the release.

## F1 — Deploy order (put in the PR description)

- [ ] Run `npx supabase db push` (migration `20261016181615_generate_extra_links.sql`) **before** deploying the Worker. CI does not apply migrations, and the study page now selects `study_links.position`. Without the column, every started study's page throws.

## F5 — Production spot-check after `db push`

- [ ] Check that every study's positions are contiguous, 1…total. This query should return no rows:

  ```sql
  select study_id, min(position), max(position), count(*)
    from public.study_links
   group by study_id
  having min(position) <> 1 or max(position) <> count(*);
  ```
