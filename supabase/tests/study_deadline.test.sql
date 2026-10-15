-- study-closing-rules: the deadline rule (study_status_effective and the
-- effective_status computed field), deadline-aware reads (get_ballot,
-- get_study_results), create_study with a deadline, start_study past the
-- deadline. now() is fixed for the whole test transaction, so deadlines of
-- now() - 1 minute, now() and now() + 1 minute are deterministic boundaries.
-- Fixtures are inserted as the test superuser; assertions run as the real roles.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'author-a@example.com');

insert into public.studies (id, author_id, title, participant_target, status, closes_at, closes_tz) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Past deadline', 2, 'active', now() - interval '1 minute', 'Europe/Warsaw'),
  ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Deadline now', 2, 'active', now(), 'Europe/Warsaw'),
  ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Future deadline', 2, 'active', now() + interval '1 minute', 'Europe/Warsaw'),
  ('a0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'No deadline', 2, 'active', null, null),
  ('a0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Draft past deadline', 2, 'draft', now() - interval '1 minute', 'Europe/Warsaw'),
  ('a0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Draft future deadline', 2, 'draft', now() + interval '1 day', 'Europe/Warsaw');

insert into public.variants (study_id, position, content)
select s.id, p, 'Variant ' || p
  from public.studies s, generate_series(0, 1) as p
 where s.author_id = '11111111-1111-1111-1111-111111111111';

insert into public.study_links (study_id, token) values
  ('a0000000-0000-0000-0000-000000000001', 'dl-past'),
  ('a0000000-0000-0000-0000-000000000002', 'dl-now'),
  ('a0000000-0000-0000-0000-000000000003', 'dl-future'),
  ('a0000000-0000-0000-0000-000000000004', 'dl-none');

-- ---------------------------------------------------------------------------
-- A deadline is both columns or neither
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.studies (author_id, title, participant_target, closes_at)
     values ('11111111-1111-1111-1111-111111111111', 'Half deadline', 2, now() + interval '1 day') $$,
  '23514',
  null,
  'closes_at without closes_tz violates the check'
);

-- ---------------------------------------------------------------------------
-- study_status_effective: the closing rule
-- ---------------------------------------------------------------------------

select is(public.study_status_effective('active', now() - interval '1 minute'), 'closed'::public.study_status,
  'active one minute past the deadline is closed');
select is(public.study_status_effective('active', now()), 'closed'::public.study_status,
  'active exactly at the deadline is closed');
select is(public.study_status_effective('active', now() + interval '1 minute'), 'active'::public.study_status,
  'active one minute before the deadline is active');
select is(public.study_status_effective('active', null), 'active'::public.study_status,
  'active without a deadline is active');
select is(public.study_status_effective('draft', now() - interval '1 minute'), 'draft'::public.study_status,
  'a draft past its deadline stays a draft');
select is(public.study_status_effective('closed', now() + interval '1 minute'), 'closed'::public.study_status,
  'closed before the deadline stays closed');

-- ---------------------------------------------------------------------------
-- Author reads: computed field and get_study_results
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select is(
  (select public.effective_status(s) from public.studies s where s.id = 'a0000000-0000-0000-0000-000000000001'),
  'closed'::public.study_status,
  'effective_status computed field: past deadline reads closed'
);

select is(
  public.get_study_results('a0000000-0000-0000-0000-000000000002') ->> 'status',
  'closed',
  'get_study_results: status is closed at the deadline'
);

select is(
  public.get_study_results('a0000000-0000-0000-0000-000000000003') ->> 'status',
  'active',
  'get_study_results: status is active before the deadline'
);

-- ---------------------------------------------------------------------------
-- create_study with a deadline (author A)
-- ---------------------------------------------------------------------------

select set_config(
  'test.summer',
  public.create_study('Summer', 2, array['Left', 'Right'], '2099-06-15 18:00', 'Europe/Warsaw')::text,
  true
);
select set_config(
  'test.gap',
  public.create_study('Spring gap', 2, array['Left', 'Right'], '2099-03-29 02:30', 'Europe/Warsaw')::text,
  true
);
select set_config(
  'test.doubled',
  public.create_study('Doubled hour', 2, array['Left', 'Right'], '2099-10-25 02:30', 'Europe/Warsaw')::text,
  true
);
select set_config(
  'test.none',
  public.create_study('No deadline', 2, array['Left', 'Right'])::text,
  true
);

select is(
  (select closes_at from public.studies where id = current_setting('test.summer')::uuid),
  '2099-06-15 16:00:00+00'::timestamptz,
  'create_study: 18:00 Warsaw summer time is 16:00 UTC'
);

select is(
  (select closes_tz from public.studies where id = current_setting('test.summer')::uuid),
  'Europe/Warsaw',
  'create_study: stores the IANA zone'
);

-- Postgres reads a local time inside the spring gap with the offset in force
-- before the jump (+01), and the doubled autumn hour with the offset in force
-- after the jump back (+01).
select is(
  (select closes_at from public.studies where id = current_setting('test.gap')::uuid),
  '2099-03-29 01:30:00+00'::timestamptz,
  'create_study: 02:30 in the spring gap is read as +01'
);

select is(
  (select closes_at from public.studies where id = current_setting('test.doubled')::uuid),
  '2099-10-25 01:30:00+00'::timestamptz,
  'create_study: the doubled 02:30 in autumn is read as +01'
);

select is(
  (select closes_at from public.studies where id = current_setting('test.none')::uuid),
  null,
  'create_study: no deadline leaves closes_at null'
);

select throws_ok(
  $$ select public.create_study('Bad zone', 2, array['Left', 'Right'], '2099-06-15 18:00', 'Mars/Olympus') $$,
  '22023',
  null,
  'create_study: unknown time zone'
);

-- pg_timezone_names also lists names Intl rejects (posix/…, Factory); the author page formats the
-- deadline with Intl, so create_study must refuse them.
select throws_ok(
  $$ select public.create_study('Posix zone', 2, array['Left', 'Right'], '2099-06-15 18:00', 'posix/Europe/Warsaw') $$,
  '22023',
  null,
  'create_study: a posix/ zone Intl cannot format'
);

select throws_ok(
  $$ select public.create_study('Factory zone', 2, array['Left', 'Right'], '2099-06-15 18:00', 'Factory') $$,
  '22023',
  null,
  'create_study: the Factory zone'
);

select throws_ok(
  $$ select public.create_study('Local only', 2, array['Left', 'Right'], '2099-06-15 18:00', null) $$,
  '22023',
  null,
  'create_study: local time without a zone'
);

select throws_ok(
  $$ select public.create_study('Zone only', 2, array['Left', 'Right'], null, 'Europe/Warsaw') $$,
  '22023',
  null,
  'create_study: zone without a local time'
);

select throws_ok(
  $$ select public.create_study('Past', 2, array['Left', 'Right'], '2020-01-01 12:00', 'Europe/Warsaw') $$,
  '22023',
  null,
  'create_study: a deadline in the past'
);

-- ---------------------------------------------------------------------------
-- start_study and the deadline
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.start_study('a0000000-0000-0000-0000-000000000005') $$,
  '22008',
  null,
  'start_study: refuses a draft whose deadline has passed'
);

select lives_ok(
  $$ select public.start_study('a0000000-0000-0000-0000-000000000006') $$,
  'start_study: starts a draft whose deadline is ahead'
);

-- ---------------------------------------------------------------------------
-- The deadline is written only by create_study: no direct update, so no
-- unvalidated zone (no column grant for update on closes_at / closes_tz)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update public.studies set closes_tz = 'Factory'
      where id = current_setting('test.summer')::uuid $$,
  '42501',
  null,
  'an author cannot update the deadline zone directly, even on a draft'
);

reset role;

select is(
  (select closes_tz from public.studies where id = current_setting('test.summer')::uuid),
  'Europe/Warsaw',
  'the draft keeps its validated zone'
);

-- ---------------------------------------------------------------------------
-- Participant read: get_ballot follows the deadline
-- ---------------------------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

select is(public.get_ballot('dl-past'), null, 'get_ballot: null one minute past the deadline');
select is(public.get_ballot('dl-now'), null, 'get_ballot: null exactly at the deadline');
select isnt(public.get_ballot('dl-future'), null, 'get_ballot: ballot one minute before the deadline');
select isnt(public.get_ballot('dl-none'), null, 'get_ballot: ballot without a deadline');

-- ---------------------------------------------------------------------------
-- anon cannot call the rule functions
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.study_status_effective('active', null) $$,
  '42501',
  null,
  'anon: permission denied on study_status_effective'
);

select throws_ok(
  $$ select public.effective_status(null::public.studies) $$,
  '42501',
  null,
  'anon: permission denied on effective_status'
);

reset role;

select * from finish();
rollback;
