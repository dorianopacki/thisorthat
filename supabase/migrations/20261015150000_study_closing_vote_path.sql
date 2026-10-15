-- study-closing-rules (S-04), part 2: the vote path and manual close.
-- Forward-only: earlier migrations are applied in production and must not be
-- edited.
--
-- Closing writers: only two paths write status = 'closed', and both lock
-- the study row first (FOR NO KEY UPDATE: conflicts between writers, but
-- unlike FOR UPDATE does not block FK KEY SHARE checks):
--   * close_study (manual, irreversible, owner only);
--   * cast_vote, when the vote it records used the study's last unused link
--     (live link count, so links added later by S-07 keep it correct).
-- The deadline is never written (see 20261015130000_study_closing_rules.sql).
--
-- Serialization: cast_vote locks the study row before consuming a link, so
-- votes on one study run one after another (at most 100 links), and a vote
-- either commits before a close or waits for it and then sees the study
-- closed. Lock order is study -> link everywhere (start_study, delete
-- cascade, cast_vote).
--
-- Anonymity order is unchanged: input validation still raises 22023 before
-- anything consumes or reveals study_links.used. The lock is taken for every
-- known token, whatever its used state, so it reveals nothing either.

-- ---------------------------------------------------------------------------
-- cast_vote
-- ---------------------------------------------------------------------------

create or replace function public.cast_vote(
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
  v_status public.study_status;
  v_closes_at timestamptz;
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

  -- Lock the study row: serializes this vote with closes and with other
  -- votes on the same study. A study deleted since the lookup is ended.
  select s.status, s.closes_at
    into v_status, v_closes_at
    from public.studies s
   where s.id = v_study_id
     for no key update;

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

    begin
      v_comment_variant := (v_entry ->> 'variant_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'cast_vote: comment variant_id is not a uuid'
        using errcode = '22023';
    end;

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

  -- An effectively closed study (closed, past its deadline, or draft)
  -- accepts nothing, whether the link is used or not.
  if public.study_status_effective(v_status, v_closes_at) <> 'active' then
    return 'study_ended';
  end if;

  -- Atomic consume: a single conditional UPDATE is the one-vote guarantee.
  update public.study_links l
     set used = true
   where l.token = p_token
     and l.used = false;

  if not found then
    return 'link_used';
  end if;

  insert into public.votes (study_id, variant_id)
  values (v_study_id, p_variant_id);

  insert into public.comments (study_id, variant_id, body)
  select v_study_id, c.variant_id, c.body
    from unnest(v_seen, v_bodies) as c (variant_id, body);

  -- Auto-close: this vote used the last unused link.
  if not exists (
    select 1 from public.study_links l
     where l.study_id = v_study_id and not l.used
  ) then
    update public.studies s
       set status = 'closed'
     where s.id = v_study_id
       and s.status = 'active';
  end if;

  return 'accepted';
end;
$$;

revoke execute on function public.cast_vote(text, uuid, jsonb) from public;
grant execute on function public.cast_vote(text, uuid, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- close_study: manual, irreversible close by the owner. Raises P0002 when
-- the caller owns no such study (unknown id, someone else's, or no
-- auth.uid()), 55000 when the study is not effectively active (draft,
-- already closed, or past its deadline).
-- ---------------------------------------------------------------------------

create function public.close_study(p_study_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.study_status;
  v_closes_at timestamptz;
begin
  select s.status, s.closes_at
    into v_status, v_closes_at
    from public.studies s
   where s.id = p_study_id
     and s.author_id = auth.uid()
     for no key update;

  if not found then
    raise exception 'close_study: study % not found', p_study_id
      using errcode = 'P0002';
  end if;

  if public.study_status_effective(v_status, v_closes_at) <> 'active' then
    raise exception 'close_study: study % is not active', p_study_id
      using errcode = '55000';
  end if;

  update public.studies s
     set status = 'closed'
   where s.id = p_study_id;
end;
$$;

revoke execute on function public.close_study(uuid) from public, anon;
grant execute on function public.close_study(uuid) to authenticated;
