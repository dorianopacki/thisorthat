# Contract surfaces

Load-bearing names that later slices build on. Renaming or reshaping any of them is a breaking change: it needs a forward-fix migration, regenerated types (`npx supabase gen types typescript --local > src/lib/database.types.ts`) and updated pgTAP tests in `supabase/tests/`.

Source of truth: `supabase/migrations/20261002095727_study_data_model.sql` and `20261002124043_cast_vote_comment_uuid_errcode.sql` (change `study-data-model`), plus `20261005075735_create_and_start_study.sql` (change `create-and-start-study`) `20261005132123_one_time_link_voting.sql` (change `one-time-link-voting`) and `20261015130000_study_closing_rules.sql` (change `study-closing-rules`). Applied migrations are never edited; change behaviour with a new forward migration.

## Anonymity rule

**Authors never read `votes`, `comments`, or `study_links.used`.** `anon` and `authenticated` have no privileges on `votes` and `comments`, and `authenticated` can select only `study_links (id, study_id, token)`. Authors see votes and comments only as aggregates through `get_study_results`. `votes` and `comments` never get a link reference, a timestamp or a serial/identity column. `supabase/tests/study_anonymity.test.sql` enforces this.

**No participant-reachable read reveals `study_links.used`.** The only way to learn a link's state is `cast_vote`, which consumes an unused link. `get_ballot` never reads `used` and returns identical output for a used and an unused link; `supabase/tests/get_ballot.test.sql` enforces this. Any later participant-facing read (S-03, S-04, S-06) must keep this rule.

**The results UI never marks what changed between refreshes** (no highlight, animation or new-item count) and renders comments in the order `get_study_results` returns them. Accepted limit: with few votes, comparing two snapshots shows which variant gained a vote and which comments arrived together, and when; this is inherent to live results (FR-013) and to a plain reload, and is accepted for the MVP. See [Results view](#results-view).

**Accepted operator-level exposure.** Cloudflare Workers observability (`wrangler.jsonc`) logs request URLs with timestamps, so `/v/<token>`, `/api/v/<token>` and the `?status=accepted|used` redirects show per-link vote timing to whoever holds the Cloudflare account. This is outside the author threat model (the operator can already read the database) and is accepted for the MVP; revisit if account access widens or logs leave the account.

## Enum `public.study_status`

`draft` | `active` | `closed`

## Closing rule

A study is **effectively closed** when `status = 'closed'`, or when `status = 'active'` and `now() >= closes_at`. The boundary belongs to the closed side: at exactly `closes_at` the study is closed.

- The deadline is computed, never written. A study past its deadline keeps `status = 'active'` in the table. **Every reader must use `study_status_effective` (SQL) or the `effective_status` computed field (PostgREST), never `studies.status` alone.**
- `get_ballot`, `get_study_results` and the open check in `cast_vote` apply the rule.
- The participant never learns why a study ended. Every closed study looks the same as an unknown token (`get_ballot` → `null`).

## `public.study_status_effective(p_status study_status, p_closes_at timestamptz) returns study_status`

The closing rule in one body (`stable`, `security invoker`). Returns `'closed'` for an `active` status at or past `p_closes_at`, otherwise `p_status` unchanged. Callable by `authenticated`; not by `anon`.

## `public.effective_status(s public.studies) returns study_status`

PostgREST computed field over `studies` (`select("…, effective_status")`), delegating to `study_status_effective`. Deliberately a different name from the scalar function, so nothing is overloaded. Callable by `authenticated`; not by `anon`.

## Tables

| Table                | Columns                                                                                                                                 | Author access (`authenticated`)                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `public.studies`     | `id`, `author_id` (default `auth.uid()`), `title`, `participant_target`, `status`, `closes_at`, `closes_tz`, `created_at`, `updated_at` | select/delete own; insert/update only `title`, `participant_target`, `closes_at`, `closes_tz`; update only while `draft` |
| `public.variants`    | `id`, `study_id`, `position`, `content`                                                                                                 | select own; insert `study_id, position, content`, update `position, content`, delete: own `draft` only                   |
| `public.study_links` | `id`, `study_id`, `token`, `used`                                                                                                       | select `id, study_id, token` of own studies; no access to `used`                                                         |
| `public.votes`       | `id`, `study_id`, `variant_id`                                                                                                          | none                                                                                                                     |
| `public.comments`    | `id`, `study_id`, `variant_id`, `body`                                                                                                  | none                                                                                                                     |

`studies.status` is in no column grant: only `security definer` functions change it. `closes_at` (absolute instant) and `closes_tz` (the author's IANA zone, for display only) are both set or both null (`studies_closes_pair_check`). They are fixed after start, because updates are draft-only. Deleting a study cascades to its variants, links, votes and comments. `anon` has no table privileges.

## Limits

- **N (`studies.participant_target`): 1–100**, enforced by the check constraint `studies_participant_target_check`. N is the total number of links a study ever gets: anything that adds links later (S-07) must keep the total within 100.
- **Variants per study: 2–6.** Not a table constraint (drafts are edited row by row); enforced by `create_study` and again by `start_study`.
- Title 1–200 and variant content 1–2000 characters after trimming (table check constraints).

## Vote URL

Each link is served at **`/v/<token>`** (S-02 must serve this path; the author copies these URLs after `start_study`).

The page (`src/pages/v/[token].astro`, S-02) picks its screen in this order:

1. `?status=accepted` → thank-you „Dziękujemy za udział w badaniu” (no database call).
2. `get_ballot` returns `null` → „Badanie jest zakończone”.
3. Voted cookie present or `?status=used` → „Twój głos został już oddany”.
4. Otherwise the ballot (with `?error=` if present).

- Thank-you comes before „ended” on purpose: S-04 will auto-close a study on its last link, and the last voter's redirect must still show the thank-you. S-04 must keep this order.
- The voted cookie is scoped to path `/v/<token>` and set by the vote endpoint (`/api/v/<token>`) on `accepted` and `link_used`. It is a same-browser UI hint only: one vote per link is enforced solely by `cast_vote`. A missing cookie only means the ballot shows again (sending then returns `link_used`).
- Variants are shown in an order shuffled per link, deterministic from the token (stable across reloads, nothing stored).
- The page and every endpoint redirect send `Cache-Control: no-store`, `X-Robots-Tag: noindex` and `Referrer-Policy: same-origin`. Not `no-referrer`: with it the browser sends `Origin: null` on the vote POST and Astro's `checkOrigin` rejects it with 403. `same-origin` still keeps the token out of cross-site `Referer`.

## `public.create_study(p_title text, p_participant_target integer, p_variants text[], p_closes_local timestamp default null, p_closes_tz text default null) returns uuid`

Callable by `authenticated` only (`security invoker`: runs under the caller's grants and RLS). Creates a `draft` study owned by `auth.uid()` with one variant per array entry at `position` 0, 1, … in array order; title and variant contents are trimmed. Returns the study id.

- Raises `22023` when `p_variants` has fewer than 2 or more than 6 entries, or any entry is null or blank after trimming.
- Raises `23514` (check violation) when N is outside 1–100, the title is blank or over 200 characters, or a variant is over 2000 characters.
- Optional deadline: the author's local date and time `p_closes_local` plus the IANA zone `p_closes_tz` (from the browser). Stored as `closes_at = p_closes_local at time zone p_closes_tz`. Postgres resolves DST: a local time in the spring gap (e.g. 2027-03-28 02:30 Europe/Warsaw) is read with the offset before the jump (+01). The doubled autumn hour (2027-10-31 02:30) is read with the offset after the jump back (+01).
- Raises `22023` when only one of `p_closes_local` / `p_closes_tz` is given, the zone is not in `pg_timezone_names`, or the deadline is not in the future.
- Nothing is inserted when it raises.

## `public.start_study(p_study_id uuid) returns void`

Callable by `authenticated` only (`security definer`). Moves the caller's `draft` study to `active` and inserts exactly `participant_target` rows into `study_links` (tokens from the column default: 32 hex chars). Locks the study row first, so concurrent starts cannot generate two sets of links; on any error nothing is inserted or changed.

- Raises `P0002` when the caller owns no study with this id (unknown, someone else's, or no `auth.uid()`).
- Raises `55000` when the study is not `draft` (already started or closed).
- Raises `22023` when the study has fewer than 2 or more than 6 variants.
- Raises `22008` when the draft's deadline (`closes_at`) has already passed.

## `public.cast_vote(p_token text, p_variant_id uuid, p_comments jsonb default '[]') returns text`

Callable by `anon` and `authenticated`. The only write path for votes and comments.

- `p_comments`: JSON array of `{ "variant_id": uuid, "body": text }`. Blank bodies are skipped; bodies are trimmed.
- Return codes:
  - `accepted` — link consumed, vote and comments recorded.
  - `link_used` — the link was already used on an `active` study; nothing recorded.
  - `study_ended` — unknown token, or the study is `draft`/`closed`/deleted; nothing recorded.
- Raises SQLSTATE `22023` (link stays unused) when: `p_variant_id` is not a variant of the token's study; `p_comments` is not an array or an entry is not an object; a comment `variant_id` is missing, not a uuid, or not in the study; two comments share a `variant_id`; a body exceeds 2000 characters. Validation runs before the link is consumed, so errors never reveal whether a link is used.
- **Known, accepted limit:** whoever holds a token can test it, and authors hold every token of their studies (they distribute them). An author can therefore call `cast_vote` on each token: used links answer `link_used`, unused ones get consumed with a fake vote. This reveals per-link usage only by destroying the remaining links (visible in `responded`), so it is not a silent oracle. Blocking `authenticated` would not help, because the author can call as `anon`. Decision (S-01, `create-and-start-study`): authors keep reading raw tokens, because they distribute the links themselves; since the probe is destructive and shows up in `responded`, the limit is accepted.

## `public.get_ballot(p_token text) returns jsonb`

Callable by `anon` and `authenticated` (`security definer`, `stable`). The participant read path, called by the `/v/<token>` page. Grants no table access.

- Returns `null` for an unknown token, or when the token's study is deleted, `draft` or effectively closed (including past its deadline; see [Closing rule](#closing-rule)).
- Never reads `study_links.used`: a used and an unused link of the same active study return identical output.
- Returns no link id, token, `position`, study id, status or counts.

```json
{
  "title": "text",
  "variants": [{ "variant_id": "uuid", "content": "text" }]
}
```

- `variants` ordered by `position` (the page reorders them per link).
- Top-level keys are exactly `title, variants`; per-variant keys are exactly `variant_id, content`.

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

- `status` is the effective status (see [Closing rule](#closing-rule)): a study past its deadline reads `closed`.
- `responded`: count of used links; `total`: count of links.
- `variants` ordered by `position`; `comments` sorted by body (never insertion order).
- Top-level keys are exactly `status, responded, total, variants`; per-variant keys are exactly `variant_id, position, content, vote_count, comments`.

## Results view

The author's results on `/studies/<id>` (S-03, change `live-results-and-comments`). S-04, S-05 and S-07 must keep these rules.

- **`GET /api/studies/<id>/results`** returns the `get_study_results` JSON unchanged (`200`, `Content-Type: application/json`, `Cache-Control: no-store`) and adds no fields (no server time, no content-derived ETag). `404` when the caller does not own the study or the id is not a uuid; `500` on any other error. Classified `author` in `src/lib/route-access.ts`, so the middleware redirects a signed-out request to `/auth/signin` (decided by the matched route pattern, not the URL path).
- **Ranking** (`rankVariants` in `src/lib/study-results.ts`): `vote_count` descending, then `position` ascending. Place = 1 + number of variants with a strictly greater `vote_count`, so 5, 5, 2, 0 votes → places 1, 1, 3, 4. Variants with 0 votes are ranked too.
- **„Odpowiedziało X z N”**: X = `responded`, N = `total` (the live link count), not `studies.participant_target` — S-07 adds links mid-study.
- **Live refresh**: the page polls the endpoint every 10 s only while the last known `status` is `active` and the tab is visible (an immediate request when it becomes visible again). Polling stops for good when a response is not `active`, on `404`, or when the session expired. Each response replaces the whole view; nothing marks what changed (see [Anonymity rule](#anonymity-rule)).
