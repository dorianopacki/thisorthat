-- create-and-start-study (S-01): study limits and the two author write paths
-- (create_study, start_study). Forward-only: the study-data-model migrations
-- are applied in production and must not be edited.
--
-- Limits:
--   * participant_target (N) is 1-100. It caps the total number of links a
--     study ever gets, so later link-adding paths must respect it.
--   * a study has 2-6 variants. This is not a table constraint (variants are
--     edited row by row in a draft); create_study and start_study enforce it.
--
-- Start invariants:
--   * only the owner starts a study, and only from `draft`.
--   * start_study locks the study row before checking its status, so two
--     concurrent starts cannot both generate links; any raised error rolls
--     back the inserted links, so a study never has partial links.

-- ---------------------------------------------------------------------------
-- studies.participant_target: 1-100 (was > 0)
-- ---------------------------------------------------------------------------

alter table public.studies
  drop constraint studies_participant_target_check;

alter table public.studies
  add constraint studies_participant_target_check
  check (participant_target between 1 and 100);

-- ---------------------------------------------------------------------------
-- create_study: creates a draft study with its variants in one call.
-- security invoker: the insert goes through the existing grants and RLS
-- (author defaults to auth.uid(); variants only into the caller's draft).
-- Raises 22023 for fewer than 2 / more than 6 variants or a blank variant;
-- title/content length and N violations surface as check violations (23514).
-- ---------------------------------------------------------------------------

create function public.create_study(
  p_title text,
  p_participant_target integer,
  p_variants text[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer := coalesce(cardinality(p_variants), 0);
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

  insert into public.studies (title, participant_target)
  values (btrim(p_title), p_participant_target)
  returning id into v_study_id;

  insert into public.variants (study_id, position, content)
  select v_study_id, (v.ord - 1)::smallint, btrim(v.content)
    from unnest(p_variants) with ordinality as v (content, ord);

  return v_study_id;
end;
$$;

revoke execute on function public.create_study(text, integer, text[]) from public, anon;
grant execute on function public.create_study(text, integer, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- start_study: draft -> active, generating participant_target one-time links.
-- security definer: `status` is in no column grant and authors cannot insert
-- study_links. Raises P0002 when the caller owns no such study (unknown id,
-- someone else's, or no auth.uid()), 55000 when the study is not a draft,
-- 22023 when its variant count is outside 2-6.
-- ---------------------------------------------------------------------------

create function public.start_study(p_study_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.study_status;
  v_target integer;
  v_variants integer;
begin
  -- Lock the row first: a concurrent second start waits here, then sees
  -- `active` and raises instead of generating a second set of links.
  select s.status, s.participant_target
    into v_status, v_target
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
