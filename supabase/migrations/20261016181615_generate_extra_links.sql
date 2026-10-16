-- generate-extra-links (S-07): link order and adding links to an active study.
-- Forward-only: earlier migrations are applied in production and must not be
-- edited.
--
-- Link order:
--   * study_links.position is 1..total per study (unique per study). It
--     reveals creation order only, never usage: authors may select it, `used`
--     stays ungranted.
--   * existing links are backfilled in id order; start_study assigns 1..N;
--     add_study_links appends max + 1 ... under the study row lock.
--   * an insert that omits position (test fixtures) gets the next free number
--     for its study from a BEFORE INSERT row trigger. A row trigger sees the
--     rows inserted earlier by the same statement, so set-based inserts
--     (generate_series) number correctly too. Concurrency is not the
--     trigger's job: every writer holds the study row lock.
--
-- add_study_links:
--   * owner only, effectively active studies only (not draft, closed or past
--     the deadline).
--   * locks the study row (FOR NO KEY UPDATE) before reading the status or the
--     link count, so it is serialized with cast_vote's last-link auto-close:
--     either the links are added first (the vote then sees unused links and
--     does not close), or the close commits first (the add then raises
--     55000). Links are never added to a closed study. Lock order is
--     study -> link, as in every other writer.
--   * N (participant_target) becomes the live link count after the insert;
--     the 1-100 check (studies_participant_target_check) caps the total, and
--     a violation rolls the whole call back.
--
-- Grants: Supabase gives anon EXECUTE on new functions in public, so every
-- function created or recreated here revokes it explicitly.

-- ---------------------------------------------------------------------------
-- study_links.position: backfill, then constrain
-- ---------------------------------------------------------------------------

alter table public.study_links
  add column position integer;

update public.study_links l
   set position = o.rn
  from (
    select id, row_number() over (partition by study_id order by id)::int as rn
      from public.study_links
  ) o
 where o.id = l.id;

alter table public.study_links
  alter column position set not null,
  add constraint study_links_study_id_position_key unique (study_id, position),
  add constraint study_links_position_check check (position >= 1);

grant select (position) on public.study_links to authenticated;

-- ---------------------------------------------------------------------------
-- study_links_set_position: next free position when an insert omits it.
-- ---------------------------------------------------------------------------

create function public.study_links_set_position()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.position is null then
    select coalesce(max(l.position), 0) + 1
      into new.position
      from public.study_links l
     where l.study_id = new.study_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.study_links_set_position() from public, anon, authenticated;

create trigger study_links_set_position
  before insert on public.study_links
  for each row
  execute function public.study_links_set_position();

-- ---------------------------------------------------------------------------
-- start_study: links get positions 1..N. Otherwise unchanged.
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

  insert into public.study_links (study_id, position)
  select p_study_id, g.n
    from generate_series(1, v_target) as g (n);

  update public.studies s
     set status = 'active'
   where s.id = p_study_id;
end;
$$;

revoke execute on function public.start_study(uuid) from public, anon;
grant execute on function public.start_study(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- add_study_links: append p_count links to the caller's effectively active
-- study and raise N to the new live link count. Raises P0002 when the caller
-- owns no such study (unknown id, someone else's, or no auth.uid()), 55000
-- when the study is not effectively active (draft, closed, or past its
-- deadline), 22023 when p_count is null or below 1, and 23514 when the new
-- total would exceed 100. Nothing changes when it raises.
-- ---------------------------------------------------------------------------

create function public.add_study_links(p_study_id uuid, p_count integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.study_status;
  v_closes_at timestamptz;
  v_total integer;
  v_max_position integer;
begin
  -- Lock the study row before reading its status or links: serializes the
  -- add with cast_vote's last-link auto-close and with close_study.
  select s.status, s.closes_at
    into v_status, v_closes_at
    from public.studies s
   where s.id = p_study_id
     and s.author_id = auth.uid()
     for no key update;

  if not found then
    raise exception 'add_study_links: study % not found', p_study_id
      using errcode = 'P0002';
  end if;

  if public.study_status_effective(v_status, v_closes_at) <> 'active' then
    raise exception 'add_study_links: study % is not active', p_study_id
      using errcode = '55000';
  end if;

  if p_count is null or p_count < 1 then
    raise exception 'add_study_links: the number of links must be at least 1, got %', p_count
      using errcode = '22023';
  end if;

  select count(*)::int, coalesce(max(l.position), 0)
    into v_total, v_max_position
    from public.study_links l
   where l.study_id = p_study_id;

  -- N is the live link count after the insert; above 100 the check
  -- constraint raises 23514 and nothing is inserted.
  update public.studies s
     set participant_target = v_total + p_count
   where s.id = p_study_id;

  insert into public.study_links (study_id, position)
  select p_study_id, v_max_position + g.n
    from generate_series(1, p_count) as g (n);
end;
$$;

revoke execute on function public.add_study_links(uuid, integer) from public, anon;
grant execute on function public.add_study_links(uuid, integer) to authenticated;
