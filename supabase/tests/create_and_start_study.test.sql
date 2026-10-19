-- create-and-start-study: create_study and start_study behaviour (limits,
-- ownership, draft -> active transition, link generation).
-- Fixtures are inserted as the test superuser; assertions run as the real roles.
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'author-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'author-b@example.com');

insert into public.studies (id, author_id, title, participant_target, status) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Seven variants', 3, 'draft'),
  ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'One variant', 3, 'draft'),
  ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Valid draft', 3, 'draft');

-- A draft that got a 7th variant by direct insert (variant count is not a table constraint).
insert into public.variants (study_id, position, content)
select 'a0000000-0000-0000-0000-000000000001', p, 'Variant ' || p
  from generate_series(0, 6) as p;

insert into public.variants (study_id, position, content) values
  ('a0000000-0000-0000-0000-000000000002', 0, 'Only one'),
  ('a0000000-0000-0000-0000-000000000003', 0, 'Left'),
  ('a0000000-0000-0000-0000-000000000003', 1, 'Right');

-- ---------------------------------------------------------------------------
-- create_study: valid call (author A)
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select set_config(
  'test.study_id',
  public.create_study('  My study  ', 3,
    '[{"kind": "text", "content": "  Left  "}, {"kind": "text", "content": " Right"}]'::jsonb)::text,
  true
);

select isnt(nullif(current_setting('test.study_id', true), ''), null, 'create_study returns a study id');

reset role;

select is(
  (select status from public.studies where id = current_setting('test.study_id')::uuid),
  'draft'::public.study_status,
  'created study is a draft'
);

select is(
  (select author_id from public.studies where id = current_setting('test.study_id')::uuid),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'created study is owned by the caller'
);

select is(
  (select title from public.studies where id = current_setting('test.study_id')::uuid),
  'My study',
  'title is trimmed'
);

select is(
  (select array_agg(position || ':' || content order by position)
     from public.variants where study_id = current_setting('test.study_id')::uuid),
  array['0:Left', '1:Right'],
  'variants stored at positions 0 and 1 with trimmed content'
);

-- ---------------------------------------------------------------------------
-- create_study: rejected input inserts nothing (author A)
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.create_study('Too few', 3, '[{"kind": "text", "content": "Only"}]'::jsonb) $$,
  '22023',
  null,
  'create_study with 1 variant raises 22023'
);

select throws_ok(
  $$ select public.create_study('Too many', 3,
       '[{"kind": "text", "content": "1"}, {"kind": "text", "content": "2"}, {"kind": "text", "content": "3"},
         {"kind": "text", "content": "4"}, {"kind": "text", "content": "5"}, {"kind": "text", "content": "6"},
         {"kind": "text", "content": "7"}]'::jsonb) $$,
  '22023',
  null,
  'create_study with 7 variants raises 22023'
);

select throws_ok(
  $$ select public.create_study('Blank', 3,
       '[{"kind": "text", "content": "Left"}, {"kind": "text", "content": "   "}]'::jsonb) $$,
  '22023',
  null,
  'create_study with a blank variant raises 22023'
);

select throws_ok(
  $$ select public.create_study('N zero', 0,
       '[{"kind": "text", "content": "Left"}, {"kind": "text", "content": "Right"}]'::jsonb) $$,
  '23514',
  null,
  'create_study with N = 0 raises 23514'
);

select throws_ok(
  $$ select public.create_study('N too big', 101,
       '[{"kind": "text", "content": "Left"}, {"kind": "text", "content": "Right"}]'::jsonb) $$,
  '23514',
  null,
  'create_study with N = 101 raises 23514'
);

select throws_ok(
  $$ select public.create_study('   ', 3,
       '[{"kind": "text", "content": "Left"}, {"kind": "text", "content": "Right"}]'::jsonb) $$,
  '23514',
  null,
  'create_study with a blank title raises 23514'
);

select throws_ok(
  $$ select public.create_study(repeat('t', 201), 3,
       '[{"kind": "text", "content": "Left"}, {"kind": "text", "content": "Right"}]'::jsonb) $$,
  '23514',
  null,
  'create_study with a 201-character title raises 23514'
);

select throws_ok(
  $$ select public.create_study('Long variant', 3,
       jsonb_build_array(jsonb_build_object('kind', 'text', 'content', 'Left'),
                         jsonb_build_object('kind', 'text', 'content', repeat('v', 2001)))) $$,
  '23514',
  null,
  'create_study with a 2001-character variant raises 23514'
);

select throws_ok(
  $$ select public.create_study('No variants', 3, null::jsonb) $$,
  '22023',
  null,
  'create_study with null variants raises 22023'
);

reset role;

select is(
  (select count(*)::int from public.studies where author_id = '11111111-1111-1111-1111-111111111111'),
  4,
  'rejected create_study calls inserted no study'
);

-- ---------------------------------------------------------------------------
-- create_study (jsonb p_variant_items): the signature the app calls (author A)
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

-- Named arguments, as PostgREST calls it.
select set_config(
  'test.jsonb_study_id',
  public.create_study(
    p_title => '  Jsonb study  ',
    p_participant_target => 3,
    p_variant_items => '[{"kind": "text", "content": "  Left  ", "image_path": null},
                         {"kind": "text", "content": " Right"}]'::jsonb
  )::text,
  true
);

select isnt(nullif(current_setting('test.jsonb_study_id', true), ''), null, 'jsonb create_study returns a study id');

select throws_ok(
  $$ select public.create_study('Jsonb too few', 3, '[{"kind": "text", "content": "Only"}]'::jsonb) $$,
  '22023',
  null,
  'jsonb create_study with 1 variant raises 22023'
);

select throws_ok(
  $$ select public.create_study('Jsonb blank', 3,
       '[{"kind": "text", "content": "Left"}, {"kind": "text", "content": "   "}]'::jsonb) $$,
  '22023',
  null,
  'jsonb create_study with a blank variant raises 22023'
);

select throws_ok(
  $$ select public.create_study('Jsonb null', 3, null::jsonb) $$,
  '22023',
  null,
  'jsonb create_study with null variants raises 22023'
);

select throws_ok(
  $$ select public.create_study('Jsonb long', 3,
       jsonb_build_array(jsonb_build_object('kind', 'text', 'content', 'Left'),
                         jsonb_build_object('kind', 'text', 'content', repeat('v', 2001)))) $$,
  '23514',
  null,
  'jsonb create_study with a 2001-character variant raises 23514'
);

reset role;

select is(
  (select array_agg(position || ':' || kind || ':' || content || ':' || coalesce(image_path, '-') order by position)
     from public.variants where study_id = current_setting('test.jsonb_study_id')::uuid),
  array['0:text:Left:-', '1:text:Right:-'],
  'jsonb create_study stores text variants in order, trimmed, without an image'
);

select is(
  (select count(*)::int from public.studies where author_id = '11111111-1111-1111-1111-111111111111'),
  5,
  'rejected jsonb create_study calls inserted no study'
);

-- ---------------------------------------------------------------------------
-- start_study: variant count outside 2-6 (author A)
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.start_study('a0000000-0000-0000-0000-000000000001') $$,
  '22023',
  null,
  'start_study on a draft with 7 variants raises 22023'
);

select throws_ok(
  $$ select public.start_study('a0000000-0000-0000-0000-000000000002') $$,
  '22023',
  null,
  'start_study on a draft with 1 variant raises 22023'
);

reset role;

select is(
  (select count(*)::int from public.study_links
    where study_id in ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002')),
  0,
  'no links generated for drafts with an invalid variant count'
);

select is(
  (select count(*)::int from public.studies
    where id in ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002')
      and status = 'draft'),
  2,
  'drafts with an invalid variant count stay draft'
);

-- ---------------------------------------------------------------------------
-- start_study: valid start, then a second start (author A)
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select lives_ok(
  $$ select public.start_study(current_setting('test.study_id')::uuid) $$,
  'start_study on A''s 2-variant draft succeeds'
);

reset role;

select is(
  (select status from public.studies where id = current_setting('test.study_id')::uuid),
  'active'::public.study_status,
  'started study is active'
);

select is(
  (select count(*)::int from public.study_links where study_id = current_setting('test.study_id')::uuid),
  3,
  'exactly N = 3 links generated'
);

select is(
  (select count(distinct token)::int from public.study_links
    where study_id = current_setting('test.study_id')::uuid
      and token ~ '^[0-9a-f]{32}$'),
  3,
  'all tokens are distinct and 32 hex chars'
);

select is(
  (select count(*)::int from public.study_links where used and study_id = current_setting('test.study_id')::uuid),
  0,
  'generated links start unused'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.start_study(current_setting('test.study_id')::uuid) $$,
  '55000',
  null,
  'second start_study on the same study raises 55000'
);

reset role;

select is(
  (select count(*)::int from public.study_links where study_id = current_setting('test.study_id')::uuid),
  3,
  'link count unchanged after the second start'
);

-- ---------------------------------------------------------------------------
-- start_study: someone else's study, or no caller identity
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.start_study('a0000000-0000-0000-0000-000000000003') $$,
  'P0002',
  null,
  'B cannot start A''s draft (P0002)'
);

select set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);

select throws_ok(
  $$ select public.start_study('a0000000-0000-0000-0000-000000000003') $$,
  'P0002',
  null,
  'start_study without auth.uid() raises P0002'
);

reset role;

select is(
  (select status from public.studies where id = 'a0000000-0000-0000-0000-000000000003'),
  'draft'::public.study_status,
  'A''s draft stays draft'
);

select is(
  (select count(*)::int from public.study_links where study_id = 'a0000000-0000-0000-0000-000000000003'),
  0,
  'A''s draft has no links'
);

-- ---------------------------------------------------------------------------
-- anon cannot call either function
-- ---------------------------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

select throws_ok(
  $$ select public.create_study('Anon', 3,
       '[{"kind": "text", "content": "Left"}, {"kind": "text", "content": "Right"}]'::jsonb) $$,
  '42501',
  null,
  'anon: permission denied on create_study'
);

select throws_ok(
  $$ select public.start_study('a0000000-0000-0000-0000-000000000003') $$,
  '42501',
  null,
  'anon: permission denied on start_study'
);

reset role;

select * from finish();
rollback;
