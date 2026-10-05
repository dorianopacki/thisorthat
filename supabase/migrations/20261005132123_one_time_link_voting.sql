-- one-time-link-voting (S-02): the participant read path (get_ballot).
-- Forward-only: earlier migrations are applied in production and must not be
-- edited.
--
-- Anonymity invariants:
--   * get_ballot never reads study_links.used: a used and an unused link of
--     the same active study return identical output. The only way to learn a
--     link's state stays cast_vote, which consumes an unused link (so probing
--     is destructive and shows up in `responded`).
--   * no table privileges are granted to anon; get_ballot is security definer
--     and narrowed to the one study the token belongs to.
--   * the output carries no link id, token, position, study id, status or
--     counts.

-- ---------------------------------------------------------------------------
-- get_ballot: title and variants of the token's study, ordered by position.
-- Returns null for an unknown token or a deleted, draft or closed study.
-- ---------------------------------------------------------------------------

create function public.get_ballot(p_token text)
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
    and s.status = 'active';
$$;

revoke execute on function public.get_ballot(text) from public;
grant execute on function public.get_ballot(text) to anon, authenticated;
