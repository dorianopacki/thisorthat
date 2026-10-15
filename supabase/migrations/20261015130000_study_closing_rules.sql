-- study-closing-rules (S-04), part 1: the deadline and the one closing rule.
-- Forward-only: earlier migrations are applied in production and must not be
-- edited.
--
-- Closing rule:
--   * a study is effectively closed when status = 'closed' (written by an
--     explicit close or by the vote that uses the last link), or when it is
--     'active' and now() >= closes_at. The deadline is computed, never
--     written: the stored status of a study past its deadline stays 'active',
--     so every reader goes through study_status_effective (or the
--     effective_status computed field), never studies.status alone.
--   * the boundary belongs to the closed side: at exactly closes_at the study
--     is closed.
--
-- Deadline:
--   * closes_at is the absolute instant; closes_tz is the author's IANA zone,
--     kept only to display the deadline in the zone it was set in. Both or
--     neither.
--   * create_study converts the author's local date and time with
--     `local at time zone tz`, so DST is handled by Postgres: a local time in
--     the spring gap is read with the offset before the jump, the doubled
--     autumn hour with the offset after the jump back.
--   * the deadline is set only when the draft is created; the draft-only
--     update policy keeps it fixed after start.
--
-- Grants: Supabase gives anon EXECUTE on new functions in public, so every
-- function created or recreated here revokes it explicitly.

-- ---------------------------------------------------------------------------
-- studies: optional deadline
-- ---------------------------------------------------------------------------

alter table public.studies
  add column closes_at timestamptz,
  add column closes_tz text,
  add constraint studies_closes_pair_check
    check ((closes_at is null) = (closes_tz is null));

grant insert (closes_at, closes_tz) on public.studies to authenticated;
grant update (closes_at, closes_tz) on public.studies to authenticated;

-- ---------------------------------------------------------------------------
-- study_status_effective: the closing rule, in one body.
-- ---------------------------------------------------------------------------

create function public.study_status_effective(
  p_status public.study_status,
  p_closes_at timestamptz
)
returns public.study_status
language sql
stable
set search_path = ''
as $$
  select case
    when p_status = 'active' and p_closes_at is not null and now() >= p_closes_at
      then 'closed'::public.study_status
    else p_status
  end;
$$;

revoke execute on function public.study_status_effective(public.study_status, timestamptz) from public, anon;
grant execute on function public.study_status_effective(public.study_status, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- effective_status: PostgREST computed field over studies
-- (select("…, effective_status")). Delegates to the rule; deliberately a
-- different name from the scalar function so nothing is overloaded.
-- ---------------------------------------------------------------------------

create function public.effective_status(s public.studies)
returns public.study_status
language sql
stable
set search_path = ''
as $$
  select public.study_status_effective(s.status, s.closes_at);
$$;

revoke execute on function public.effective_status(public.studies) from public, anon;
grant execute on function public.effective_status(public.studies) to authenticated;

-- ---------------------------------------------------------------------------
-- get_ballot: null once the study is effectively closed (including past its
-- deadline). Output and anonymity invariants unchanged.
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
                 'content', v.content
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
-- get_study_results: `status` is the effective status. Keys unchanged
-- (exactly responded, status, total, variants).
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

-- ---------------------------------------------------------------------------
-- create_study: optional deadline as the author's local date-time + IANA
-- zone. Raises 22023 when only one of the two is given, for an unknown zone,
-- or for a deadline that is not in the future; otherwise as before.
-- ---------------------------------------------------------------------------

drop function public.create_study(text, integer, text[]);

create function public.create_study(
  p_title text,
  p_participant_target integer,
  p_variants text[],
  p_closes_local timestamp default null,
  p_closes_tz text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer := coalesce(cardinality(p_variants), 0);
  v_closes_at timestamptz;
  v_study_id uuid;
begin
  if v_count < 2 or v_count > 6 then
    raise exception 'create_study: a study needs 2 to 6 variants, got %', v_count
      using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(p_variants) as v (content)
     where v.content is null or btrim(v.content) = ''
  ) then
    raise exception 'create_study: variants must not be blank'
      using errcode = '22023';
  end if;

  if (p_closes_local is null) <> (p_closes_tz is null) then
    raise exception 'create_study: a deadline needs both a local time and a time zone'
      using errcode = '22023';
  end if;

  if p_closes_tz is not null then
    if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_closes_tz) then
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

  insert into public.variants (study_id, position, content)
  select v_study_id, (v.ord - 1)::smallint, btrim(v.content)
    from unnest(p_variants) with ordinality as v (content, ord);

  return v_study_id;
end;
$$;

revoke execute on function public.create_study(text, integer, text[], timestamp, text) from public, anon;
grant execute on function public.create_study(text, integer, text[], timestamp, text) to authenticated;

-- ---------------------------------------------------------------------------
-- start_study: additionally raises 22008 when the draft's deadline has
-- already passed (distinct from the 22023 variant-count error).
-- ---------------------------------------------------------------------------

create or replace function public.start_study(p_study_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.study_status;
  v_target integer;
  v_closes_at timestamptz;
  v_variants integer;
begin
  -- Lock the row first: a concurrent second start waits here, then sees
  -- `active` and raises instead of generating a second set of links.
  select s.status, s.participant_target, s.closes_at
    into v_status, v_target, v_closes_at
    from public.studies s
   where s.id = p_study_id
     and s.author_id = auth.uid()
     for update;

  if not found then
    raise exception 'start_study: study % not found', p_study_id
      using errcode = 'P0002';
  end if;

  if v_status <> 'draft' then
    raise exception 'start_study: study % is %, not draft', p_study_id, v_status
      using errcode = '55000';
  end if;

  select count(*)::int
    into v_variants
    from public.variants v
   where v.study_id = p_study_id;

  if v_variants < 2 or v_variants > 6 then
    raise exception 'start_study: a study needs 2 to 6 variants, has %', v_variants
      using errcode = '22023';
  end if;

  if v_closes_at is not null and v_closes_at <= now() then
    raise exception 'start_study: the deadline of study % has passed', p_study_id
      using errcode = '22008';
  end if;

  insert into public.study_links (study_id)
  select p_study_id
    from generate_series(1, v_target);

  update public.studies s
     set status = 'active'
   where s.id = p_study_id;
end;
$$;

revoke execute on function public.start_study(uuid) from public, anon;
grant execute on function public.start_study(uuid) to authenticated;
