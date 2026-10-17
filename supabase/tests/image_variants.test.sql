-- image-variants (S-08): the variant kind/image check, image ownership and
-- path reuse in create_study / update_study_draft (jsonb p_variant_items),
-- the variant-images bucket and its storage.objects isolation matrix, the
-- new ballot/results keys, and anon access to the write RPCs.
-- Fixtures (including storage objects, with an explicit owner_id) are
-- inserted as the test superuser; assertions run as the real roles.
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

-- ---------------------------------------------------------------------------
-- Fixtures (uuid prefixes 7777/8888 users, e1 studies, e2 variants)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('77777777-7777-7777-7777-777777777777', 'image-author-a@example.com'),
  ('88888888-8888-8888-8888-888888888888', 'image-author-b@example.com');

-- A owns 4 objects, B owns 1. No object exists for cccccccc-….
insert into storage.objects (bucket_id, name, owner_id) values
  ('variant-images', 'aaaaaaaa-0000-4000-8000-000000000001.webp', '77777777-7777-7777-7777-777777777777'),
  ('variant-images', 'aaaaaaaa-0000-4000-8000-000000000002.jpg',  '77777777-7777-7777-7777-777777777777'),
  ('variant-images', 'aaaaaaaa-0000-4000-8000-000000000003.webp', '77777777-7777-7777-7777-777777777777'),
  ('variant-images', 'aaaaaaaa-0000-4000-8000-000000000004.webp', '77777777-7777-7777-7777-777777777777'),
  ('variant-images', 'bbbbbbbb-0000-4000-8000-000000000001.webp', '88888888-8888-8888-8888-888888888888');

insert into public.studies (id, author_id, title, participant_target, status) values
  ('e1000000-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777', 'A edit', 2, 'draft'),
  ('e1000000-0000-0000-0000-000000000002', '77777777-7777-7777-7777-777777777777', 'A other', 2, 'draft'),
  ('e1000000-0000-0000-0000-000000000003', '77777777-7777-7777-7777-777777777777', 'A active', 2, 'active'),
  ('e1000000-0000-0000-0000-000000000004', '88888888-8888-8888-8888-888888888888', 'B draft', 2, 'draft');

insert into public.variants (id, study_id, position, kind, content, image_path) values
  ('e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 0, 'text', 'V0', null),
  ('e2000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 1, 'text', 'V1', null),
  ('e2000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000002', 0, 'text', 'Other text', null),
  ('e2000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000002', 1, 'image', 'Other image',
   'aaaaaaaa-0000-4000-8000-000000000003.webp'),
  ('e2000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000003', 0, 'text', 'Plain', null),
  ('e2000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000003', 1, 'image', 'Kitten',
   'aaaaaaaa-0000-4000-8000-000000000004.webp'),
  ('e2000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000004', 0, 'text', 'B0', null),
  ('e2000000-0000-0000-0000-000000000008', 'e1000000-0000-0000-0000-000000000004', 1, 'text', 'B1', null);

insert into public.study_links (study_id, token) values
  ('e1000000-0000-0000-0000-000000000003', 'iv-token-1');

-- ---------------------------------------------------------------------------
-- The bucket
-- ---------------------------------------------------------------------------

select is(
  (select public || '|' || file_size_limit || '|' || allowed_mime_types::text
     from storage.buckets where id = 'variant-images'),
  'false|1048576|{image/webp,image/jpeg}',
  'variant-images is private, 1 MiB, webp/jpeg only'
);

-- ---------------------------------------------------------------------------
-- The variant check (as the superuser, on A's draft)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.variants (study_id, position, kind, content, image_path)
     values ('e1000000-0000-0000-0000-000000000001', 10, 'text', 'Text', 'aaaaaaaa-0000-4000-8000-000000000001.webp') $$,
  '23514',
  null,
  'check: a text variant with an image_path is rejected'
);

select throws_ok(
  $$ insert into public.variants (study_id, position, kind, content, image_path)
     values ('e1000000-0000-0000-0000-000000000001', 10, 'image', 'No image', null) $$,
  '23514',
  null,
  'check: an image variant without an image_path is rejected'
);

select throws_ok(
  $$ insert into public.variants (study_id, position, kind, content, image_path)
     values ('e1000000-0000-0000-0000-000000000001', 10, 'image', repeat('d', 201),
             'aaaaaaaa-0000-4000-8000-000000000001.webp') $$,
  '23514',
  null,
  'check: an image description over 200 characters is rejected'
);

select throws_ok(
  $$ insert into public.variants (study_id, position, kind, content, image_path)
     values ('e1000000-0000-0000-0000-000000000001', 10, 'image', 'Bad path', '../aaaaaaaa-0000-4000-8000-000000000001.png') $$,
  '23514',
  null,
  'check: a malformed image_path is rejected'
);

select throws_ok(
  $$ insert into public.variants (study_id, position, kind, content, image_path)
     values ('e1000000-0000-0000-0000-000000000001', 10, 'image', 'Reused', 'aaaaaaaa-0000-4000-8000-000000000003.webp') $$,
  '23505',
  null,
  'backstop: the unique index refuses an image_path already used by another variant'
);

-- ---------------------------------------------------------------------------
-- Both signatures exist; anon can execute none of the write RPCs
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege('authenticated', 'public.create_study(text, integer, jsonb, timestamp, text)', 'execute')
  and has_function_privilege('authenticated', 'public.create_study(text, integer, text[], timestamp, text)', 'execute'),
  'authenticated can execute both create_study signatures'
);

select ok(
  has_function_privilege('authenticated', 'public.update_study_draft(uuid, text, integer, jsonb, timestamp, text)', 'execute')
  and has_function_privilege('authenticated', 'public.update_study_draft(uuid, text, integer, text[], timestamp, text)', 'execute'),
  'authenticated can execute both update_study_draft signatures'
);

set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

select throws_ok(
  $$ select public.create_study('Anon', 2,
       '[{"kind": "text", "content": "L"}, {"kind": "text", "content": "R"}]'::jsonb) $$,
  '42501',
  null,
  'anon: permission denied on create_study (jsonb)'
);

select throws_ok(
  $$ select public.update_study_draft('e1000000-0000-0000-0000-000000000001', 'Anon', 2,
       '[{"kind": "text", "content": "L"}, {"kind": "text", "content": "R"}]'::jsonb) $$,
  '42501',
  null,
  'anon: permission denied on update_study_draft (jsonb)'
);

select throws_ok(
  $$ select public.create_study('Anon', 2, array['L', 'R']) $$,
  '42501',
  null,
  'anon: permission denied on the create_study text[] wrapper'
);

select throws_ok(
  $$ select public.update_study_draft('e1000000-0000-0000-0000-000000000001', 'Anon', 2, array['L', 'R']) $$,
  '42501',
  null,
  'anon: permission denied on the update_study_draft text[] wrapper'
);

select is(
  (select count(*)::int from storage.objects where bucket_id = 'variant-images'),
  0,
  'anon: sees no variant-images objects'
);

reset role;

-- ---------------------------------------------------------------------------
-- create_study (jsonb) as author A
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '77777777-7777-7777-7777-777777777777', 'role', 'authenticated')::text,
  true
);

select is(
  (select count(*)::int from storage.objects where bucket_id = 'variant-images'),
  4,
  'A: sees exactly own 4 variant-images objects'
);

-- Named arguments, as PostgREST calls it.
select set_config(
  'test.mixed',
  public.create_study(
    p_title => 'Mixed',
    p_participant_target => 2,
    p_variant_items => '[{"kind": "text", "content": "Left", "image_path": null},
                         {"kind": "image", "content": " A cat ", "image_path": "aaaaaaaa-0000-4000-8000-000000000001.webp"}]'::jsonb
  )::text,
  true
);

select is(
  (select array_agg(position || '|' || kind || '|' || content || '|' || coalesce(image_path, '-') order by position)
     from public.variants where study_id = current_setting('test.mixed')::uuid),
  array['0|text|Left|-', '1|image|A cat|aaaaaaaa-0000-4000-8000-000000000001.webp'],
  'A: create_study stores a mixed text/image study (description trimmed)'
);

select throws_ok(
  $$ select public.create_study('B object', 2,
       '[{"kind": "text", "content": "L"},
         {"kind": "image", "content": "B''s", "image_path": "bbbbbbbb-0000-4000-8000-000000000001.webp"}]'::jsonb) $$,
  '23514',
  null,
  'A: create_study with B''s object raises 23514'
);

select throws_ok(
  $$ select public.create_study('Missing', 2,
       '[{"kind": "text", "content": "L"},
         {"kind": "image", "content": "Gone", "image_path": "cccccccc-0000-4000-8000-000000000001.webp"}]'::jsonb) $$,
  '23514',
  null,
  'A: create_study with a missing object raises 23514'
);

select throws_ok(
  $$ select public.create_study('Reused', 2,
       '[{"kind": "text", "content": "L"},
         {"kind": "image", "content": "Taken", "image_path": "aaaaaaaa-0000-4000-8000-000000000003.webp"}]'::jsonb) $$,
  '23514',
  null,
  'A: create_study with a path already used by another variant raises 23514 (not 23505)'
);

select throws_ok(
  $$ select public.create_study('Twice', 2,
       '[{"kind": "image", "content": "One", "image_path": "aaaaaaaa-0000-4000-8000-000000000002.jpg"},
         {"kind": "image", "content": "Two", "image_path": "aaaaaaaa-0000-4000-8000-000000000002.jpg"}]'::jsonb) $$,
  '23514',
  null,
  'A: create_study with the same path twice in the payload raises 23514'
);

select throws_ok(
  $$ select public.create_study('Text path', 2,
       '[{"kind": "text", "content": "L"},
         {"kind": "text", "content": "R", "image_path": "aaaaaaaa-0000-4000-8000-000000000002.jpg"}]'::jsonb) $$,
  '23514',
  null,
  'A: create_study with a text variant carrying a path raises 23514'
);

select throws_ok(
  $$ select public.create_study('No path', 2,
       '[{"kind": "text", "content": "L"}, {"kind": "image", "content": "Nothing"}]'::jsonb) $$,
  '23514',
  null,
  'A: create_study with an image variant without a path raises 23514'
);

select throws_ok(
  $$ select public.create_study('Bad kind', 2,
       '[{"kind": "text", "content": "L"}, {"kind": "video", "content": "R"}]'::jsonb) $$,
  '23514',
  null,
  'A: create_study with an unknown kind raises 23514'
);

select throws_ok(
  $$ select public.create_study('Long description', 2,
       jsonb_build_array(
         jsonb_build_object('kind', 'text', 'content', 'L'),
         jsonb_build_object('kind', 'image', 'content', repeat('d', 201),
                            'image_path', 'aaaaaaaa-0000-4000-8000-000000000002.jpg'))) $$,
  '23514',
  null,
  'A: create_study with a 201-character image description raises 23514'
);

select throws_ok(
  $$ select public.create_study('Bad path', 2,
       '[{"kind": "text", "content": "L"},
         {"kind": "image", "content": "R", "image_path": "aaaaaaaa-0000-4000-8000-000000000002.png"}]'::jsonb) $$,
  '23514',
  null,
  'A: create_study with a malformed path raises 23514'
);

select throws_ok(
  $$ select public.create_study('Not objects', 2, '["L", "R"]'::jsonb) $$,
  '23514',
  null,
  'A: create_study with non-object entries raises 23514'
);

-- The text[] wrapper still creates a text-only study.
select set_config('test.wrapped', public.create_study('Wrapped', 2, array[' L ', 'R'])::text, true);

select is(
  (select array_agg(position || '|' || kind || '|' || content || '|' || coalesce(image_path, '-') order by position)
     from public.variants where study_id = current_setting('test.wrapped')::uuid),
  array['0|text|L|-', '1|text|R|-'],
  'A: the create_study text[] wrapper stores text variants'
);

-- ---------------------------------------------------------------------------
-- update_study_draft (jsonb) as author A, on "A edit"
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.update_study_draft(
       p_study_id => 'e1000000-0000-0000-0000-000000000001',
       p_title => 'A edit',
       p_participant_target => 2,
       p_variant_items => '[{"kind": "image", "content": "Dog", "image_path": "aaaaaaaa-0000-4000-8000-000000000002.jpg"},
                            {"kind": "text", "content": "Text"}]'::jsonb) $$,
  'A: update_study_draft sets an image variant on own draft'
);

select lives_ok(
  $$ select public.update_study_draft('e1000000-0000-0000-0000-000000000001', 'A edit', 2,
       '[{"kind": "text", "content": "First"},
         {"kind": "image", "content": "Dog again", "image_path": "aaaaaaaa-0000-4000-8000-000000000002.jpg"}]'::jsonb) $$,
  'A: update_study_draft may keep an image the draft already uses'
);

select is(
  (select array_agg(position || '|' || kind || '|' || content || '|' || coalesce(image_path, '-') order by position)
     from public.variants where study_id = 'e1000000-0000-0000-0000-000000000001'),
  array['0|text|First|-', '1|image|Dog again|aaaaaaaa-0000-4000-8000-000000000002.jpg'],
  'A: the kept image moved to its new position'
);

select throws_ok(
  $$ select public.update_study_draft('e1000000-0000-0000-0000-000000000001', 'A edit', 2,
       '[{"kind": "text", "content": "L"},
         {"kind": "image", "content": "B''s", "image_path": "bbbbbbbb-0000-4000-8000-000000000001.webp"}]'::jsonb) $$,
  '23514',
  null,
  'A: update_study_draft with B''s object raises 23514'
);

select throws_ok(
  $$ select public.update_study_draft('e1000000-0000-0000-0000-000000000001', 'A edit', 2,
       '[{"kind": "text", "content": "L"},
         {"kind": "image", "content": "Gone", "image_path": "cccccccc-0000-4000-8000-000000000001.webp"}]'::jsonb) $$,
  '23514',
  null,
  'A: update_study_draft with a missing object raises 23514'
);

select throws_ok(
  $$ select public.update_study_draft('e1000000-0000-0000-0000-000000000001', 'A edit', 2,
       '[{"kind": "text", "content": "L"},
         {"kind": "image", "content": "Taken", "image_path": "aaaaaaaa-0000-4000-8000-000000000003.webp"}]'::jsonb) $$,
  '23514',
  null,
  'A: update_study_draft with a path used by another study raises 23514 (not 23505)'
);

select throws_ok(
  $$ select public.update_study_draft('e1000000-0000-0000-0000-000000000001', 'A edit', 2,
       '[{"kind": "image", "content": "One", "image_path": "aaaaaaaa-0000-4000-8000-000000000002.jpg"},
         {"kind": "image", "content": "Two", "image_path": "aaaaaaaa-0000-4000-8000-000000000002.jpg"}]'::jsonb) $$,
  '23514',
  null,
  'A: update_study_draft with the same path twice in the payload raises 23514'
);

select throws_ok(
  $$ select public.update_study_draft('e1000000-0000-0000-0000-000000000001', 'A edit', 2,
       '[{"kind": "text", "content": "L"},
         {"kind": "text", "content": "R", "image_path": "aaaaaaaa-0000-4000-8000-000000000002.jpg"}]'::jsonb) $$,
  '23514',
  null,
  'A: update_study_draft with a text variant carrying a path raises 23514'
);

select is(
  (select array_agg(position || '|' || kind || '|' || content || '|' || coalesce(image_path, '-') order by position)
     from public.variants where study_id = 'e1000000-0000-0000-0000-000000000001'),
  array['0|text|First|-', '1|image|Dog again|aaaaaaaa-0000-4000-8000-000000000002.jpg'],
  'A: refused updates left the draft''s variants unchanged'
);

reset role;

-- ---------------------------------------------------------------------------
-- Author B: A's objects are unusable, invisible and undeletable
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '88888888-8888-8888-8888-888888888888', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.create_study('B steals', 2,
       '[{"kind": "text", "content": "L"},
         {"kind": "image", "content": "A''s", "image_path": "aaaaaaaa-0000-4000-8000-000000000001.webp"}]'::jsonb) $$,
  '23514',
  null,
  'B: create_study with A''s object raises 23514'
);

select throws_ok(
  $$ select public.update_study_draft('e1000000-0000-0000-0000-000000000004', 'B draft', 2,
       '[{"kind": "text", "content": "L"},
         {"kind": "image", "content": "A''s", "image_path": "aaaaaaaa-0000-4000-8000-000000000002.jpg"}]'::jsonb) $$,
  '23514',
  null,
  'B: update_study_draft with A''s object raises 23514'
);

select lives_ok(
  $$ select public.update_study_draft('e1000000-0000-0000-0000-000000000004', 'B draft', 2,
       '[{"kind": "text", "content": "L"},
         {"kind": "image", "content": "Mine", "image_path": "bbbbbbbb-0000-4000-8000-000000000001.webp"}]'::jsonb) $$,
  'B: update_study_draft with B''s own object succeeds'
);

select is(
  (select count(*)::int from storage.objects
    where bucket_id = 'variant-images' and owner_id = '77777777-7777-7777-7777-777777777777'),
  0,
  'B: selects 0 of A''s variant-images objects'
);

select is(
  (select count(*)::int from storage.objects where bucket_id = 'variant-images'),
  1,
  'B: sees only own object'
);

-- Storage's protect_objects_delete trigger refuses any direct SQL delete;
-- lift it for this transaction so the delete policy itself is what is tested.
set local storage.allow_delete_query = 'true';

with deleted as (
  delete from storage.objects
   where bucket_id = 'variant-images'
     and owner_id = '77777777-7777-7777-7777-777777777777'
  returning 1
)
select is(count(*)::int, 0, 'B: delete of A''s objects affects 0 rows') from deleted;

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('variant-images', 'not-a-uuid.png', '88888888-8888-8888-8888-888888888888') $$,
  '42501',
  null,
  'B: insert with a name outside the <uuid>.webp|jpg pattern is refused'
);

reset role;

select is(
  (select count(*)::int from storage.objects
    where bucket_id = 'variant-images' and owner_id = '77777777-7777-7777-7777-777777777777'),
  4,
  'superuser: all of A''s objects survive B''s delete'
);

-- ---------------------------------------------------------------------------
-- Read paths: kind and image_path in the ballot and the results
-- ---------------------------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

select is(
  public.get_ballot('iv-token-1') -> 'variants',
  '[
     { "variant_id": "e2000000-0000-0000-0000-000000000005", "kind": "text", "content": "Plain", "image_path": null },
     { "variant_id": "e2000000-0000-0000-0000-000000000006", "kind": "image", "content": "Kitten",
       "image_path": "aaaaaaaa-0000-4000-8000-000000000004.webp" }
   ]'::jsonb,
  'anon: get_ballot returns kind and image_path per variant'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '77777777-7777-7777-7777-777777777777', 'role', 'authenticated')::text,
  true
);

select is(
  (select array_agg((v ->> 'kind') || '|' || coalesce(v ->> 'image_path', '-') order by (v ->> 'position')::int)
     from jsonb_array_elements(public.get_study_results('e1000000-0000-0000-0000-000000000003') -> 'variants') as v),
  array['text|-', 'image|aaaaaaaa-0000-4000-8000-000000000004.webp'],
  'A: get_study_results returns kind and image_path per variant'
);

-- The text[] wrapper still replaces a draft with text variants, freeing its image.
select lives_ok(
  $$ select public.update_study_draft('e1000000-0000-0000-0000-000000000001', 'A edit', 2, array['T1', 'T2']) $$,
  'A: the update_study_draft text[] wrapper replaces the draft'
);

select is(
  (select array_agg(position || '|' || kind || '|' || content || '|' || coalesce(image_path, '-') order by position)
     from public.variants where study_id = 'e1000000-0000-0000-0000-000000000001'),
  array['0|text|T1|-', '1|text|T2|-'],
  'A: the text[] wrapper stored text variants without an image'
);

reset role;

select * from finish();
rollback;
