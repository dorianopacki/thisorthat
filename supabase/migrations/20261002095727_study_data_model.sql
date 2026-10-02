-- study-data-model: schema, grants/RLS, and the two contract functions
-- (cast_vote, get_study_results) for the study loop.
--
-- Anonymity invariants:
--   * votes / comments carry no link reference, no timestamps, no ballot id.
--   * study_links carries no timestamps; authors cannot read `used` per link.
--   * authors read votes/comments only through get_study_results (aggregates).

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.study_status as enum ('draft', 'active', 'closed');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.studies (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  participant_target integer not null check (participant_target > 0),
  status public.study_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index studies_author_id_idx on public.studies (author_id);

create table public.variants (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  position smallint not null check (position >= 0),
  content text not null check (char_length(btrim(content)) between 1 and 2000),
  unique (study_id, position),
  unique (id, study_id)
);

create table public.study_links (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  token text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  used boolean not null default false
);

create index study_links_study_id_idx on public.study_links (study_id);

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null,
  variant_id uuid not null,
  foreign key (variant_id, study_id) references public.variants (id, study_id) on delete cascade
);

create index votes_study_id_variant_id_idx on public.votes (study_id, variant_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null,
  variant_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  foreign key (variant_id, study_id) references public.variants (id, study_id) on delete cascade
);

create index comments_study_id_variant_id_idx on public.comments (study_id, variant_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger on studies (plain trigger, not security definer)
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;

create trigger studies_set_updated_at
  before update on public.studies
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Grants: strip Supabase default table privileges, then grant only what is
-- listed. `status` is in no column grant -> only definer functions change it.
-- ---------------------------------------------------------------------------

revoke all on public.studies from anon, authenticated;
revoke all on public.variants from anon, authenticated;
revoke all on public.study_links from anon, authenticated;
revoke all on public.votes from anon, authenticated;
revoke all on public.comments from anon, authenticated;

grant select, delete on public.studies to authenticated;
grant insert (title, participant_target) on public.studies to authenticated;
grant update (title, participant_target) on public.studies to authenticated;

grant select, delete on public.variants to authenticated;
grant insert (study_id, position, content) on public.variants to authenticated;
grant update (position, content) on public.variants to authenticated;

grant select (id, study_id, token) on public.study_links to authenticated;

-- votes, comments: no privileges for anon or authenticated.

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.studies enable row level security;
alter table public.variants enable row level security;
alter table public.study_links enable row level security;
alter table public.votes enable row level security;
alter table public.comments enable row level security;

-- studies
create policy "studies: authors select own"
  on public.studies for select to authenticated
  using (author_id = (select auth.uid()));

create policy "studies: authors insert own"
  on public.studies for insert to authenticated
  with check (author_id = (select auth.uid()));

create policy "studies: authors update own drafts"
  on public.studies for update to authenticated
  using (author_id = (select auth.uid()) and status = 'draft')
  with check (author_id = (select auth.uid()) and status = 'draft');

create policy "studies: authors delete own"
  on public.studies for delete to authenticated
  using (author_id = (select auth.uid()));

-- variants
create policy "variants: authors select own"
  on public.variants for select to authenticated
  using (
    exists (
      select 1 from public.studies s
      where s.id = variants.study_id
        and s.author_id = (select auth.uid())
    )
  );

create policy "variants: authors insert into own drafts"
  on public.variants for insert to authenticated
  with check (
    exists (
      select 1 from public.studies s
      where s.id = variants.study_id
        and s.author_id = (select auth.uid())
        and s.status = 'draft'
    )
  );

create policy "variants: authors update own drafts"
  on public.variants for update to authenticated
  using (
    exists (
      select 1 from public.studies s
      where s.id = variants.study_id
        and s.author_id = (select auth.uid())
        and s.status = 'draft'
    )
  )
  with check (
    exists (
      select 1 from public.studies s
      where s.id = variants.study_id
        and s.author_id = (select auth.uid())
        and s.status = 'draft'
    )
  );

create policy "variants: authors delete from own drafts"
  on public.variants for delete to authenticated
  using (
    exists (
      select 1 from public.studies s
      where s.id = variants.study_id
        and s.author_id = (select auth.uid())
        and s.status = 'draft'
    )
  );

-- study_links
create policy "study_links: authors select own"
  on public.study_links for select to authenticated
  using (
    exists (
      select 1 from public.studies s
      where s.id = study_links.study_id
        and s.author_id = (select auth.uid())
    )
  );

-- votes, comments: RLS enabled, intentionally no policies.

-- ---------------------------------------------------------------------------
-- cast_vote: the only write path for votes and comments.
-- Returns 'accepted' | 'link_used' | 'study_ended'.
-- ---------------------------------------------------------------------------

create function public.cast_vote(
  p_token text,
  p_variant_id uuid,
  p_comments jsonb default '[]'::jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_study_id uuid;
  v_used boolean;
  v_status public.study_status;
  v_comments jsonb := coalesce(p_comments, '[]'::jsonb);
  v_entry jsonb;
  v_comment_variant uuid;
  v_body text;
  v_seen uuid[] := '{}'::uuid[];
  v_bodies text[] := '{}'::text[];
begin
  -- Resolve the token's study without consuming anything. An unknown token
  -- (or a deleted study) is reported as ended.
  select l.study_id
    into v_study_id
    from public.study_links l
   where l.token = p_token;

  if not found then
    return 'study_ended';
  end if;

  -- Validate every input BEFORE touching `used`. If validation ran after the
  -- consume, a bad request would raise on an unused link (rolled back) but
  -- return 'link_used' on a used one -- a side-effect-free oracle for the
  -- per-link `used` state that authors must never learn.
  if not exists (
    select 1 from public.variants v
     where v.id = p_variant_id
       and v.study_id = v_study_id
  ) then
    raise exception 'cast_vote: variant % does not belong to the study', p_variant_id
      using errcode = '22023';
  end if;

  if jsonb_typeof(v_comments) <> 'array' then
    raise exception 'cast_vote: p_comments must be a JSON array'
      using errcode = '22023';
  end if;

  for v_entry in select value from jsonb_array_elements(v_comments)
  loop
    if jsonb_typeof(v_entry) <> 'object' then
      raise exception 'cast_vote: each comment must be a JSON object'
        using errcode = '22023';
    end if;

    v_body := btrim(v_entry ->> 'body');
    if v_body is null or v_body = '' then
      continue;
    end if;

    if char_length(v_body) > 2000 then
      raise exception 'cast_vote: comment body exceeds 2000 characters'
        using errcode = '22023';
    end if;

    v_comment_variant := (v_entry ->> 'variant_id')::uuid;

    if v_comment_variant is null or not exists (
      select 1 from public.variants v
       where v.id = v_comment_variant
         and v.study_id = v_study_id
    ) then
      raise exception 'cast_vote: comment variant % does not belong to the study', v_comment_variant
        using errcode = '22023';
    end if;

    if v_comment_variant = any (v_seen) then
      raise exception 'cast_vote: duplicate comment for variant %', v_comment_variant
        using errcode = '22023';
    end if;

    v_seen := v_seen || v_comment_variant;
    v_bodies := v_bodies || v_body;
  end loop;

  -- Atomic consume: a single conditional UPDATE is the one-vote guarantee.
  -- A concurrent second call blocks on the row lock, re-checks used = false
  -- after the first commits, matches zero rows and falls through.
  update public.study_links l
     set used = true
    from public.studies s
   where l.token = p_token
     and l.used = false
     and s.id = l.study_id
     and s.status = 'active'
  returning l.study_id into v_study_id;

  if not found then
    select l.used, s.status
      into v_used, v_status
      from public.study_links l
      join public.studies s on s.id = l.study_id
     where l.token = p_token;

    if found and v_used and v_status = 'active' then
      return 'link_used';
    end if;

    -- deleted meanwhile, draft or closed study (used or not)
    return 'study_ended';
  end if;

  insert into public.votes (study_id, variant_id)
  values (v_study_id, p_variant_id);

  insert into public.comments (study_id, variant_id, body)
  select v_study_id, c.variant_id, c.body
    from unnest(v_seen, v_bodies) as c (variant_id, body);

  return 'accepted';
end;
$$;

revoke execute on function public.cast_vote(text, uuid, jsonb) from public;
grant execute on function public.cast_vote(text, uuid, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_study_results: the only author read path over votes/comments.
-- Aggregates only; no row identity, no insertion/physical ordering.
-- Returns null for a study the caller does not own (or that does not exist).
-- ---------------------------------------------------------------------------

create function public.get_study_results(p_study_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status', s.status,
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
                 'content', v.content,
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
