-- image-variants (S-08), part 1: image variants in the schema, the private
-- variant-images bucket, and jsonb variant input for create and edit.
-- Forward-only: earlier migrations are applied in production and must not be
-- edited.
--
--   * a variant is either text (`content` is the text, no image) or an image
--     (`content` is its required 1-200 character description, `image_path`
--     the object name in variant-images). Existing rows backfill to 'text'
--     through the column default.
--   * object names are `<uuid>.webp|jpg`: they end up in participant-visible
--     signed URLs, so they never contain the author id. Ownership is
--     storage.objects.owner_id (set by the Storage API to the uploader's
--     auth.uid()), not a folder convention.
--   * one object backs at most one variant (partial unique index). The write
--     RPCs reject a reused path themselves with 23514; the index's 23505 is
--     only a backstop and never the user-facing path.
--   * create_study / update_study_draft get jsonb overloads with a
--     differently named parameter, p_variant_items: PostgREST picks an
--     overload by argument names only, so a second `p_variants` overload
--     would make every named-argument call ambiguous (PGRST203). The text[]
--     signatures stay as thin security invoker wrappers so the deployed app
--     keeps working between `db push` and deploy; a follow-up migration
--     drops them.
--   * get_ballot and get_study_results gain per-variant `kind` and
--     `image_path`; gating and every other key are unchanged.
--
-- Storage: the bucket is private (no public URL). Authors upload, read and
-- delete only their own objects; there is no update policy and nothing for
-- anon. Direct SQL deletes on storage.objects are additionally blocked by
-- Storage's protect_objects_delete trigger; app cleanup goes through the
-- Storage API.
--
-- Grants: Supabase gives anon EXECUTE on new functions in public, so every
-- function created or recreated here revokes it explicitly.

-- ---------------------------------------------------------------------------
-- variants: kind and image
-- ---------------------------------------------------------------------------

create type public.variant_kind as enum ('text', 'image');

alter table public.variants
  add column kind public.variant_kind not null default 'text',
  add column image_path text,
  -- `image_path is not null` is load-bearing: `null ~ pattern` is NULL and a
  -- CHECK passes on NULL, so an image row without a path would slip through.
  add constraint variants_kind_image_check check (
    (kind = 'text' and image_path is null)
    or (
      kind = 'image'
      and image_path is not null
      and image_path ~ '^[0-9a-f-]{36}\.(webp|jpg)$'
      and char_length(btrim(content)) <= 200
    )
  );

create unique index variants_image_path_key
  on public.variants (image_path)
  where image_path is not null;

-- Draft-only RLS on variants still applies to direct writes.
grant insert (kind, image_path) on public.variants to authenticated;
grant update (kind, image_path) on public.variants to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: the private variant-images bucket and its policies
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('variant-images', 'variant-images', false, 1048576, array['image/webp', 'image/jpeg']);

create policy "variant-images: authors insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'variant-images'
    and name ~ '^[0-9a-f-]{36}\.(webp|jpg)$'
  );

create policy "variant-images: authors select own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'variant-images'
    and owner_id = (select auth.uid()::text)
  );

create policy "variant-images: authors delete own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'variant-images'
    and owner_id = (select auth.uid()::text)
  );

-- ---------------------------------------------------------------------------
-- create_study (jsonb): variants as [{kind, content, image_path}]. Deadline
-- handling unchanged from 20261015170000_study_deadline_zone_hardening.sql.
-- ---------------------------------------------------------------------------

create function public.create_study(
  p_title text,
  p_participant_target integer,
  p_variant_items jsonb,
  p_closes_local timestamp default null,
  p_closes_tz text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer := case
    when jsonb_typeof(p_variant_items) = 'array' then jsonb_array_length(p_variant_items)
    else 0
  end;
  v_closes_at timestamptz;
  v_study_id uuid;
begin
  if v_count < 2 or v_count > 6 then
    raise exception 'create_study: a study needs 2 to 6 variants, got %', v_count
      using errcode = '22023';
  end if;

  -- Variant validation is mirrored in update_study_draft (jsonb); keep them in sync.
  if exists (
    select 1 from jsonb_array_elements(p_variant_items) as e (item)
     where jsonb_typeof(e.item) is distinct from 'object'
        or jsonb_typeof(e.item -> 'kind') is distinct from 'string'
        or (e.item ->> 'kind') not in ('text', 'image')
        or coalesce(jsonb_typeof(e.item -> 'content'), 'null') not in ('string', 'null')
        or coalesce(jsonb_typeof(e.item -> 'image_path'), 'null') not in ('string', 'null')
  ) then
    raise exception 'create_study: each variant must be {kind: text|image, content, image_path}'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_variant_items) as e (item)
     where e.item ->> 'content' is null or btrim(e.item ->> 'content') = ''
  ) then
    raise exception 'create_study: variants must not be blank'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_variant_items) as e (item)
     where e.item ->> 'kind' = 'text' and e.item ->> 'image_path' is not null
  ) then
    raise exception 'create_study: a text variant has no image_path'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_variant_items) as e (item)
     where e.item ->> 'kind' = 'image'
       and (e.item ->> 'image_path' is null
            or (e.item ->> 'image_path') !~ '^[0-9a-f-]{36}\.(webp|jpg)$'
            or char_length(btrim(e.item ->> 'content')) > 200)
  ) then
    raise exception 'create_study: an image variant needs a valid image_path and a description of at most 200 characters'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_variant_items) as e (item)
     where e.item ->> 'image_path' is not null
     group by e.item ->> 'image_path'
    having count(*) > 1
  ) then
    raise exception 'create_study: an image is used by more than one variant'
      using errcode = '23514';
  end if;

  -- security invoker: the "variant-images: authors select own" policy limits
  -- this to the caller's own objects.
  if exists (
    select 1 from jsonb_array_elements(p_variant_items) as e (item)
     where e.item ->> 'kind' = 'image'
       and not exists (
         select 1 from storage.objects o
          where o.bucket_id = 'variant-images'
            and o.name = e.item ->> 'image_path'
            and o.owner_id = (select auth.uid()::text)
       )
  ) then
    raise exception 'create_study: an image is missing or not owned by the caller'
      using errcode = '23514';
  end if;

  -- Variant RLS limits this to the caller's own studies; another author's
  -- variant can only hold an object the caller does not own, which the check
  -- above already refused.
  if exists (
    select 1 from public.variants v
     where v.image_path in (
       select e.item ->> 'image_path'
         from jsonb_array_elements(p_variant_items) as e (item)
        where e.item ->> 'image_path' is not null
     )
  ) then
    raise exception 'create_study: an image is already used by another variant'
      using errcode = '23514';
  end if;

  if (p_closes_local is null) <> (p_closes_tz is null) then
    raise exception 'create_study: a deadline needs both a local time and a time zone'
      using errcode = '22023';
  end if;

  if p_closes_tz is not null then
    -- pg_timezone_names also lists names Intl rejects (posix/…, Factory); the author page
    -- formats the deadline with Intl, so only names it can format are accepted.
    if not exists (
      select 1 from pg_catalog.pg_timezone_names z
       where z.name = p_closes_tz
         and z.name not like 'posix/%'
         and z.name not like 'right/%'
         and z.name not in ('Factory', 'localtime', 'posixrules')
    ) then
      raise exception 'create_study: unknown time zone %', p_closes_tz
        using errcode = '22023';
    end if;

    v_closes_at := p_closes_local at time zone p_closes_tz;

    if v_closes_at <= now() then
      raise exception 'create_study: the deadline % is not in the future', v_closes_at
        using errcode = '22023';
    end if;
  end if;

  insert into public.studies (title, participant_target, closes_at, closes_tz)
  values (btrim(p_title), p_participant_target, v_closes_at, p_closes_tz)
  returning id into v_study_id;

  insert into public.variants (study_id, position, kind, content, image_path)
  select v_study_id,
         (e.ord - 1)::smallint,
         (e.item ->> 'kind')::public.variant_kind,
         btrim(e.item ->> 'content'),
         e.item ->> 'image_path'
    from jsonb_array_elements(p_variant_items) with ordinality as e (item, ord);

  return v_study_id;
end;
$$;

revoke execute on function public.create_study(text, integer, jsonb, timestamp, text) from public, anon;
grant execute on function public.create_study(text, integer, jsonb, timestamp, text) to authenticated;

-- ---------------------------------------------------------------------------
-- create_study (text[]): temporary wrapper, every entry a text variant.
-- Dropped in a follow-up migration once the jsonb-calling app is deployed.
-- ---------------------------------------------------------------------------

create or replace function public.create_study(
  p_title text,
  p_participant_target integer,
  p_variants text[],
  p_closes_local timestamp default null,
  p_closes_tz text default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select public.create_study(
    p_title => p_title,
    p_participant_target => p_participant_target,
    p_variant_items => coalesce((
      select jsonb_agg(
               jsonb_build_object('kind', 'text', 'content', v.content, 'image_path', null)
               order by v.ord
             )
        from unnest(p_variants) with ordinality as v (content, ord)
    ), '[]'::jsonb),
    p_closes_local => p_closes_local,
    p_closes_tz => p_closes_tz
  );
$$;

revoke execute on function public.create_study(text, integer, text[], timestamp, text) from public, anon;
grant execute on function public.create_study(text, integer, text[], timestamp, text) to authenticated;

-- ---------------------------------------------------------------------------
-- update_study_draft (jsonb): replace the caller's draft atomically, as in
-- 20261015221845_edit_and_delete_study.sql, with image variants.
-- ---------------------------------------------------------------------------

create function public.update_study_draft(
  p_study_id uuid,
  p_title text,
  p_participant_target integer,
  p_variant_items jsonb,
  p_closes_local timestamp default null,
  p_closes_tz text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.study_status;
  v_count integer := case
    when jsonb_typeof(p_variant_items) = 'array' then jsonb_array_length(p_variant_items)
    else 0
  end;
  v_closes_at timestamptz;
begin
  -- Lock the row first: a concurrent start_study waits here (or we wait for
  -- it and then see `active`), so variants never change under a started study.
  select s.status
    into v_status
    from public.studies s
   where s.id = p_study_id
     and s.author_id = auth.uid()
     for update;

  if not found then
    raise exception 'update_study_draft: study % not found', p_study_id
      using errcode = 'P0002';
  end if;

  if v_status <> 'draft' then
    raise exception 'update_study_draft: study % is %, not draft', p_study_id, v_status
      using errcode = '55000';
  end if;

  -- Variant and deadline validation mirror create_study (jsonb); keep them in sync.
  if v_count < 2 or v_count > 6 then
    raise exception 'update_study_draft: a study needs 2 to 6 variants, got %', v_count
      using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_variant_items) as e (item)
     where jsonb_typeof(e.item) is distinct from 'object'
        or jsonb_typeof(e.item -> 'kind') is distinct from 'string'
        or (e.item ->> 'kind') not in ('text', 'image')
        or coalesce(jsonb_typeof(e.item -> 'content'), 'null') not in ('string', 'null')
        or coalesce(jsonb_typeof(e.item -> 'image_path'), 'null') not in ('string', 'null')
  ) then
    raise exception 'update_study_draft: each variant must be {kind: text|image, content, image_path}'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_variant_items) as e (item)
     where e.item ->> 'content' is null or btrim(e.item ->> 'content') = ''
  ) then
    raise exception 'update_study_draft: variants must not be blank'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_variant_items) as e (item)
     where e.item ->> 'kind' = 'text' and e.item ->> 'image_path' is not null
  ) then
    raise exception 'update_study_draft: a text variant has no image_path'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_variant_items) as e (item)
     where e.item ->> 'kind' = 'image'
       and (e.item ->> 'image_path' is null
            or (e.item ->> 'image_path') !~ '^[0-9a-f-]{36}\.(webp|jpg)$'
            or char_length(btrim(e.item ->> 'content')) > 200)
  ) then
    raise exception 'update_study_draft: an image variant needs a valid image_path and a description of at most 200 characters'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_variant_items) as e (item)
     where e.item ->> 'image_path' is not null
     group by e.item ->> 'image_path'
    having count(*) > 1
  ) then
    raise exception 'update_study_draft: an image is used by more than one variant'
      using errcode = '23514';
  end if;

  -- security definer: the owner check is explicit (owner_id = auth.uid()).
  if exists (
    select 1 from jsonb_array_elements(p_variant_items) as e (item)
     where e.item ->> 'kind' = 'image'
       and not exists (
         select 1 from storage.objects o
          where o.bucket_id = 'variant-images'
            and o.name = e.item ->> 'image_path'
            and o.owner_id = (select auth.uid()::text)
       )
  ) then
    raise exception 'update_study_draft: an image is missing or not owned by the caller'
      using errcode = '23514';
  end if;

  -- This draft's own variants are about to be replaced, so they may keep
  -- their images; any other study's may not.
  if exists (
    select 1 from public.variants v
     where v.study_id <> p_study_id
       and v.image_path in (
         select e.item ->> 'image_path'
           from jsonb_array_elements(p_variant_items) as e (item)
          where e.item ->> 'image_path' is not null
       )
  ) then
    raise exception 'update_study_draft: an image is already used by another variant'
      using errcode = '23514';
  end if;

  if (p_closes_local is null) <> (p_closes_tz is null) then
    raise exception 'update_study_draft: a deadline needs both a local time and a time zone'
      using errcode = '22023';
  end if;

  if p_closes_tz is not null then
    -- pg_timezone_names also lists names Intl rejects (posix/…, Factory); the author page
    -- formats the deadline with Intl, so only names it can format are accepted.
    if not exists (
      select 1 from pg_catalog.pg_timezone_names z
       where z.name = p_closes_tz
         and z.name not like 'posix/%'
         and z.name not like 'right/%'
         and z.name not in ('Factory', 'localtime', 'posixrules')
    ) then
      raise exception 'update_study_draft: unknown time zone %', p_closes_tz
        using errcode = '22023';
    end if;

    v_closes_at := p_closes_local at time zone p_closes_tz;

    if v_closes_at <= now() then
      raise exception 'update_study_draft: the deadline % is not in the future', v_closes_at
        using errcode = '22023';
    end if;
  end if;

  -- Title, N and content limits are table checks (23514). Null/null clears
  -- the deadline.
  update public.studies s
     set title = btrim(p_title),
         participant_target = p_participant_target,
         closes_at = v_closes_at,
         closes_tz = p_closes_tz
   where s.id = p_study_id;

  delete from public.variants v
   where v.study_id = p_study_id;

  insert into public.variants (study_id, position, kind, content, image_path)
  select p_study_id,
         (e.ord - 1)::smallint,
         (e.item ->> 'kind')::public.variant_kind,
         btrim(e.item ->> 'content'),
         e.item ->> 'image_path'
    from jsonb_array_elements(p_variant_items) with ordinality as e (item, ord);
end;
$$;

revoke execute on function public.update_study_draft(uuid, text, integer, jsonb, timestamp, text) from public, anon;
grant execute on function public.update_study_draft(uuid, text, integer, jsonb, timestamp, text) to authenticated;

-- ---------------------------------------------------------------------------
-- update_study_draft (text[]): temporary wrapper, every entry a text variant.
-- Dropped in a follow-up migration once the jsonb-calling app is deployed.
-- ---------------------------------------------------------------------------

create or replace function public.update_study_draft(
  p_study_id uuid,
  p_title text,
  p_participant_target integer,
  p_variants text[],
  p_closes_local timestamp default null,
  p_closes_tz text default null
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select public.update_study_draft(
    p_study_id => p_study_id,
    p_title => p_title,
    p_participant_target => p_participant_target,
    p_variant_items => coalesce((
      select jsonb_agg(
               jsonb_build_object('kind', 'text', 'content', v.content, 'image_path', null)
               order by v.ord
             )
        from unnest(p_variants) with ordinality as v (content, ord)
    ), '[]'::jsonb),
    p_closes_local => p_closes_local,
    p_closes_tz => p_closes_tz
  );
$$;

revoke execute on function public.update_study_draft(uuid, text, integer, text[], timestamp, text) from public, anon;
grant execute on function public.update_study_draft(uuid, text, integer, text[], timestamp, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_ballot: per-variant keys are now exactly variant_id, kind, content,
-- image_path. Gating unchanged (null unless effectively active).
-- ---------------------------------------------------------------------------

create or replace function public.get_ballot(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'title', s.title,
    'variants', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'variant_id', v.id,
                 'kind', v.kind,
                 'content', v.content,
                 'image_path', v.image_path
               )
               order by v.position
             )
        from public.variants v
       where v.study_id = s.id
    ), '[]'::jsonb)
  )
  from public.study_links l
  join public.studies s on s.id = l.study_id
  where l.token = p_token
    and public.study_status_effective(s.status, s.closes_at) = 'active';
$$;

revoke execute on function public.get_ballot(text) from public;
grant execute on function public.get_ballot(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_study_results: per-variant keys gain kind and image_path. Top-level
-- keys and scoping unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.get_study_results(p_study_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status', public.study_status_effective(s.status, s.closes_at),
    'responded', (
      select count(*)::int from public.study_links l
       where l.study_id = s.id and l.used
    ),
    'total', (
      select count(*)::int from public.study_links l
       where l.study_id = s.id
    ),
    'variants', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'variant_id', v.id,
                 'position', v.position,
                 'kind', v.kind,
                 'content', v.content,
                 'image_path', v.image_path,
                 'vote_count', (
                   select count(*)::int from public.votes vo
                    where vo.study_id = s.id and vo.variant_id = v.id
                 ),
                 'comments', coalesce((
                   select jsonb_agg(c.body order by c.body)
                     from public.comments c
                    where c.study_id = s.id and c.variant_id = v.id
                 ), '[]'::jsonb)
               )
               order by v.position
             )
        from public.variants v
       where v.study_id = s.id
    ), '[]'::jsonb)
  )
  from public.studies s
  where s.id = p_study_id
    and s.author_id = auth.uid();
$$;

revoke execute on function public.get_study_results(uuid) from public, anon;
grant execute on function public.get_study_results(uuid) to authenticated;
