-- one-time-link-voting: get_ballot behaviour (shape, null cases, role access)
-- and the no-oracle guarantee: a used and an unused link of the same active
-- study return identical output, so the read path never reveals link usage.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'author-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'author-b@example.com');

insert into public.studies (id, author_id, title, participant_target, status) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Active', 2, 'active'),
  ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Closed', 1, 'closed'),
  ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Draft', 1, 'draft');

-- Active variants inserted out of position order.
insert into public.variants (id, study_id, position, content) values
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 1, 'Right'),
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 0, 'Left'),
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 0, 'Closed left'),
  ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000003', 0, 'Draft left');

insert into public.study_links (study_id, token) values
  ('a0000000-0000-0000-0000-000000000001', 'gb-token-1'),
  ('a0000000-0000-0000-0000-000000000001', 'gb-token-2'),
  ('a0000000-0000-0000-0000-000000000002', 'gb-closed-1'),
  ('a0000000-0000-0000-0000-000000000003', 'gb-draft-1');

-- ---------------------------------------------------------------------------
-- Shape, as anon, on an unused link
-- ---------------------------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

select is(
  public.get_ballot('gb-token-1'),
  '{
     "title": "Active",
     "variants": [
       { "variant_id": "b0000000-0000-0000-0000-000000000001", "kind": "text", "content": "Left", "image_path": null },
       { "variant_id": "b0000000-0000-0000-0000-000000000002", "kind": "text", "content": "Right", "image_path": null }
     ]
   }'::jsonb,
  'anon: unused active token returns the title and variants in position order'
);

select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.get_ballot('gb-token-1')) as k),
  array['title', 'variants'],
  'top-level keys are exactly title, variants'
);

select is(
  (select array_agg(distinct k order by k)
     from jsonb_array_elements(public.get_ballot('gb-token-1') -> 'variants') as v,
          jsonb_object_keys(v) as k),
  array['content', 'image_path', 'kind', 'variant_id'],
  'per-variant keys are exactly variant_id, kind, content, image_path'
);

select is(
  (select count(*)::int
     from jsonb_array_elements(public.get_ballot('gb-token-1') -> 'variants') as v
    where (select count(*) from jsonb_object_keys(v)) <> 4),
  0,
  'every variant object has exactly four keys'
);

-- Remember the pre-vote output of token 1 for the no-oracle comparison.
select set_config('test.ballot_before', public.get_ballot('gb-token-1')::text, true);

-- ---------------------------------------------------------------------------
-- No oracle: a used link reads exactly like an unused one
-- ---------------------------------------------------------------------------

select is(
  public.cast_vote('gb-token-1', 'b0000000-0000-0000-0000-000000000002'),
  'accepted',
  'cast_vote consumes token 1'
);

select is(
  public.get_ballot('gb-token-1'),
  public.get_ballot('gb-token-2'),
  'used token 1 returns the same ballot as unused token 2'
);

select is(
  public.get_ballot('gb-token-1'),
  current_setting('test.ballot_before')::jsonb,
  'used token 1 returns the same ballot as before the vote'
);

-- ---------------------------------------------------------------------------
-- Null cases
-- ---------------------------------------------------------------------------

select is(public.get_ballot('no-such-token'), null::jsonb, 'unknown token returns null');
select is(public.get_ballot('gb-closed-1'), null::jsonb, 'token of a closed study returns null');
select is(public.get_ballot('gb-draft-1'), null::jsonb, 'token of a draft study returns null');

-- ---------------------------------------------------------------------------
-- Role access: get_ballot opens no table to anon
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select token from public.study_links $$,
  '42501',
  null,
  'anon: still permission denied on study_links'
);

-- ---------------------------------------------------------------------------
-- authenticated callers (owner and stranger) get the same result as anon
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select is(
  public.get_ballot('gb-token-2'),
  current_setting('test.ballot_before')::jsonb,
  'author A (owner) gets the same ballot as anon'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);

select is(
  public.get_ballot('gb-token-2'),
  current_setting('test.ballot_before')::jsonb,
  'author B (stranger) gets the same ballot as anon'
);

select is(public.get_ballot('gb-closed-1'), null::jsonb, 'author B: closed-study token returns null');

-- ---------------------------------------------------------------------------
-- Deleted study
-- ---------------------------------------------------------------------------

reset role;

delete from public.studies where id = 'a0000000-0000-0000-0000-000000000001';

set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

select is(public.get_ballot('gb-token-2'), null::jsonb, 'token of a deleted study returns null');

select * from finish();
rollback;
