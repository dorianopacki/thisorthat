-- study-closing-rules: the three closing paths share one rule. The vote that
-- uses the last link closes the study; a vote past the deadline records
-- nothing; close_study closes an active study once, irreversibly, for its
-- owner only. Assertions check recorded rows, not only return codes.
-- The concurrent vote/close case lives in study_closing_race.test.sql.
-- Fixtures are inserted as the test superuser; assertions run as the real roles.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- ---------------------------------------------------------------------------
-- Fixtures (uuid prefixes 1111/2222 users, a2 studies, b2 variants)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'author-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'author-b@example.com');

insert into public.studies (id, author_id, title, participant_target, status, closes_at, closes_tz) values
  ('a2000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Auto-close', 2, 'active', null, null),
  ('a2000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Deadline now', 1, 'active', now(), 'Europe/Warsaw'),
  ('a2000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Manual close', 2, 'active', null, null),
  ('a2000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Draft', 2, 'draft', null, null),
  ('a2000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Past deadline', 2, 'active', now() - interval '1 minute', 'Europe/Warsaw'),
  ('a2000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Foreign target', 2, 'active', null, null);

insert into public.variants (id, study_id, position, content) values
  ('b2000000-0000-0000-0000-000000000011', 'a2000000-0000-0000-0000-000000000001', 0, 'Auto left'),
  ('b2000000-0000-0000-0000-000000000012', 'a2000000-0000-0000-0000-000000000001', 1, 'Auto right'),
  ('b2000000-0000-0000-0000-000000000021', 'a2000000-0000-0000-0000-000000000002', 0, 'Deadline left'),
  ('b2000000-0000-0000-0000-000000000022', 'a2000000-0000-0000-0000-000000000002', 1, 'Deadline right'),
  ('b2000000-0000-0000-0000-000000000031', 'a2000000-0000-0000-0000-000000000003', 0, 'Manual left'),
  ('b2000000-0000-0000-0000-000000000032', 'a2000000-0000-0000-0000-000000000003', 1, 'Manual right');

insert into public.study_links (study_id, token, used) values
  ('a2000000-0000-0000-0000-000000000001', 'cl-auto-1', false),
  ('a2000000-0000-0000-0000-000000000001', 'cl-auto-2', false),
  ('a2000000-0000-0000-0000-000000000002', 'cl-dl-1', false),
  ('a2000000-0000-0000-0000-000000000003', 'cl-man-1', true),
  ('a2000000-0000-0000-0000-000000000003', 'cl-man-2', false);

-- The used link of the manual-close study already carries its vote.
insert into public.votes (study_id, variant_id) values
  ('a2000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-000000000031');

-- ---------------------------------------------------------------------------
-- Auto-close: the vote that uses the last link closes the study
-- ---------------------------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

select is(public.cast_vote('cl-auto-1', 'b2000000-0000-0000-0000-000000000011'), 'accepted',
  'auto-close: first of two links is accepted');

reset role;
select is((select status from public.studies where id = 'a2000000-0000-0000-0000-000000000001'),
  'active'::public.study_status, 'auto-close: one unused link left keeps the study active');

set local role anon;
select is(public.cast_vote('cl-auto-2', 'b2000000-0000-0000-0000-000000000012'), 'accepted',
  'auto-close: the last link is still accepted (the voter sees the thank-you)');
select is(public.get_ballot('cl-auto-1'), null, 'auto-close: the ballot is gone once all links are used');

reset role;
select is((select status from public.studies where id = 'a2000000-0000-0000-0000-000000000001'),
  'closed'::public.study_status, 'auto-close: the last vote writes closed');
select is((select count(*)::int from public.votes where study_id = 'a2000000-0000-0000-0000-000000000001'),
  2, 'auto-close: exactly two votes recorded');

-- ---------------------------------------------------------------------------
-- Deadline: a vote at the deadline records nothing
-- ---------------------------------------------------------------------------

set local role anon;
select is(public.cast_vote('cl-dl-1', 'b2000000-0000-0000-0000-000000000021'), 'study_ended',
  'deadline: a vote exactly at the deadline returns study_ended');

reset role;
select is((select count(*)::int from public.votes where study_id = 'a2000000-0000-0000-0000-000000000002'),
  0, 'deadline: no vote recorded');
select is((select used from public.study_links where token = 'cl-dl-1'),
  false, 'deadline: the link stays unused');

-- ---------------------------------------------------------------------------
-- Manual close (author A)
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select lives_ok($$ select public.close_study('a2000000-0000-0000-0000-000000000003') $$,
  'close_study: the owner closes an active study');

select is((select status from public.studies where id = 'a2000000-0000-0000-0000-000000000003'),
  'closed'::public.study_status, 'close_study: the study is closed');

select throws_ok($$ select public.close_study('a2000000-0000-0000-0000-000000000003') $$,
  '55000', null, 'close_study: closing twice raises 55000');

select throws_ok($$ select public.close_study('a2000000-0000-0000-0000-000000000004') $$,
  '55000', null, 'close_study: a draft cannot be closed (55000)');

select throws_ok($$ select public.close_study('a2000000-0000-0000-0000-000000000005') $$,
  '55000', null, 'close_study: a study past its deadline is already closed (55000)');

select is((public.get_study_results('a2000000-0000-0000-0000-000000000003') ->> 'responded')::int,
  1, 'after close: results still count the used link');

select is(
  (select sum((v ->> 'vote_count')::int)::int
     from jsonb_array_elements(public.get_study_results('a2000000-0000-0000-0000-000000000003') -> 'variants') as v),
  1,
  'after close: results still show the recorded vote'
);

-- Author B cannot close A's study.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);

select throws_ok($$ select public.close_study('a2000000-0000-0000-0000-000000000006') $$,
  'P0002', null, 'close_study: a foreign author gets P0002');

reset role;
select is((select status from public.studies where id = 'a2000000-0000-0000-0000-000000000006'),
  'active'::public.study_status, 'close_study: the foreign attempt left the study active');

-- ---------------------------------------------------------------------------
-- Participants after a manual close; anon cannot close
-- ---------------------------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

select is(public.cast_vote('cl-man-1', 'b2000000-0000-0000-0000-000000000031'), 'study_ended',
  'after close: a used link returns study_ended');
select is(public.cast_vote('cl-man-2', 'b2000000-0000-0000-0000-000000000031'), 'study_ended',
  'after close: an unused link returns study_ended');

select throws_ok($$ select public.close_study('a2000000-0000-0000-0000-000000000006') $$,
  '42501', null, 'anon: permission denied on close_study');

reset role;

select * from finish();
rollback;
