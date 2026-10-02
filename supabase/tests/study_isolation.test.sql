-- study-data-model: author isolation (RLS + grants) and study lifecycle rules.
-- Fixtures are inserted as the test superuser; assertions run as the real roles.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'author-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'author-b@example.com');

insert into public.studies (id, author_id, title, participant_target, status) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'A active', 3, 'active'),
  ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'A draft', 3, 'draft');

insert into public.variants (id, study_id, position, content) values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 0, 'Left'),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 1, 'Right'),
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 0, 'Draft left');

insert into public.study_links (study_id, token) values
  ('a0000000-0000-0000-0000-000000000001', 'iso-token-1'),
  ('a0000000-0000-0000-0000-000000000001', 'iso-token-2');

insert into public.votes (study_id, variant_id) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001');

insert into public.comments (study_id, variant_id, body) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'fixture comment');

-- ---------------------------------------------------------------------------
-- Author B cannot see or change author A's data
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);

select is((select count(*)::int from public.studies), 0, 'B sees none of A''s studies');
select is((select count(*)::int from public.variants), 0, 'B sees none of A''s variants');
select is((select count(*)::int from public.study_links), 0, 'B sees none of A''s links');

select throws_ok(
  $$ insert into public.variants (study_id, position, content)
     values ('a0000000-0000-0000-0000-000000000002', 1, 'Injected') $$,
  '42501',
  null,
  'B cannot insert a variant into A''s draft study'
);

select lives_ok(
  $$ update public.studies set title = 'hijacked'
      where id in ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002') $$,
  'B''s update of A''s studies runs without error'
);

select lives_ok(
  $$ delete from public.studies
      where id in ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002') $$,
  'B''s delete of A''s studies runs without error'
);

select is(
  public.get_study_results('a0000000-0000-0000-0000-000000000001'),
  null::jsonb,
  'get_study_results returns null for a study B does not own'
);

reset role;

select is(
  (select count(*)::int from public.studies
    where id in ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002')
      and title in ('A active', 'A draft')),
  2,
  'B''s update and delete affected 0 of A''s studies'
);

-- ---------------------------------------------------------------------------
-- anon has no table access and cannot read results
-- ---------------------------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

select throws_ok($$ select * from public.studies $$, '42501', null, 'anon: permission denied on studies');
select throws_ok($$ select * from public.variants $$, '42501', null, 'anon: permission denied on variants');
select throws_ok($$ select * from public.study_links $$, '42501', null, 'anon: permission denied on study_links');
select throws_ok($$ select * from public.votes $$, '42501', null, 'anon: permission denied on votes');
select throws_ok($$ select * from public.comments $$, '42501', null, 'anon: permission denied on comments');
select throws_ok(
  $$ select public.get_study_results('a0000000-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'anon: permission denied on get_study_results'
);

reset role;

-- ---------------------------------------------------------------------------
-- Lifecycle: author A
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select is((select count(*)::int from public.studies), 2, 'A sees both own studies');

select throws_ok(
  $$ update public.studies set status = 'closed' where id = 'a0000000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'A cannot update studies.status'
);

select lives_ok(
  $$ update public.studies set title = 'Renamed active' where id = 'a0000000-0000-0000-0000-000000000001' $$,
  'A''s title update on an active study runs without error'
);

select lives_ok(
  $$ update public.variants set content = 'Edited'
      where study_id = 'a0000000-0000-0000-0000-000000000001' $$,
  'A''s variant update on an active study runs without error'
);

select lives_ok(
  $$ update public.studies set title = 'Renamed draft' where id = 'a0000000-0000-0000-0000-000000000002' $$,
  'A can update the title of an own draft'
);

reset role;

select is(
  (select title from public.studies where id = 'a0000000-0000-0000-0000-000000000001'),
  'A active',
  'active study title unchanged (0 rows updated)'
);

select is(
  (select count(*)::int from public.variants
    where study_id = 'a0000000-0000-0000-0000-000000000001' and content = 'Edited'),
  0,
  'active study variants unchanged (0 rows updated)'
);

select is(
  (select title from public.studies where id = 'a0000000-0000-0000-0000-000000000002'),
  'Renamed draft',
  'draft study title updated'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select lives_ok(
  $$ delete from public.studies where id = 'a0000000-0000-0000-0000-000000000001' $$,
  'A can delete an own active study'
);

reset role;

select is(
  (select count(*)::int from public.studies where id = 'a0000000-0000-0000-0000-000000000001'),
  0,
  'active study deleted'
);

select is(
  (select (select count(*) from public.variants where study_id = 'a0000000-0000-0000-0000-000000000001')
        + (select count(*) from public.study_links where study_id = 'a0000000-0000-0000-0000-000000000001')
        + (select count(*) from public.votes where study_id = 'a0000000-0000-0000-0000-000000000001')
        + (select count(*) from public.comments where study_id = 'a0000000-0000-0000-0000-000000000001'))::int,
  0,
  'variants, links, votes and comments cascade with the study'
);

select * from finish();
rollback;
