-- study-data-model: anonymity guarantees.
-- Votes and comments cannot be tied to a link, a time or an insertion order;
-- authors read them only as aggregates through get_study_results, and
-- cast_vote does not reveal per-link `used` state.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- ---------------------------------------------------------------------------
-- Catalog checks
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from pg_constraint
    where contype = 'f'
      and conrelid in ('public.votes'::regclass, 'public.comments'::regclass)
      and confrelid = 'public.study_links'::regclass),
  0,
  'votes and comments have no foreign key to study_links'
);

select is(
  (select count(*)::int from pg_attribute
    where attrelid in ('public.votes'::regclass, 'public.comments'::regclass)
      and attnum > 0
      and not attisdropped
      and atttypid in ('timestamp'::regtype, 'timestamptz'::regtype)),
  0,
  'votes and comments have no timestamp/timestamptz column'
);

select is(
  (select count(*)::int from pg_attribute a
     left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid in ('public.votes'::regclass, 'public.comments'::regclass)
      and a.attnum > 0
      and not a.attisdropped
      and (a.attidentity <> '' or pg_get_expr(d.adbin, d.adrelid) ilike '%nextval%')),
  0,
  'votes and comments have no serial or identity column'
);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'author-a@example.com');

insert into public.studies (id, author_id, title, participant_target, status) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'A active', 4, 'active');

insert into public.variants (id, study_id, position, content) values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 0, 'Left'),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 1, 'Right');

insert into public.study_links (study_id, token) values
  ('a0000000-0000-0000-0000-000000000001', 'anon-token-1'),
  ('a0000000-0000-0000-0000-000000000001', 'anon-token-2'),
  ('a0000000-0000-0000-0000-000000000001', 'anon-token-3'),
  ('a0000000-0000-0000-0000-000000000001', 'anon-token-4');

-- Three participants vote, commenting in non-alphabetical order.
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

select public.cast_vote(
  'anon-token-1',
  'b0000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('variant_id', 'b0000000-0000-0000-0000-000000000001', 'body', 'zebra'))
);
select public.cast_vote(
  'anon-token-2',
  'b0000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('variant_id', 'b0000000-0000-0000-0000-000000000001', 'body', 'apple'))
);
select public.cast_vote(
  'anon-token-3',
  'b0000000-0000-0000-0000-000000000002',
  jsonb_build_array(jsonb_build_object('variant_id', 'b0000000-0000-0000-0000-000000000001', 'body', 'mango'))
);

reset role;

-- ---------------------------------------------------------------------------
-- Author A: no row-level access to votes, comments or link usage
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select throws_ok($$ select * from public.votes $$, '42501', null, 'author: permission denied on votes');
select throws_ok($$ select * from public.comments $$, '42501', null, 'author: permission denied on comments');
select throws_ok(
  $$ select used from public.study_links $$,
  '42501',
  null,
  'author: permission denied on study_links.used'
);

select is(
  (select count(*)::int from (select id, study_id, token, position from public.study_links) l),
  4,
  'author can select study_links (id, study_id, token, position)'
);

select is(
  (select array_agg(k order by k)
     from jsonb_object_keys(public.get_study_results('a0000000-0000-0000-0000-000000000001')) as k),
  array['responded', 'status', 'total', 'variants'],
  'get_study_results top-level keys are exactly status, responded, total, variants'
);

select is(
  (select array_agg(distinct k order by k)
     from jsonb_array_elements(public.get_study_results('a0000000-0000-0000-0000-000000000001') -> 'variants') as v,
          jsonb_object_keys(v) as k),
  array['comments', 'content', 'image_path', 'kind', 'position', 'variant_id', 'vote_count'],
  'get_study_results per-variant keys are exactly variant_id, position, kind, content, image_path, vote_count, comments'
);

select is(
  (select count(*)::int
     from jsonb_array_elements(public.get_study_results('a0000000-0000-0000-0000-000000000001') -> 'variants') as v
    where (select count(*) from jsonb_object_keys(v)) <> 7),
  0,
  'every variant object has exactly seven keys'
);

select is(
  public.get_study_results('a0000000-0000-0000-0000-000000000001') -> 'variants' -> 0 -> 'comments',
  '["apple", "mango", "zebra"]'::jsonb,
  'comments come back sorted by body, not by insertion order'
);

select is(
  (public.get_study_results('a0000000-0000-0000-0000-000000000001') ->> 'responded')::int,
  3,
  'responded is an aggregate count of used links'
);

reset role;

-- ---------------------------------------------------------------------------
-- cast_vote is not an oracle for per-link `used` state: invalid input raises
-- identically for a used and an unused token, and consumes nothing.
-- ---------------------------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

select throws_ok(
  $$ select public.cast_vote('anon-token-1', gen_random_uuid()) $$,
  '22023',
  null,
  'invalid variant with a USED token raises 22023'
);

select throws_ok(
  $$ select public.cast_vote('anon-token-4', gen_random_uuid()) $$,
  '22023',
  null,
  'invalid variant with an UNUSED token raises 22023'
);

select throws_ok(
  $$ select public.cast_vote('anon-token-1', 'b0000000-0000-0000-0000-000000000001', '{}'::jsonb) $$,
  '22023',
  null,
  'non-array p_comments with a USED token raises 22023'
);

select throws_ok(
  $$ select public.cast_vote('anon-token-4', 'b0000000-0000-0000-0000-000000000001', '{}'::jsonb) $$,
  '22023',
  null,
  'non-array p_comments with an UNUSED token raises 22023'
);

reset role;

select is(
  (select used from public.study_links where token = 'anon-token-4'),
  false,
  'the unused link stays unused after invalid calls'
);

select is((select count(*)::int from public.votes where study_id = 'a0000000-0000-0000-0000-000000000001'), 3, 'invalid calls recorded no vote');
select is((select count(*)::int from public.comments where study_id = 'a0000000-0000-0000-0000-000000000001'), 3, 'invalid calls recorded no comment');

select * from finish();
rollback;
