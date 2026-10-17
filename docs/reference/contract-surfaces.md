# Contract surfaces

Load-bearing names that later slices build on. Renaming or reshaping any of them is a breaking change: it needs a forward-fix migration, regenerated types (`npx supabase gen types typescript --local > src/lib/database.types.ts`) and updated pgTAP tests in `supabase/tests/`.

Source of truth: `supabase/migrations/20261002095727_study_data_model.sql` and `20261002124043_cast_vote_comment_uuid_errcode.sql` (change `study-data-model`), plus `20261005075735_create_and_start_study.sql` (change `create-and-start-study`) `20261005132123_one_time_link_voting.sql` (change `one-time-link-voting`) and `20261015130000_study_closing_rules.sql` `20261015150000_study_closing_vote_path.sql` and `20261015170000_study_deadline_zone_hardening.sql` (change `study-closing-rules`), plus `20261015210000_author_study_dashboard.sql` (change `author-study-dashboard`), plus `20261015221845_edit_and_delete_study.sql` (change `edit-and-delete-study`), plus `20261016181615_generate_extra_links.sql` (change `generate-extra-links`), plus `20261017120000_image_variants.sql` (change `image-variants`). Applied migrations are never edited; change behaviour with a new forward migration.

## Anonymity rule

**Authors never read `votes`, `comments`, or `study_links.used`.** `anon` and `authenticated` have no privileges on `votes` and `comments`, and `authenticated` can select only `study_links (id, study_id, token, position)`. `position` reveals creation order only (1…total per study), never usage. Authors see votes and comments only as aggregates through `get_study_results`. Link usage reaches authors only as per-study counts (`responded`, `total`) through `get_study_results` and `list_author_studies`. `votes` and `comments` never get a link reference, a timestamp or a serial/identity column. `supabase/tests/study_anonymity.test.sql` enforces this.

**No participant-reachable read reveals `study_links.used`.** The only way to learn a link's state is `cast_vote`, which consumes an unused link. `get_ballot` never reads `used` and returns identical output for a used and an unused link; `supabase/tests/get_ballot.test.sql` enforces this. Any later participant-facing read (S-03, S-04, S-06) must keep this rule.

**The results UI never marks what changed between refreshes** (no highlight, animation or new-item count) and renders comments in the order `get_study_results` returns them. Accepted limit: with few votes, comparing two snapshots shows which variant gained a vote and which comments arrived together, and when; this is inherent to live results (FR-013) and to a plain reload, and is accepted for the MVP. See [Results view](#results-view).

**Accepted operator-level exposure.** Cloudflare Workers observability (`wrangler.jsonc`) logs request URLs with timestamps, so `/v/<token>`, `/api/v/<token>` and the `?status=accepted|used` redirects show per-link vote timing to whoever holds the Cloudflare account. This is outside the author threat model (the operator can already read the database) and is accepted for the MVP; revisit if account access widens or logs leave the account.

## Enum `public.study_status`

`draft` | `active` | `closed`

## Enum `public.variant_kind`

`text` | `image`

## Closing rule

A study is **effectively closed** when `status = 'closed'`, or when `status = 'active'` and `now() >= closes_at`. The boundary belongs to the closed side: at exactly `closes_at` the study is closed.

- The deadline is computed, never written. A study past its deadline keeps `status = 'active'` in the table. **Every reader must use `study_status_effective` (SQL) or the `effective_status` computed field (PostgREST), never `studies.status` alone.**
- `get_ballot`, `get_study_results` and the open check in `cast_vote` apply the rule.
- **Only two paths write `closed`**, and both lock the study row first (`FOR NO KEY UPDATE`):
  - `close_study`: the manual, irreversible close by the owner;
  - `cast_vote`: when the vote it records used the study's last unused link. It counts unused links live, so links added later (S-07) keep it correct.
- **Lock order is study → link** in every writer (`start_study`, `update_study_draft`, `cast_vote`, `add_study_links`, the delete cascade). New writers must keep it.
- The participant never learns why a study ended. Every closed study looks the same as an unknown token (`get_ballot` → `null`).

## `public.study_status_effective(p_status study_status, p_closes_at timestamptz) returns study_status`

The closing rule in one body (`stable`, `security invoker`). Returns `'closed'` for an `active` status at or past `p_closes_at`, otherwise `p_status` unchanged. Callable by `authenticated`; not by `anon`.

## `public.effective_status(s public.studies) returns study_status`

PostgREST computed field over `studies` (`select("…, effective_status")`), delegating to `study_status_effective`. Deliberately a different name from the scalar function, so nothing is overloaded. Callable by `authenticated`; not by `anon`.

## Tables

| Table                | Columns                                                                                                                                 | Author access (`authenticated`)                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `public.studies`     | `id`, `author_id` (default `auth.uid()`), `title`, `participant_target`, `status`, `closes_at`, `closes_tz`, `created_at`, `updated_at` | select/delete own; insert `title`, `participant_target`, `closes_at`, `closes_tz`; update only `title`, `participant_target`, only while `draft` |
| `public.variants`    | `id`, `study_id`, `position`, `kind`, `content`, `image_path`                                                                           | select own; insert `study_id, position, kind, content, image_path`, update `position, kind, content, image_path`, delete: own `draft` only       |
| `public.study_links` | `id`, `study_id`, `token`, `position`, `used`                                                                                           | select `id, study_id, token, position` of own studies; no access to `used`                                                                       |
| `public.votes`       | `id`, `study_id`, `variant_id`                                                                                                          | none                                                                                                                                             |
| `public.comments`    | `id`, `study_id`, `variant_id`, `body`                                                                                                  | none                                                                                                                                             |

A variant is either **text** (`kind = 'text'`, `content` is the text, `image_path` null) or an **image** (`kind = 'image'`, `content` is its description, `image_path` the object name in the [`variant-images`](#storage-variant-images) bucket), enforced by `variants_kind_image_check`. One object backs at most one variant across all studies (partial unique index `variants_image_path_key`); the write RPCs refuse a reused path with `23514` before the index's `23505` can fire. Existing variants are `text` (column default).

`studies.status` is in no column grant: only `security definer` functions change it. `closes_at` (absolute instant) and `closes_tz` (the author's IANA zone, for display only) are both set or both null (`studies_closes_pair_check`). Only `create_study` and `update_study_draft` update them (no column update grant), but the column insert grant remains, so an author inserting a row directly can store a zone those functions would refuse. A page formatting a zone it cannot handle falls back to UTC, and the edit form then sends UTC back with the UTC value (`inputZone`). `study_links.position` is 1…total per study (`unique (study_id, position)`): `start_study` assigns 1…N, `add_study_links` appends after the current maximum, and an insert that omits it (test fixtures) gets the next free number from the `study_links_set_position` trigger. Deleting a study cascades to its variants, links, votes and comments. Deleting an `active` study (allowed in any status by the delete policy) breaks its links: they answer like an unknown token, so `get_ballot` → `null` („Badanie jest zakończone”) and `cast_vote` → `study_ended`. `anon` has no table privileges.

## Limits

- **N (`studies.participant_target`): 1–100**, enforced by the check constraint `studies_participant_target_check`. N is the total number of links a study ever gets: anything that adds links later (S-07) must keep the total within 100. N rises with every addition: `add_study_links` sets it to the live link count after the insert.
- **Variants per study: 2–6.** Not a table constraint (drafts are edited row by row); enforced by `create_study`, `update_study_draft` and again by `start_study`.
- Title 1–200 and variant content 1–2000 characters after trimming (table check constraints).
- **Image variants:** description (`content`) 1–200 characters after trimming (`variants_kind_image_check`); stored file at most 1 MiB (1 048 576 bytes), `image/webp` or `image/jpeg` only (bucket limits); object name `<uuid>.webp` or `<uuid>.jpg`. Text and image variants share the 2–6 count.

## Vote URL

Each link is served at **`/v/<token>`** (S-02 must serve this path; the author copies these URLs after `start_study`).

The page (`src/pages/v/[token].astro`, S-02) picks its screen in this order:

1. `?status=accepted` → thank-you „Dziękujemy za udział w badaniu” (no database call).
2. `get_ballot` returns `null` → „Badanie jest zakończone”.
3. Voted cookie present or `?status=used` → „Twój głos został już oddany”.
4. Otherwise the ballot (with `?error=` if present).

- Thank-you comes before „ended” on purpose: `cast_vote` auto-closes a study on its last link (S-04), and the last voter's redirect must still show the thank-you. Keep this order.
- The voted cookie is scoped to path `/v/<token>` and set by the vote endpoint (`/api/v/<token>`) on `accepted` and `link_used`. It is a same-browser UI hint only: one vote per link is enforced solely by `cast_vote`. A missing cookie only means the ballot shows again (sending then returns `link_used`).
- Variants are shown in an order shuffled per link, deterministic from the token (stable across reloads, nothing stored).
- The page and every endpoint redirect send `Cache-Control: no-store`, `X-Robots-Tag: noindex` and `Referrer-Policy: same-origin`. Not `no-referrer`: with it the browser sends `Origin: null` on the vote POST and Astro's `checkOrigin` rejects it with 403. `same-origin` still keeps the token out of cross-site `Referer`.

## `public.create_study(p_title text, p_participant_target integer, p_variant_items jsonb, p_closes_local timestamp default null, p_closes_tz text default null) returns uuid`

Callable by `authenticated` only (`security invoker`: runs under the caller's grants and RLS). Creates a `draft` study owned by `auth.uid()` with one variant per array entry at `position` 0, 1, … in array order; title and variant contents are trimmed. Returns the study id.

- `p_variant_items`: JSON array of `{ "kind": "text" | "image", "content": text, "image_path": text | null }`. For `text`, `image_path` must be null; for `image`, `content` is the description and `image_path` names an object in `variant-images` that exists and is owned by the caller (`owner_id = auth.uid()`).
- The parameter is deliberately not called `p_variants`: PostgREST picks an overload by argument names only, so two overloads sharing every name are ambiguous (`PGRST203`).
- Raises `22023` when `p_variant_items` is not an array of 2 to 6 entries, or any entry's `content` is null or blank after trimming.
- Raises `23514` (check violation) when N is outside 1–100, the title is blank or over 200 characters, a variant is over 2000 characters, or for any variant-shape violation: an entry that is not an object, an unknown `kind`, a non-string `content` / `image_path`, a text variant with an `image_path`, an image variant without a valid `image_path` or with a description over 200 characters, an `image_path` used twice in the payload or already used by another variant, or an image that is missing or not the caller's.
- Optional deadline: the author's local date and time `p_closes_local` plus the IANA zone `p_closes_tz` (from the browser). Stored as `closes_at = p_closes_local at time zone p_closes_tz`. Postgres resolves DST: a local time in the spring gap (e.g. 2027-03-28 02:30 Europe/Warsaw) is read with the offset before the jump (+01). The doubled autumn hour (2027-10-31 02:30) is read with the offset after the jump back (+01).
- Raises `22023` when only one of `p_closes_local` / `p_closes_tz` is given, the zone is not in `pg_timezone_names` or is one Intl cannot format (`posix/…`, `right/…`, `Factory`, `localtime`, `posixrules`), or the deadline is not in the future.
- Nothing is inserted when it raises.

**Temporary `text[]` wrapper:** `create_study(p_title text, p_participant_target integer, p_variants text[], p_closes_local timestamp default null, p_closes_tz text default null) returns uuid` (`security invoker`, `authenticated` only) maps every entry to `{kind: 'text', content, image_path: null}` and calls the `jsonb` version, so the app deployed before `image-variants` keeps working between `db push` and deploy. It is dropped in a follow-up migration; new code must call `p_variant_items`.

## `public.update_study_draft(p_study_id uuid, p_title text, p_participant_target integer, p_variant_items jsonb, p_closes_local timestamp default null, p_closes_tz text default null) returns void`

Callable by `authenticated` only (`security definer`). The only write path for editing a draft, including its deadline (change `edit-and-delete-study`, S-06). Locks the study row first (`FOR UPDATE`, filtered by `auth.uid()`), so it is serialized with `start_study`: variants never change under a started study.

- **Replace semantics:** the whole draft is replaced. Title (trimmed), N and the deadline are overwritten; omitting both deadline arguments (null/null) clears the deadline. All variants are deleted and the new list is inserted at `position` 0, 1, … in array order with trimmed contents (new variant ids).
- `p_variant_items` has the same element shape and rules as in `create_study`. An `image_path` already held by one of this draft's current variants may be kept; one held by any other study's variant is refused. The function does not touch storage: removing objects that are no longer referenced is the caller's job (Storage API).
- Raises `P0002` when the caller owns no study with this id (unknown, someone else's, or no `auth.uid()`).
- Raises `55000` when the study is not `draft` (active or closed).
- Raises `22023` for the same variant and deadline rules as `create_study` (2–6 variants, none null or blank; both or neither deadline value; an Intl-formattable zone from `pg_timezone_names`; a deadline in the future). The deadline is stored as `p_closes_local at time zone p_closes_tz`.
- Raises `23514` (check violation) when N is outside 1–100, the title is blank or over 200 characters, a variant is over 2000 characters, or for the same variant-shape, image ownership and path-reuse rules as `create_study`.
- Nothing changes when it raises.

**Temporary `text[]` wrapper:** `update_study_draft(p_study_id uuid, p_title text, p_participant_target integer, p_variants text[], p_closes_local timestamp default null, p_closes_tz text default null) returns void` (`security invoker`, `authenticated` only) maps every entry to a text variant and calls the `jsonb` version. Dropped in the same follow-up migration as the `create_study` wrapper.

## `public.start_study(p_study_id uuid) returns void`

Callable by `authenticated` only (`security definer`). Moves the caller's `draft` study to `active` and inserts exactly `participant_target` rows into `study_links` at `position` 1…N (tokens from the column default: 32 hex chars). Locks the study row first, so concurrent starts cannot generate two sets of links; on any error nothing is inserted or changed.

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
  - `study_ended` — unknown token, or the study is `draft`, effectively closed (including past its deadline) or deleted; nothing recorded.
- `cast_vote` locks the token's study row (`FOR NO KEY UPDATE`) before validating and consuming. Votes on one study therefore run one after another, and none can slip past a concurrent close (`supabase/tests/study_closing_race.test.sql`).
- The vote that uses the study's last unused link also sets `status = 'closed'` and still returns `accepted`, so that voter sees the thank-you screen. See [Vote URL](#vote-url).
- Raises SQLSTATE `22023` (link stays unused) when: `p_variant_id` is not a variant of the token's study; `p_comments` is not an array or an entry is not an object; a comment `variant_id` is missing, not a uuid, or not in the study; two comments share a `variant_id`; a body exceeds 2000 characters. Validation runs before the link is consumed, so errors never reveal whether a link is used.
- **Known, accepted limit:** whoever holds a token can test it, and authors hold every token of their studies (they distribute them). An author can therefore call `cast_vote` on each token: used links answer `link_used`, unused ones get consumed with a fake vote. This reveals per-link usage only by destroying the remaining links (visible in `responded`), so it is not a silent oracle. Blocking `authenticated` would not help, because the author can call as `anon`. Decision (S-01, `create-and-start-study`): authors keep reading raw tokens, because they distribute the links themselves; since the probe is destructive and shows up in `responded`, the limit is accepted.

## `public.close_study(p_study_id uuid) returns void`

Callable by `authenticated` only (`security definer`). Closes the caller's effectively active study. The close is irreversible, and there is no reopen. It locks the study row first, so it is serialized with votes in flight: a vote either commits before the close, or waits for it and then returns `study_ended`.

- Raises `P0002` when the caller owns no study with this id (unknown, someone else's, or no `auth.uid()`).
- Raises `55000` when the study is not effectively active: `draft`, already `closed`, or past its deadline.

## `public.add_study_links(p_study_id uuid, p_count integer) returns void`

Callable by `authenticated` only (`security definer`). Appends `p_count` links to the caller's effectively active study (change `generate-extra-links`, S-07). Locks the study row first (`FOR NO KEY UPDATE`), before reading the status or the links, so it is serialized with `cast_vote`'s last-link auto-close and with `close_study`: either the links are added first (the vote then sees unused links and does not close the study), or the close commits first (the add then raises `55000`). Links are never added to a closed study (`supabase/tests/generate_extra_links_race.test.sql`).

- New links get `position` max + 1 … max + `p_count` and tokens from the column default.
- **N semantics:** `participant_target` becomes the live link count before the call plus `p_count`, so after any addition N equals the study's number of links.
- Raises `P0002` when the caller owns no study with this id (unknown, someone else's, or no `auth.uid()`).
- Raises `55000` when the study is not effectively active: `draft`, `closed`, or past its deadline.
- Raises `22023` when `p_count` is null or below 1.
- Raises `23514` (`studies_participant_target_check`) when the new N would exceed 100.
- Nothing changes when it raises.

## `public.get_ballot(p_token text) returns jsonb`

Callable by `anon` and `authenticated` (`security definer`, `stable`). The participant read path, called by the `/v/<token>` page. Grants no table access.

- Returns `null` for an unknown token, or when the token's study is deleted, `draft` or effectively closed (including past its deadline; see [Closing rule](#closing-rule)).
- Never reads `study_links.used`: a used and an unused link of the same active study return identical output.
- Returns no link id, token, `position`, study id, status or counts.

```json
{
  "title": "text",
  "variants": [{ "variant_id": "uuid", "kind": "text | image", "content": "text", "image_path": "text | null" }]
}
```

- `variants` ordered by `position` (the page reorders them per link).
- Top-level keys are exactly `title, variants`; per-variant keys are exactly `variant_id, kind, content, image_path`. For an image variant `content` is the description (the image's alt text) and `image_path` is the object name the page signs (see [Storage](#storage-variant-images)); for text `image_path` is null.

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
      "kind": "text | image",
      "content": "text",
      "image_path": "text | null",
      "vote_count": 0,
      "comments": ["body", "..."]
    }
  ]
}
```

- `status` is the effective status (see [Closing rule](#closing-rule)): a study past its deadline reads `closed`.
- `responded`: count of used links; `total`: count of links.
- `variants` ordered by `position`; `comments` sorted by body (never insertion order).
- Top-level keys are exactly `status, responded, total, variants`; per-variant keys are exactly `variant_id, position, kind, content, image_path, vote_count, comments`.

## Storage: `variant-images`

The only bucket. Created by migration (`insert into storage.buckets`), not by `config.toml`, so local, CI and production share one definition.

- **Private** (`public = false`): no public URL. Files are served only through signed URLs.
- `file_size_limit = 1048576` (1 MiB), `allowed_mime_types = {image/webp, image/jpeg}`.
- **Naming:** `<uuid>.webp` or `<uuid>.jpg` at the bucket root (`^[0-9a-f-]{36}\.(webp|jpg)$`). The name appears in participant-visible signed URLs, so it never contains the author id or any study data. Ownership is `storage.objects.owner_id`, set by the Storage API to the uploader's `auth.uid()`.
- **Policies on `storage.objects`**, all `to authenticated` and scoped to `bucket_id = 'variant-images'`:
  - insert: only with a name matching the pattern;
  - select and delete: only own objects (`owner_id = auth.uid()::text`);
  - no update policy and nothing for `anon`. Another author's objects are invisible, so they cannot be signed, read or deleted.
- Direct SQL `DELETE` on `storage.objects` is blocked by Storage's `protect_objects_delete` trigger; objects are removed only through the Storage API (`remove`).
- **Signed URL TTLs:** participant ballot 600 s; author views (draft, edit, results) 3600 s.
- **Secret-key ordering rule:** `SUPABASE_SECRET_KEY` is used in exactly one place, signing participant image paths on `/v/<token>`, and only **after** `get_ballot` returned a non-null ballot. A closed, deleted or unknown token gets no image URL. Author views sign with the author's own session.

## `public.list_author_studies() returns table (id uuid, title text, status study_status, participant_target integer, responded integer, total integer, created_at timestamptz)`

Callable by `authenticated` only (`security definer`, `stable`). The author's study list, called by `/dashboard` (S-05, change `author-study-dashboard`). Grants no table access.

- Rows: the studies whose `author_id = auth.uid()`; no `auth.uid()` returns zero rows. Ordered by `created_at desc, id`.
- `status` is the effective status (see [Closing rule](#closing-rule)).
- `responded`: count of used links; `total`: count of links. Both are `0` for a draft.
- Columns are exactly `id, title, status, participant_target, responded, total, created_at`.
- Progress „Odpowiedziało X z N” for a started study uses N = `total`, the live link count (as in [Results view](#results-view)). A draft has no links, so the dashboard shows its planned `participant_target` instead („Planowane: N uczestników”).

## Results view

The author's results on `/studies/<id>` (S-03, change `live-results-and-comments`). S-04, S-05 and S-07 must keep these rules.

- **`GET /api/studies/<id>/results`** returns the `get_study_results` JSON unchanged (`200`, `Content-Type: application/json`, `Cache-Control: no-store`) and adds no fields (no server time, no content-derived ETag). `404` when the caller does not own the study or the id is not a uuid; `500` on any other error. Classified `author` in `src/lib/route-access.ts`, so the middleware redirects a signed-out request to `/auth/signin` (decided by the matched route pattern, not the URL path).
- **Ranking** (`rankVariants` in `src/lib/study-results.ts`): `vote_count` descending, then `position` ascending. Place = 1 + number of variants with a strictly greater `vote_count`, so 5, 5, 2, 0 votes → places 1, 1, 3, 4. Variants with 0 votes are ranked too.
- **„Odpowiedziało X z N”**: X = `responded`, N = `total` (the live link count), not `studies.participant_target` — S-07 adds links mid-study.
- **Live refresh**: the page polls the endpoint every 10 s only while the last known `status` is `active` and the tab is visible (an immediate request when it becomes visible again). Polling stops for good when a response is not `active`, on `404`, or when the session expired. Each response replaces the whole view; nothing marks what changed (see [Anonymity rule](#anonymity-rule)).
