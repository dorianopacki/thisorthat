-- author-study-dashboard (S-05): the author's study list with progress.
-- Forward-only: earlier migrations are applied in production and must not be
-- edited.
--
-- Authors may not read study_links.used (anonymity rule), so the dashboard
-- gets its per-study counts from this definer function. It exposes only the
-- per-study aggregates get_study_results already returns (responded, total),
-- scoped to auth.uid() in the body: no auth.uid() means zero rows.

create function public.list_author_studies()
returns table (
  id uuid,
  title text,
  status public.study_status,
  participant_target integer,
  responded integer,
  total integer,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    s.title,
    public.study_status_effective(s.status, s.closes_at),
    s.participant_target,
    (
      select count(*)::int from public.study_links l
       where l.study_id = s.id and l.used
    ),
    (
      select count(*)::int from public.study_links l
       where l.study_id = s.id
    ),
    s.created_at
  from public.studies s
  where s.author_id = auth.uid()
  order by s.created_at desc, s.id;
$$;

revoke execute on function public.list_author_studies() from public, anon;
grant execute on function public.list_author_studies() to authenticated;
