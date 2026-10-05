# Contract surfaces

Load-bearing names that later slices build on. Renaming or reshaping any of them is a breaking change: it needs a forward-fix migration, regenerated types (`npx supabase gen types typescript --local > src/lib/database.types.ts`) and updated pgTAP tests in `supabase/tests/`.

Source of truth: `supabase/migrations/20261002095727_study_data_model.sql` and `20261002124043_cast_vote_comment_uuid_errcode.sql` (change `study-data-model`), plus `20261005075735_create_and_start_study.sql` (change `create-and-start-study`). Applied migrations are never edited; change behaviour with a new forward migration.

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

## Limits

- **N (`studies.participant_target`): 1–100**, enforced by the check constraint `studies_participant_target_check`. N is the total number of links a study ever gets: anything that adds links later (S-07) must keep the total within 100.
- **Variants per study: 2–6.** Not a table constraint (drafts are edited row by row); enforced by `create_study` and again by `start_study`.
- Title 1–200 and variant content 1–2000 characters after trimming (table check constraints).

## Vote URL

Each link is served at **`/v/<token>`** (S-02 must serve this path; the author copies these URLs after `start_study`).

## `public.create_study(p_title text, p_participant_target integer, p_variants text[]) returns uuid`

Callable by `authenticated` only (`security invoker`: runs under the caller's grants and RLS). Creates a `draft` study owned by `auth.uid()` with one variant per array entry at `position` 0, 1, … in array order; title and variant contents are trimmed. Returns the study id.

- Raises `22023` when `p_variants` has fewer than 2 or more than 6 entries, or any entry is null or blank after trimming.
- Raises `23514` (check violation) when N is outside 1–100, the title is blank or over 200 characters, or a variant is over 2000 characters.
- Nothing is inserted when it raises.

## `public.start_study(p_study_id uuid) returns void`

Callable by `authenticated` only (`security definer`). Moves the caller's `draft` study to `active` and inserts exactly `participant_target` rows into `study_links` (tokens from the column default: 32 hex chars). Locks the study row first, so concurrent starts cannot generate two sets of links; on any error nothing is inserted or changed.

- Raises `P0002` when the caller owns no study with this id (unknown, someone else's, or no `auth.uid()`).
- Raises `55000` when the study is not `draft` (already started or closed).
- Raises `22023` when the study has fewer than 2 or more than 6 variants.

## `public.cast_vote(p_token text, p_variant_id uuid, p_comments jsonb default '[]') returns text`

Callable by `anon` and `authenticated`. The only write path for votes and comments.

- `p_comments`: JSON array of `{ "variant_id": uuid, "body": text }`. Blank bodies are skipped; bodies are trimmed.
- Return codes:
  - `accepted` — link consumed, vote and comments recorded.
  - `link_used` — the link was already used on an `active` study; nothing recorded.
  - `study_ended` — unknown token, or the study is `draft`/`closed`/deleted; nothing recorded.
- Raises SQLSTATE `22023` (link stays unused) when: `p_variant_id` is not a variant of the token's study; `p_comments` is not an array or an entry is not an object; a comment `variant_id` is missing, not a uuid, or not in the study; two comments share a `variant_id`; a body exceeds 2000 characters. Validation runs before the link is consumed, so errors never reveal whether a link is used.
- **Known, accepted limit:** whoever holds a token can test it, and authors hold every token of their studies (they distribute them). An author can therefore call `cast_vote` on each token: used links answer `link_used`, unused ones get consumed with a fake vote. This reveals per-link usage only by destroying the remaining links (visible in `responded`), so it is not a silent oracle. Blocking `authenticated` would not help, because the author can call as `anon`. Decision (S-01, `create-and-start-study`): authors keep reading raw tokens, because they distribute the links themselves; since the probe is destructive and shows up in `responded`, the limit is accepted.

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
