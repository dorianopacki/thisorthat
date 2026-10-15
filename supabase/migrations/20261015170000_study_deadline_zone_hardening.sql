-- study-closing-rules (S-04), review fix: only create_study writes the
-- deadline, and only with a zone Intl can format.
-- Forward-only: earlier migrations are applied in production and must not be
-- edited.
--
--   * no column grant for update on closes_at / closes_tz: a direct PostgREST
--     update could store a zone create_study never validated, and the author
--     page (Intl.DateTimeFormat) would fail on it. Nothing edits the deadline
--     after creation; S-06 (draft editing) must add a validated path instead.
--   * create_study excludes the pg_timezone_names entries Intl rejects
--     (posix/…, right/…, Factory, localtime, posixrules).
--   * the insert grant stays: create_study is security invoker. A direct
--     insert can still store any zone; the page falls back to UTC for a zone
--     it cannot format (src/lib/study-deadline.ts).

revoke update (closes_at, closes_tz) on public.studies from authenticated;

-- ---------------------------------------------------------------------------
-- create_study: unchanged except for the zone check.
-- ---------------------------------------------------------------------------

create or replace function public.create_study(
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

  insert into public.variants (study_id, position, content)
  select v_study_id, (v.ord - 1)::smallint, btrim(v.content)
    from unnest(p_variants) with ordinality as v (content, ord);

  return v_study_id;
end;
$$;

revoke execute on function public.create_study(text, integer, text[], timestamp, text) from public, anon;
grant execute on function public.create_study(text, integer, text[], timestamp, text) to authenticated;
