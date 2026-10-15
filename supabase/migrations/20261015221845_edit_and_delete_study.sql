-- edit-and-delete-study (S-06): the validated draft edit.
-- Forward-only: earlier migrations are applied in production and must not be
-- edited.
--
--   * update_study_draft is the only write path for editing a draft,
--     including the deadline: it is the validated path promised in
--     20261015170000_study_deadline_zone_hardening.sql, so there is still no
--     column update grant on closes_at / closes_tz.
--   * it locks the study row first (FOR UPDATE, filtered by auth.uid()), so a
--     concurrent start_study either commits before the edit (the edit then
--     raises 55000) or waits for it. Variants can never change under an
--     active study. Lock order is study -> link, as in every other writer.
--   * it replaces the whole draft: title, N, deadline, and every variant
--     (deleted, then re-inserted at positions 0..n-1 in array order). This
--     sidesteps the non-deferrable unique (study_id, position) and keeps the
--     2-6 variant count enforced on every edit. A draft has no links, votes
--     or comments, so deleting its variants cascades to nothing.
--   * delete needs no new code: the "authors delete own" policy covers every
--     status, and the cascade removes links, votes and comments. A deleted
--     study's tokens then read as unknown (get_ballot -> null, cast_vote ->
--     study_ended).
--
-- Grants: Supabase gives anon EXECUTE on new functions in public, so the
-- function revokes it explicitly.

-- ---------------------------------------------------------------------------
-- update_study_draft: replace the caller's draft atomically.
-- ---------------------------------------------------------------------------

create function public.update_study_draft(
  p_study_id uuid,
  p_title text,
  p_participant_target integer,
  p_variants text[],
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
  v_count integer := coalesce(cardinality(p_variants), 0);
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

  -- Variant and deadline validation mirror create_study
  -- (20261015170000_study_deadline_zone_hardening.sql); keep them in sync.
  if v_count < 2 or v_count > 6 then
    raise exception 'update_study_draft: a study needs 2 to 6 variants, got %', v_count
      using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(p_variants) as v (content)
     where v.content is null or btrim(v.content) = ''
  ) then
    raise exception 'update_study_draft: variants must not be blank'
      using errcode = '22023';
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

  insert into public.variants (study_id, position, content)
  select p_study_id, (v.ord - 1)::smallint, btrim(v.content)
    from unnest(p_variants) with ordinality as v (content, ord);
end;
$$;

revoke execute on function public.update_study_draft(uuid, text, integer, text[], timestamp, text) from public, anon;
grant execute on function public.update_study_draft(uuid, text, integer, text[], timestamp, text) to authenticated;
