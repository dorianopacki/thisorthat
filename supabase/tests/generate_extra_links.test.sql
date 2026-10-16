-- generate-extra-links (S-07): add_study_links appends links to the owner's
-- effectively active study and raises N to the live link count, capped at
-- 100. Links keep a stable per-study position 1..total.
-- Fixtures are inserted as the test superuser; assertions run as the real roles.
-- The concurrent vote/add case lives in generate_extra_links_race.test.sql.
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

-- ---------------------------------------------------------------------------
-- Fixtures (uuid prefixes 1111/2222 users, a7 studies, b7 variants)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'author-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'author-b@example.com');

insert into public.studies (id, author_id, title, participant_target, status, closes_at, closes_tz) values
  ('a7000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Active', 2, 'active', null, null),
  ('a7000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Draft', 2, 'draft', null, null),
  ('a7000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Closed', 2, 'closed', null, null),
  ('a7000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Past deadline', 2, 'active', now() - interval '1 minute', 'Europe/Warsaw'),
  ('a7000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'Foreign', 2, 'active', null, null),
  ('a7000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Near cap', 95, 'active', null, null),
  ('a7000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'To start', 4, 'draft', null, null);

insert into public.variants (id, study_id, position, content) values
  ('b7000000-0000-0000-0000-000000000011', 'a7000000-0000-0000-0000-000000000001', 0, 'Left'),
  ('b7000000-0000-0000-0000-000000000012', 'a7000000-0000-0000-0000-000000000001', 1, 'Right'),
  ('b7000000-0000-0000-0000-000000000071', 'a7000000-0000-0000-0000-000000000007', 0, 'Start left'),
  ('b7000000-0000-0000-0000-000000000072', 'a7000000-0000-0000-0000-000000000007', 1, 'Start right');

-- Links inserted without a position: the trigger numbers them per study.
insert into public.study_links (study_id, token) values
  ('a7000000-0000-0000-0000-000000000001', 'gx-1'),
  ('a7000000-0000-0000-0000-000000000001', 'gx-2'),
  ('a7000000-0000-0000-0000-000000000003', 'gx-closed-1'),
  ('a7000000-0000-0000-0000-000000000003', 'gx-closed-2'),
  ('a7000000-0000-0000-0000-000000000004', 'gx-dl-1'),
  ('a7000000-0000-0000-0000-000000000004', 'gx-dl-2'),
  ('a7000000-0000-0000-0000-000000000005', 'gx-foreign-1'),
  ('a7000000-0000-0000-0000-000000000005', 'gx-foreign-2');

insert into public.study_links (study_id)
select 'a7000000-0000-0000-0000-000000000006'
  from generate_series(1, 95);

-- ---------------------------------------------------------------------------
-- Positions: fixtures and set-based inserts are numbered 1..total per study
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(position order by position) from public.study_links
    where study_id = 'a7000000-0000-0000-0000-000000000001'),
  array[1, 2],
  'positions: an insert that omits position gets 1, 2 for its study'
);

select is(
  (select count(*)::int from (
     select study_id from public.study_links
      group by study_id
     having min(position) <> 1 or max(position) <> count(*)
   ) gaps),
  0,
  'positions: every study has a contiguous 1..total (set-based inserts included)'
);

-- ---------------------------------------------------------------------------
-- Matrix: owner + effectively active only
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.add_study_links('a7000000-0000-0000-0000-000000000002', 1) $$,
  '55000', null, 'matrix: a draft raises 55000'
);
select throws_ok(
  $$ select public.add_study_links('a7000000-0000-0000-0000-000000000003', 1) $$,
  '55000', null, 'matrix: a closed study raises 55000'
);
select throws_ok(
  $$ select public.add_study_links('a7000000-0000-0000-0000-000000000004', 1) $$,
  '55000', null, 'matrix: an active study past its deadline raises 55000'
);
select throws_ok(
  $$ select public.add_study_links('a7000000-0000-0000-0000-000000000005', 1) $$,
  'P0002', null, 'matrix: someone else''s study raises P0002'
);
select throws_ok(
  $$ select public.add_study_links('a7ffffff-0000-0000-0000-000000000000', 1) $$,
  'P0002', null, 'matrix: an unknown id raises P0002'
);

-- ---------------------------------------------------------------------------
-- Count validation (on the active study; nothing changes)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.add_study_links('a7000000-0000-0000-0000-000000000001', 0) $$,
  '22023', null, 'count: 0 raises 22023'
);
select throws_ok(
  $$ select public.add_study_links('a7000000-0000-0000-0000-000000000001', -1) $$,
  '22023', null, 'count: a negative count raises 22023'
);
select throws_ok(
  $$ select public.add_study_links('a7000000-0000-0000-0000-000000000001', null) $$,
  '22023', null, 'count: null raises 22023'
);

reset role;

set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

select throws_ok(
  $$ select public.add_study_links('a7000000-0000-0000-0000-000000000001', 1) $$,
  '42501', null, 'matrix: anon has no permission to call add_study_links'
);

reset role;

select is(
  (select count(*)::int from public.study_links where study_id = 'a7000000-0000-0000-0000-000000000005'),
  2, 'matrix: someone else''s study keeps its links'
);
select is(
  (select count(*)::int from public.study_links
    where study_id in ('a7000000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-000000000003',
                       'a7000000-0000-0000-0000-000000000004')),
  4, 'matrix: draft, closed and past-deadline studies got no links'
);
select is(
  (select array_agg(participant_target order by id) from public.studies
    where id in ('a7000000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-000000000003',
                 'a7000000-0000-0000-0000-000000000004', 'a7000000-0000-0000-0000-000000000005')),
  array[2, 2, 2, 2], 'matrix: refused calls leave N unchanged'
);
select is(
  (select count(*)::int from public.study_links where study_id = 'a7000000-0000-0000-0000-000000000001'),
  2, 'count: refused counts add no links'
);

-- ---------------------------------------------------------------------------
-- Cap: N = 95 + 6 is refused as a whole; 95 + 5 reaches 100
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.add_study_links('a7000000-0000-0000-0000-000000000006', 6) $$,
  '23514', null, 'cap: 95 + 6 raises 23514'
);

reset role;

select is(
  (select count(*)::int from public.study_links where study_id = 'a7000000-0000-0000-0000-000000000006'),
  95, 'cap: the refused call added no links'
);
select is(
  (select participant_target from public.studies where id = 'a7000000-0000-0000-0000-000000000006'),
  95, 'cap: the refused call left N unchanged'
);

set local role authenticated;
select lives_ok(
  $$ select public.add_study_links('a7000000-0000-0000-0000-000000000006', 5) $$,
  'cap: 95 + 5 is accepted'
);

reset role;

select is(
  (select participant_target from public.studies where id = 'a7000000-0000-0000-0000-000000000006'),
  100, 'cap: N is 100'
);
select is(
  (select array_agg(position order by position) from public.study_links
    where study_id = 'a7000000-0000-0000-0000-000000000006'),
  (select array_agg(n) from generate_series(1, 100) as g (n)),
  'cap: the study has 100 links at positions 1..100'
);

-- ---------------------------------------------------------------------------
-- Effect: 2 + 3 gives 5 links at 1..5, N = 5, total = 5
-- ---------------------------------------------------------------------------

set local role authenticated;
select lives_ok(
  $$ select public.add_study_links('a7000000-0000-0000-0000-000000000001', 3) $$,
  'effect: the owner adds 3 links to an active study'
);

select is(
  (select array_agg(position order by position) from public.study_links
    where study_id = 'a7000000-0000-0000-0000-000000000001'),
  array[1, 2, 3, 4, 5],
  'effect: the author reads 5 links at positions 1..5'
);
select is(
  (select array_agg(position order by position) from public.study_links
    where study_id = 'a7000000-0000-0000-0000-000000000001' and token in ('gx-1', 'gx-2')),
  array[1, 2],
  'effect: the original links keep positions 1 and 2'
);
select is(
  (select participant_target from public.studies where id = 'a7000000-0000-0000-0000-000000000001'),
  5, 'effect: N is 5'
);
select is(
  (public.get_study_results('a7000000-0000-0000-0000-000000000001') ->> 'total')::int,
  5, 'effect: get_study_results reports total = 5'
);
select is(
  (public.get_study_results('a7000000-0000-0000-0000-000000000001') ->> 'status'),
  'active', 'effect: the study is still active'
);

reset role;

select is(
  (select count(*)::int from public.study_links
    where study_id = 'a7000000-0000-0000-0000-000000000001' and not used),
  5, 'effect: the new links are unused'
);

-- ---------------------------------------------------------------------------
-- Auto-close: the original links leave it active; the new ones close it
-- ---------------------------------------------------------------------------

select set_config('test.t3', (select token from public.study_links
  where study_id = 'a7000000-0000-0000-0000-000000000001' and position = 3), true);
select set_config('test.t4', (select token from public.study_links
  where study_id = 'a7000000-0000-0000-0000-000000000001' and position = 4), true);
select set_config('test.t5', (select token from public.study_links
  where study_id = 'a7000000-0000-0000-0000-000000000001' and position = 5), true);

set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

select is(public.cast_vote('gx-1', 'b7000000-0000-0000-0000-000000000011'), 'accepted', 'auto-close: original link 1 votes');
select is(public.cast_vote('gx-2', 'b7000000-0000-0000-0000-000000000012'), 'accepted', 'auto-close: original link 2 votes');

reset role;
select is((select status from public.studies where id = 'a7000000-0000-0000-0000-000000000001'),
  'active'::public.study_status, 'auto-close: after the original links the study is still active');

set local role anon;
select is(public.cast_vote(current_setting('test.t3'), 'b7000000-0000-0000-0000-000000000011'), 'accepted', 'auto-close: new link 3 votes');
select is(public.cast_vote(current_setting('test.t4'), 'b7000000-0000-0000-0000-000000000011'), 'accepted', 'auto-close: new link 4 votes');
select is(public.cast_vote(current_setting('test.t5'), 'b7000000-0000-0000-0000-000000000012'), 'accepted', 'auto-close: new link 5 votes');

reset role;
select is((select status from public.studies where id = 'a7000000-0000-0000-0000-000000000001'),
  'closed'::public.study_status, 'auto-close: the vote on the last new link closes the study');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  $$ select public.add_study_links('a7000000-0000-0000-0000-000000000001', 1) $$,
  '55000', null, 'auto-close: adding to the now closed study raises 55000'
);

-- ---------------------------------------------------------------------------
-- Positions: start_study numbers a fresh study's links 1..N
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.start_study('a7000000-0000-0000-0000-000000000007') $$,
  'positions: the owner starts a draft with N = 4'
);
select is(
  (select array_agg(position order by position) from public.study_links
    where study_id = 'a7000000-0000-0000-0000-000000000007'),
  array[1, 2, 3, 4],
  'positions: start_study assigns 1..N'
);

reset role;

select * from finish();
rollback;
