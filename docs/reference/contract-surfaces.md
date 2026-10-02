# Contract surfaces

Load-bearing names that later slices build on. Renaming or reshaping any of them is a breaking change: it needs a forward-fix migration, regenerated types (`npx supabase gen types typescript --local > src/lib/database.types.ts`) and updated pgTAP tests in `supabase/tests/`.

Source of truth: `supabase/migrations/20261002095727_study_data_model.sql` (change `study-data-model`).

## Anonymity rule

**Authors never read `votes`, `comments`, or `study_links.used`.** `anon` and `authenticated` have no privileges on `votes` and `comments`, and `authenticated` can select only `study_links (id, study_id, token)`. Authors see votes and comments only as aggregates through `get_study_results`. `votes` and `comments` never get a link reference, a timestamp or a serial/identity column. `supabase/tests/study_anonymity.test.sql` enforces this.

## Enum `public.study_status`

`draft` | `active` | `closed`

## Tables

| Table                | Columns                                                                                                       | Author access (`authenticated`)                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `public.studies`     | `id`, `author_id` (default `auth.uid()`), `title`, `participant_target`, `status`, `created_at`, `updated_at` | select/delete own; insert/update only `title`, `participant_target`; update only while `draft`         |
| `public.variants`    | `id`, `study_id`, `position`, `content`                                                                       | select own; insert `study_id, position, content`, update `position, content`, delete: own `draft` only |
| `public.study_links` | `id`, `study_id`, `token`, `used`                                                                             | select `id, study_id, token` of own studies; no access to `used`                                       |
| `public.votes`       | `id`, `study_id`, `variant_id`                                                                                | none                                                                                                   |
| `public.comments`    | `id`, `study_id`, `variant_id`, `body`                                                                        | none                                                                                                   |

`studies.status` is in no column grant: only `security definer` functions change it. Deleting a study cascades to its variants, links, votes and comments. `anon` has no table privileges.

## `public.cast_vote(p_token text, p_variant_id uuid, p_comments jsonb default '[]') returns text`

Callable by `anon` and `authenticated`. The only write path for votes and comments.

- `p_comments`: JSON array of `{ "variant_id": uuid, "body": text }`. Blank bodies are skipped; bodies are trimmed.
- Return codes:
  - `accepted` — link consumed, vote and comments recorded.
  - `link_used` — the link was already used on an `active` study; nothing recorded.
  - `study_ended` — unknown token, or the study is `draft`/`closed`/deleted; nothing recorded.
- Raises SQLSTATE `22023` (link stays unused) when: `p_variant_id` is not a variant of the token's study; `p_comments` is not an array or an entry is not an object; a comment `variant_id` is missing or not in the study; two comments share a `variant_id`; a body exceeds 2000 characters. Validation runs before the link is consumed, so errors never reveal whether a link is used.

## `public.get_study_results(p_study_id uuid) returns jsonb`

Callable by `authenticated` only. Returns `null` when the caller does not own the study (or it does not exist).

```json
{
  "status": "draft | active | closed",
  "responded": 0,
  "total": 0,
  "variants": [
    {
      "variant_id": "uuid",
      "position": 0,
      "content": "text",
      "vote_count": 0,
      "comments": ["body", "..."]
    }
  ]
}
```

- `responded`: count of used links; `total`: count of links.
- `variants` ordered by `position`; `comments` sorted by body (never insertion order).
- Top-level keys are exactly `status, responded, total, variants`; per-variant keys are exactly `variant_id, position, content, vote_count, comments`.
