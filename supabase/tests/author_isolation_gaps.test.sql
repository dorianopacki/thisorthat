-- testing-access-boundaries: author isolation gaps not covered by
-- study_isolation.test.sql / create_and_start_study.test.sql.
-- Author B owns a study of their own, so "B sees only own rows" is proven
-- (not just "B sees zero"). Every write B attempts on A's data either raises
-- or changes 0 rows; A's rows are re-checked as the superuser at the end.
-- Fixtures are inserted as the test superuser; assertions run as the real roles.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- ---------------------------------------------------------------------------
-- Fixtures (uuid prefixes 3333/4444 users, c1 studies, d1 variants, e1 links)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('33333333-3333-3333-3333-333333333333', 'gaps-author-a@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'gaps-author-b@example.com');

insert into public.studies (id, author_id, title, participant_target, status) values
  ('c1000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'A draft', 3, 'draft'),
  ('c1000000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'A active', 2, 'active'),
  ('c1000000-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'A closed', 4, 'closed'),
  ('c1000000-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444444', 'B draft', 5, 'draft');

insert into public.variants (id, study_id, position, content) values
  ('d1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 0, 'A draft left'),
  ('d1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 1, 'A draft right'),
  ('d1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000002', 0, 'A active left'),
  ('d1000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000002', 1, 'A active right'),
  ('d1000000-0000-0000-0000-000000000005', 'c1000000-0000-0000-0000-000000000003', 0, 'A closed left'),
  ('d1000000-0000-0000-0000-000000000006', 'c1000000-0000-0000-0000-000000000003', 1, 'A closed right'),
  ('d1000000-0000-0000-0000-000000000007', 'c1000000-0000-0000-0000-000000000004', 0, 'B own variant');

insert into public.study_links (id, study_id, token) values
  ('e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'gaps-a-token-1'),
  ('e1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002', 'gaps-a-token-2'),
  ('e1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000004', 'gaps-b-token-1');

-- ---------------------------------------------------------------------------
-- As author B
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '44444444-4444-4444-4444-444444444444', 'role', 'authenticated')::text,
  true
);

-- Reads: exactly own rows, not zero

select is(
  (select array_agg(id order by id) from public.studies),
  array['c1000000-0000-0000-0000-000000000004']::uuid[],
  'B: sees exactly own study, none of A''s'
);

select is(
  (select array_agg(id order by id) from public.variants),
  array['d1000000-0000-0000-0000-000000000007']::uuid[],
  'B: sees exactly own variant, none of A''s'
);

select is(
  (select array_agg(id order by id) from public.study_links),
  array['e1000000-0000-0000-0000-000000000003']::uuid[],
  'B: sees exactly own link, none of A''s'
);

select throws_ok(
  $$ select used from public.study_links $$,
  '42501',
  null,
  'B: cannot read study_links.used (42501)'
);

-- Variants of A's draft, active and closed studies

select lives_ok(
  $$ update public.variants set content = 'hijacked'
      where study_id in ('c1000000-0000-0000-0000-000000000001',
                         'c1000000-0000-0000-0000-000000000002',
                         'c1000000-0000-0000-0000-000000000003') $$,
  'B: update of A''s variant content runs without error'
);

select lives_ok(
  $$ update public.variants set position = position + 10
      where study_id in ('c1000000-0000-0000-0000-000000000001',
                         'c1000000-0000-0000-0000-000000000002',
                         'c1000000-0000-0000-0000-000000000003') $$,
  'B: update of A''s variant positions runs without error'
);

select lives_ok(
  $$ delete from public.variants
      where study_id in ('c1000000-0000-0000-0000-000000000001',
                         'c1000000-0000-0000-0000-000000000002',
                         'c1000000-0000-0000-0000-000000000003') $$,
  'B: delete of A''s variants runs without error'
);

select throws_ok(
  $$ insert into public.variants (study_id, position, content)
     values ('c1000000-0000-0000-0000-000000000002', 5, 'Injected') $$,
  '42501',
  null,
  'B: cannot insert a variant into A''s active study (42501)'
);

-- Studies

select throws_ok(
  $$ insert into public.studies (author_id, title, participant_target)
     values ('33333333-3333-3333-3333-333333333333', 'Planted on A', 3) $$,
  '42501',
  null,
  'B: cannot insert a study with author_id = A (42501)'
);

select lives_ok(
  $$ update public.studies set participant_target = 99
      where id = 'c1000000-0000-0000-0000-000000000001' $$,
  'B: update of participant_target on A''s draft runs without error'
);

select throws_ok(
  $$ update public.studies set status = 'closed'
      where id = 'c1000000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'B: cannot update studies.status (42501)'
);

-- study_links of A's active study

select throws_ok(
  $$ insert into public.study_links (study_id)
     values ('c1000000-0000-0000-0000-000000000002') $$,
  '42501',
  null,
  'B: cannot insert a link into A''s study (42501)'
);

select throws_ok(
  $$ update public.study_links set used = true
      where study_id = 'c1000000-0000-0000-0000-000000000002' $$,
  '42501',
  null,
  'B: cannot update A''s links (42501)'
);

select throws_ok(
  $$ delete from public.study_links
      where study_id = 'c1000000-0000-0000-0000-000000000002' $$,
  '42501',
  null,
  'B: cannot delete A''s links (42501)'
);

-- Functions on A's ids and an unknown id

select throws_ok(
  $$ select public.start_study('c1000000-0000-0000-0000-000000000002') $$,
  'P0002',
  null,
  'B: start_study on A''s active study raises P0002'
);

select throws_ok(
  $$ select public.start_study('c1000000-0000-0000-0000-000000000003') $$,
  'P0002',
  null,
  'B: start_study on A''s closed study raises P0002'
);

select throws_ok(
  $$ select public.start_study('c1000000-0000-0000-0000-0000000000ff') $$,
  'P0002',
  null,
  'B: start_study on an unknown uuid raises P0002'
);

select throws_ok(
  $$ select public.close_study('c1000000-0000-0000-0000-000000000002') $$,
  'P0002',
  null,
  'B: close_study on A''s active study raises P0002'
);

select throws_ok(
  $$ select public.close_study('c1000000-0000-0000-0000-0000000000ff') $$,
  'P0002',
  null,
  'B: close_study on an unknown uuid raises P0002'
);

select is(
  public.get_study_results('c1000000-0000-0000-0000-000000000001'),
  null::jsonb,
  'B: get_study_results on A''s draft returns null'
);

select is(
  public.get_study_results('c1000000-0000-0000-0000-000000000003'),
  null::jsonb,
  'B: get_study_results on A''s closed study returns null'
);

select is(
  public.get_study_results('c1000000-0000-0000-0000-0000000000ff'),
  null::jsonb,
  'B: get_study_results on an unknown uuid returns null'
);

reset role;

-- ---------------------------------------------------------------------------
-- As the superuser: A's rows are unchanged
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(title || '|' || participant_target || '|' || status order by id)
     from public.studies
    where author_id = '33333333-3333-3333-3333-333333333333'),
  array['A draft|3|draft', 'A active|2|active', 'A closed|4|closed'],
  'B: attempts left A''s studies unchanged (no extra study, titles, targets, statuses)'
);

select is(
  (select array_agg(position || '|' || content order by id)
     from public.variants
    where study_id in ('c1000000-0000-0000-0000-000000000001',
                       'c1000000-0000-0000-0000-000000000002',
                       'c1000000-0000-0000-0000-000000000003')),
  array['0|A draft left', '1|A draft right', '0|A active left',
        '1|A active right', '0|A closed left', '1|A closed right'],
  'B: attempts left A''s variants unchanged (none added, deleted or edited)'
);

select is(
  (select array[count(*), count(*) filter (where not used)]::int[]
     from public.study_links
    where study_id = 'c1000000-0000-0000-0000-000000000002'),
  array[2, 2],
  'B: attempts left A''s links unchanged (2 links, all unused)'
);

select * from finish();
rollback;
