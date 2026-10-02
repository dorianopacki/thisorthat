-- study-data-model: cast_vote behaviour (return codes, atomic consume,
-- input validation before the link is consumed, comment handling).
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'author-a@example.com');

insert into public.studies (id, author_id, title, participant_target, status) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Active', 4, 'active'),
  ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Closed', 1, 'closed'),
  ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Draft', 1, 'draft');

insert into public.variants (id, study_id, position, content) values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 0, 'Left'),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 1, 'Right'),
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 0, 'Closed left'),
  ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000003', 0, 'Draft left');

insert into public.study_links (study_id, token) values
  ('a0000000-0000-0000-0000-000000000001', 'cv-token-1'),
  ('a0000000-0000-0000-0000-000000000001', 'cv-token-2'),
  ('a0000000-0000-0000-0000-000000000001', 'cv-token-3'),
  ('a0000000-0000-0000-0000-000000000002', 'cv-closed-1'),
  ('a0000000-0000-0000-0000-000000000003', 'cv-draft-1');

-- ---------------------------------------------------------------------------
-- Valid vote, then the same token again
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select is(
  (public.get_study_results('a0000000-0000-0000-0000-000000000001') ->> 'responded')::int,
  0,
  'responded starts at 0'
);

set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

select is(
  public.cast_vote('cv-token-1', 'b0000000-0000-0000-0000-000000000001'),
  'accepted',
  'valid token returns accepted'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select is(
  (public.get_study_results('a0000000-0000-0000-0000-000000000001') ->> 'responded')::int,
  1,
  'responded goes to 1'
);

select is(
  (public.get_study_results('a0000000-0000-0000-0000-000000000001') -> 'variants' -> 0 ->> 'vote_count')::int,
  1,
  'the vote is counted for the chosen variant'
);

set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

select is(
  public.cast_vote('cv-token-1', 'b0000000-0000-0000-0000-000000000002'),
  'link_used',
  'same token again returns link_used'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select is(
  (public.get_study_results('a0000000-0000-0000-0000-000000000001') ->> 'responded')::int,
  1,
  'responded unchanged after link_used'
);

select is(
  (select sum((v ->> 'vote_count')::int)::int
     from jsonb_array_elements(public.get_study_results('a0000000-0000-0000-0000-000000000001') -> 'variants') as v),
  1,
  'vote counts unchanged after link_used'
);

-- ---------------------------------------------------------------------------
-- Ended studies and unknown tokens
-- ---------------------------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

select is(
  public.cast_vote('no-such-token', 'b0000000-0000-0000-0000-000000000001'),
  'study_ended',
  'unknown token returns study_ended'
);

select is(
  public.cast_vote('cv-closed-1', 'b0000000-0000-0000-0000-000000000003'),
  'study_ended',
  'token of a closed study returns study_ended'
);

select is(
  public.cast_vote('cv-draft-1', 'b0000000-0000-0000-0000-000000000004'),
  'study_ended',
  'token of a draft study returns study_ended'
);

-- ---------------------------------------------------------------------------
-- Invalid input raises before the link is consumed
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.cast_vote('cv-token-2', 'b0000000-0000-0000-0000-000000000003') $$,
  '22023',
  null,
  'variant of another study raises'
);

reset role;

select is(
  (select used from public.study_links where token = 'cv-token-2'),
  false,
  'link remains unused after a foreign-variant vote'
);

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

select throws_ok(
  $$ select public.cast_vote(
       'cv-token-2',
       'b0000000-0000-0000-0000-000000000001',
       jsonb_build_array(
         jsonb_build_object('variant_id', 'b0000000-0000-0000-0000-000000000001', 'body', 'first'),
         jsonb_build_object('variant_id', 'b0000000-0000-0000-0000-000000000001', 'body', 'second')
       )
     ) $$,
  '22023',
  null,
  'duplicate comment variant_id raises'
);

select throws_ok(
  $$ select public.cast_vote(
       'cv-token-2',
       'b0000000-0000-0000-0000-000000000001',
       jsonb_build_array(jsonb_build_object('variant_id', 'b0000000-0000-0000-0000-000000000001', 'body', repeat('x', 2001)))
     ) $$,
  '22023',
  null,
  'comment body over 2000 characters raises'
);

select throws_ok(
  $$ select public.cast_vote(
       'cv-token-2',
       'b0000000-0000-0000-0000-000000000001',
       jsonb_build_array(jsonb_build_object('variant_id', 'b0000000-0000-0000-0000-000000000003', 'body', 'elsewhere'))
     ) $$,
  '22023',
  null,
  'comment on a variant of another study raises'
);

select throws_ok(
  $$ select public.cast_vote(
       'cv-token-2',
       'b0000000-0000-0000-0000-000000000001',
       jsonb_build_array(jsonb_build_object('variant_id', 'not-a-uuid', 'body', 'malformed'))
     ) $$,
  '22023',
  null,
  'comment with a malformed variant_id raises 22023'
);

reset role;

select is(
  (select used from public.study_links where token = 'cv-token-2'),
  false,
  'link remains unused after rejected comments'
);

set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

select is(
  public.cast_vote(
    'cv-token-2',
    'b0000000-0000-0000-0000-000000000002',
    jsonb_build_array(
      jsonb_build_object('variant_id', 'b0000000-0000-0000-0000-000000000001', 'body', '   '),
      jsonb_build_object('variant_id', 'b0000000-0000-0000-0000-000000000002', 'body', '  looks cleaner  '),
      jsonb_build_object('variant_id', 'b0000000-0000-0000-0000-000000000001', 'body', '')
    )
  ),
  'accepted',
  'vote with blank and non-blank comments is accepted'
);

reset role;

select is(
  (select count(*)::int from public.comments where study_id = 'a0000000-0000-0000-0000-000000000001'),
  1,
  'blank comment bodies are skipped'
);

select is(
  (select body from public.comments where study_id = 'a0000000-0000-0000-0000-000000000001'),
  'looks cleaner',
  'stored comment body is trimmed'
);

select is(
  (select count(*)::int from public.votes where study_id = 'a0000000-0000-0000-0000-000000000001'),
  2,
  'exactly two votes recorded for the active study'
);

select is(
  (select count(*)::int from public.votes where study_id <> 'a0000000-0000-0000-0000-000000000001'),
  0,
  'no votes recorded for closed or draft studies'
);

select * from finish();
rollback;
