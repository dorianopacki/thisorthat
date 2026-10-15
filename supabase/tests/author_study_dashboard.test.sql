-- author-study-dashboard: list_author_studies() returns only the caller's
-- studies, newest first, with the effective status and link counts, and
-- nothing else.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'author-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'author-b@example.com');

-- A: four studies with distinct created_at so the order is checkable.
insert into public.studies (id, author_id, title, participant_target, status, closes_at, closes_tz, created_at) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'A draft', 7, 'draft', null, null, now() - interval '1 hour'),
  ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'A active', 3, 'active', null, null, now() - interval '2 hours'),
  ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'A closed', 2, 'closed', null, null, now() - interval '3 hours'),
  ('a0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'A past deadline', 2, 'active', now() - interval '1 minute', 'Europe/Warsaw', now() - interval '4 hours');

insert into public.studies (id, author_id, title, participant_target, status) values
  ('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'B active', 2, 'active');

insert into public.study_links (study_id, token, used) values
  ('a0000000-0000-0000-0000-000000000002', 'dash-a-active-1', true),
  ('a0000000-0000-0000-0000-000000000002', 'dash-a-active-2', false),
  ('a0000000-0000-0000-0000-000000000002', 'dash-a-active-3', false),
  ('a0000000-0000-0000-0000-000000000003', 'dash-a-closed-1', true),
  ('a0000000-0000-0000-0000-000000000003', 'dash-a-closed-2', true),
  ('a0000000-0000-0000-0000-000000000004', 'dash-a-dl-1', false),
  ('a0000000-0000-0000-0000-000000000004', 'dash-a-dl-2', false),
  ('b0000000-0000-0000-0000-000000000001', 'dash-b-1', true),
  ('b0000000-0000-0000-0000-000000000001', 'dash-b-2', false);

-- ---------------------------------------------------------------------------
-- Author A
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select is(
  (select array_agg(title) from public.list_author_studies()),
  array['A draft', 'A active', 'A closed', 'A past deadline'],
  'A: exactly A''s four studies, newest first'
);

select is(
  (select count(*)::int from public.list_author_studies() where title like 'B %'),
  0,
  'A: none of B''s studies'
);

select results_eq(
  $$ select status, participant_target, responded, total
       from public.list_author_studies() where title = 'A draft' $$,
  $$ values ('draft'::public.study_status, 7, 0, 0) $$,
  'A: a draft has no links and keeps its participant_target'
);

select results_eq(
  $$ select status, responded, total
       from public.list_author_studies() where title = 'A active' $$,
  $$ values ('active'::public.study_status, 1, 3) $$,
  'A: active study counts used and all links'
);

select results_eq(
  $$ select status, responded, total
       from public.list_author_studies() where title = 'A closed' $$,
  $$ values ('closed'::public.study_status, 2, 2) $$,
  'A: closed study keeps its counts'
);

select is(
  (select status from public.list_author_studies() where title = 'A past deadline'),
  'closed'::public.study_status,
  'A: a study past its deadline reads closed (effective status)'
);

select is(
  (select proargnames
     from pg_proc
    where proname = 'list_author_studies' and pronamespace = 'public'::regnamespace),
  array['id', 'title', 'status', 'participant_target', 'responded', 'total', 'created_at'],
  'columns are exactly id, title, status, participant_target, responded, total, created_at'
);

-- ---------------------------------------------------------------------------
-- Author B
-- ---------------------------------------------------------------------------

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);

select results_eq(
  $$ select title, responded, total from public.list_author_studies() $$,
  $$ values ('B active'::text, 1, 2) $$,
  'B: only B''s study, with B''s counts'
);

-- ---------------------------------------------------------------------------
-- No auth.uid(), anon
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.list_author_studies()),
  0,
  'no auth.uid(): zero rows'
);

reset role;
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

select throws_ok(
  $$ select * from public.list_author_studies() $$,
  '42501',
  null,
  'anon: permission denied on list_author_studies'
);

reset role;

select is(
  has_function_privilege('authenticated', 'public.list_author_studies()', 'execute'),
  true,
  'authenticated can execute list_author_studies'
);

select * from finish();
rollback;
