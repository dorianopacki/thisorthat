-- cast_vote: a malformed comment variant_id (not a uuid) raised 22P02
-- (invalid_text_representation) instead of the documented 22023. Redefine the
-- function so it raises 22023 like every other invalid input. Validation still
-- runs before the link is consumed. Forward-only fix: the previous migration is
-- already applied in production and must not be edited.

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
