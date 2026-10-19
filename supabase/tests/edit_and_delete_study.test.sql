-- edit-and-delete-study (S-06): update_study_draft and the delete guarantees.
-- update_study_draft replaces the caller's draft (title, N, deadline,
-- variants) atomically, only while draft, with create_study's validation.
-- Every refused call leaves the rows unchanged; that is re-checked as the
-- superuser. Deleting an active study leaves its tokens answering like an
-- unknown token. Fixtures are inserted as the test superuser; assertions run
-- as the real roles.
begin;
create extension if not exists pgtap with schema extensions;
select plan(59);

-- ---------------------------------------------------------------------------
-- Fixtures (uuid prefixes 5555/6666 users, f1 studies, f2 variants, f3 links)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('55555555-5555-5555-5555-555555555555', 'edit-author-a@example.com'),
  ('66666666-6666-6666-6666-666666666666', 'edit-author-b@example.com');

-- updated_at is set far in the past: now() is fixed inside the test
-- transaction, so only an old value can show the edit advancing it.
insert into public.studies (id, author_id, title, participant_target, status, closes_at, closes_tz, updated_at) values
  ('f1000000-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'A draft', 3, 'draft', null, null, '2000-01-01 00:00+00'),
  ('f1000000-0000-0000-0000-000000000002', '55555555-5555-5555-5555-555555555555', 'A active', 2, 'active', '2099-02-01 12:00+00', 'UTC', now()),
  ('f1000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555555', 'A closed', 4, 'closed', null, null, now()),
  ('f1000000-0000-0000-0000-000000000004', '55555555-5555-5555-5555-555555555555', 'A validate', 3, 'draft', '2099-03-01 12:00+00', 'UTC', now()),
  ('f1000000-0000-0000-0000-000000000005', '55555555-5555-5555-5555-555555555555', 'A to delete', 2, 'active', null, null, now());

insert into public.variants (id, study_id, position, content) values
  ('f2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 0, 'Draft left'),
  ('f2000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001', 1, 'Draft right'),
  ('f2000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000002', 0, 'Active left'),
  ('f2000000-0000-0000-0000-000000000004', 'f1000000-0000-0000-0000-000000000002', 1, 'Active right'),
  ('f2000000-0000-0000-0000-000000000005', 'f1000000-0000-0000-0000-000000000003', 0, 'Closed left'),
  ('f2000000-0000-0000-0000-000000000006', 'f1000000-0000-0000-0000-000000000003', 1, 'Closed right'),
  ('f2000000-0000-0000-0000-000000000007', 'f1000000-0000-0000-0000-000000000004', 0, 'Keep left'),
  ('f2000000-0000-0000-0000-000000000008', 'f1000000-0000-0000-0000-000000000004', 1, 'Keep right'),
  ('f2000000-0000-0000-0000-000000000009', 'f1000000-0000-0000-0000-000000000005', 0, 'Delete left'),
  ('f2000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000005', 1, 'Delete right');

insert into public.study_links (id, study_id, token) values
  ('f3000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002', 'ed-active-1'),
  ('f3000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000005', 'ed-del-1'),
  ('f3000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000005', 'ed-del-2');

-- ---------------------------------------------------------------------------
-- Isolation: author B on A's studies and on an unknown uuid
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '66666666-6666-6666-6666-666666666666', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.update_study_draft('f1000000-0000-0000-0000-000000000001', 'Hijacked', 9,
       '[{"kind": "text", "content": "X"}, {"kind": "text", "content": "Y"}]'::jsonb) $$,
  'P0002',
  null,
  'B: update_study_draft on A''s draft raises P0002'
);

select throws_ok(
  $$ select public.update_study_draft('f1000000-0000-0000-0000-000000000002', 'Hijacked', 9,
       '[{"kind": "text", "content": "X"}, {"kind": "text", "content": "Y"}]'::jsonb) $$,
  'P0002',
  null,
  'B: update_study_draft on A''s active study raises P0002'
);

select throws_ok(
  $$ select public.update_study_draft('f1000000-0000-0000-0000-000000000003', 'Hijacked', 9,
       '[{"kind": "text", "content": "X"}, {"kind": "text", "content": "Y"}]'::jsonb) $$,
  'P0002',
  null,
  'B: update_study_draft on A''s closed study raises P0002'
);

select throws_ok(
  $$ select public.update_study_draft('f1000000-0000-0000-0000-0000000000ff', 'Hijacked', 9,
       '[{"kind": "text", "content": "X"}, {"kind": "text", "content": "Y"}]'::jsonb) $$,
  'P0002',
  null,
  'B: update_study_draft on an unknown uuid raises P0002'
);

-- No auth.uid(): the role is authenticated, but the claims carry no sub.
select set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);

select throws_ok(
  $$ select public.update_study_draft('f1000000-0000-0000-0000-000000000001', 'No uid', 9,
       '[{"kind": "text", "content": "X"}, {"kind": "text", "content": "Y"}]'::jsonb) $$,
  'P0002',
  null,
  'no auth.uid(): update_study_draft raises P0002'
);

reset role;
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

select throws_ok(
  $$ select public.update_study_draft('f1000000-0000-0000-0000-000000000001', 'Anon', 9,
       '[{"kind": "text", "content": "X"}, {"kind": "text", "content": "Y"}]'::jsonb) $$,
  '42501',
  null,
  'anon: permission denied on update_study_draft'
);

reset role;

select is(
  (select array_agg(title || '|' || participant_target || '|' || status || '|' || coalesce(closes_tz, '-') order by id)
     from public.studies
    where author_id = '55555555-5555-5555-5555-555555555555'),
  array['A draft|3|draft|-', 'A active|2|active|UTC', 'A closed|4|closed|-',
        'A validate|3|draft|UTC', 'A to delete|2|active|-'],
  'B, no uid, anon: A''s studies unchanged'
);

select is(
  (select array_agg(id::text || '|' || position || '|' || content order by id)
     from public.variants
    where study_id in ('f1000000-0000-0000-0000-000000000001',
                       'f1000000-0000-0000-0000-000000000002',
                       'f1000000-0000-0000-0000-000000000003')),
  array['f2000000-0000-0000-0000-000000000001|0|Draft left',
        'f2000000-0000-0000-0000-000000000002|1|Draft right',
        'f2000000-0000-0000-0000-000000000003|0|Active left',
        'f2000000-0000-0000-0000-000000000004|1|Active right',
        'f2000000-0000-0000-0000-000000000005|0|Closed left',
        'f2000000-0000-0000-0000-000000000006|1|Closed right'],
  'B, no uid, anon: A''s variants unchanged (same rows, positions, contents)'
);

select ok(
  has_function_privilege('authenticated', 'public.update_study_draft(uuid, text, integer, jsonb, timestamp, text)', 'execute'),
  'authenticated can execute update_study_draft (jsonb)'
);

-- ---------------------------------------------------------------------------
-- Owner A edits a draft
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '55555555-5555-5555-5555-555555555555', 'role', 'authenticated')::text,
  true
);

select lives_ok(
  $$ select public.update_study_draft(
       'f1000000-0000-0000-0000-000000000001', '  New title  ', 7,
       '[{"kind": "text", "content": "  Third "}, {"kind": "text", "content": "First"},
         {"kind": "text", "content": " Second"}]'::jsonb) $$,
  'A: update_study_draft on own draft succeeds'
);

select is(
  (select title || '|' || participant_target || '|' || status
     from public.studies where id = 'f1000000-0000-0000-0000-000000000001'),
  'New title|7|draft',
  'A: title (trimmed) and N replaced, still draft'
);

select is(
  (select array_agg(position || '|' || content order by position)
     from public.variants where study_id = 'f1000000-0000-0000-0000-000000000001'),
  array['0|Third', '1|First', '2|Second'],
  'A: variants replaced in array order at positions 0..n-1, contents trimmed'
);

select is(
  (select count(*)::int from public.variants
    where id in ('f2000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000002')),
  0,
  'A: the old variant rows are gone'
);

select ok(
  (select updated_at > '2000-01-01 00:00+00'
     from public.studies where id = 'f1000000-0000-0000-0000-000000000001'),
  'A: updated_at advances'
);

select lives_ok(
  $$ select public.update_study_draft(
       'f1000000-0000-0000-0000-000000000001', 'New title', 7,
       '[{"kind": "text", "content": "V1"}, {"kind": "text", "content": "V2"},
         {"kind": "text", "content": "V3"}, {"kind": "text", "content": "V4"},
         {"kind": "text", "content": "V5"}, {"kind": "text", "content": "V6"}]'::jsonb) $$,
  'A: a draft can grow to 6 variants'
);

select is(
  (select array_agg(position || '|' || content order by position)
     from public.variants where study_id = 'f1000000-0000-0000-0000-000000000001'),
  array['0|V1', '1|V2', '2|V3', '3|V4', '4|V5', '5|V6'],
  'A: 6 variants at positions 0..5'
);

select lives_ok(
  $$ select public.update_study_draft(
       'f1000000-0000-0000-0000-000000000001', 'New title', 7,
       '[{"kind": "text", "content": "V6"}, {"kind": "text", "content": "V1"}]'::jsonb) $$,
  'A: a draft can shrink back to 2 variants'
);

select is(
  (select array_agg(position || '|' || content order by position)
     from public.variants where study_id = 'f1000000-0000-0000-0000-000000000001'),
  array['0|V6', '1|V1'],
  'A: 2 variants at positions 0..1'
);

-- Deadline: set, change, clear

select lives_ok(
  $$ select public.update_study_draft(
       'f1000000-0000-0000-0000-000000000001', 'New title', 7,
       '[{"kind": "text", "content": "V6"}, {"kind": "text", "content": "V1"}]'::jsonb,
       '2099-06-15 18:00', 'Europe/Warsaw') $$,
  'A: a deadline can be set on a draft'
);

select is(
  (select closes_at || '|' || closes_tz
     from public.studies where id = 'f1000000-0000-0000-0000-000000000001'),
  ('2099-06-15 16:00:00+00'::timestamptz)::text || '|Europe/Warsaw',
  'A: deadline stored as local time at time zone (18:00 Warsaw = 16:00 UTC)'
);

select lives_ok(
  $$ select public.update_study_draft(
       'f1000000-0000-0000-0000-000000000001', 'New title', 7,
       '[{"kind": "text", "content": "V6"}, {"kind": "text", "content": "V1"}]'::jsonb,
       '2099-01-10 09:30', 'America/New_York') $$,
  'A: the deadline can be changed'
);

select is(
  (select closes_at || '|' || closes_tz
     from public.studies where id = 'f1000000-0000-0000-0000-000000000001'),
  ('2099-01-10 14:30:00+00'::timestamptz)::text || '|America/New_York',
  'A: changed deadline stored in its new zone (09:30 New York = 14:30 UTC)'
);

select lives_ok(
  $$ select public.update_study_draft(
       'f1000000-0000-0000-0000-000000000001', 'New title', 7,
       '[{"kind": "text", "content": "V6"}, {"kind": "text", "content": "V1"}]'::jsonb,
       null, null) $$,
  'A: the deadline can be cleared (both null)'
);

select ok(
  (select closes_at is null and closes_tz is null
     from public.studies where id = 'f1000000-0000-0000-0000-000000000001'),
  'A: cleared deadline leaves closes_at and closes_tz null'
);

-- The jsonb signature (named arguments, as PostgREST calls it)

select lives_ok(
  $$ select public.update_study_draft(
       p_study_id => 'f1000000-0000-0000-0000-000000000001',
       p_title => 'Jsonb title',
       p_participant_target => 6,
       p_variant_items => '[{"kind": "text", "content": " J1 ", "image_path": null},
                            {"kind": "text", "content": "J2"},
                            {"kind": "text", "content": "J3"}]'::jsonb,
       p_closes_local => '2099-06-15 18:00',
       p_closes_tz => 'Europe/Warsaw') $$,
  'A: jsonb update_study_draft on own draft succeeds'
);

select is(
  (select array_agg(position || '|' || kind || '|' || content || '|' || coalesce(image_path, '-') order by position)
     from public.variants where study_id = 'f1000000-0000-0000-0000-000000000001'),
  array['0|text|J1|-', '1|text|J2|-', '2|text|J3|-'],
  'A: jsonb update replaced the variants with text variants in order, trimmed'
);

select is(
  (select title || '|' || participant_target || '|' || closes_at || '|' || closes_tz
     from public.studies where id = 'f1000000-0000-0000-0000-000000000001'),
  'Jsonb title|6|' || ('2099-06-15 16:00:00+00'::timestamptz)::text || '|Europe/Warsaw',
  'A: jsonb update replaced title, N and deadline'
);

-- ---------------------------------------------------------------------------
-- Draft-only: own active and closed studies
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.update_study_draft('f1000000-0000-0000-0000-000000000002', 'Edited', 9,
       '[{"kind": "text", "content": "X"}, {"kind": "text", "content": "Y"}]'::jsonb) $$,
  '55000',
  null,
  'A: update_study_draft on own active study raises 55000'
);

select throws_ok(
  $$ select public.update_study_draft('f1000000-0000-0000-0000-000000000003', 'Edited', 9,
       '[{"kind": "text", "content": "X"}, {"kind": "text", "content": "Y"}]'::jsonb) $$,
  '55000',
  null,
  'A: update_study_draft on own closed study raises 55000'
);

-- ---------------------------------------------------------------------------
-- Validation on own draft "A validate": each call raises, nothing changes
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.update_study_draft('f1000000-0000-0000-0000-000000000004', 'Edited', 5,
       '[{"kind": "text", "content": "Only"}]'::jsonb) $$,
  '22023',
  null,
  'validation: 1 variant raises 22023'
);

select throws_ok(
  $$ select public.update_study_draft('f1000000-0000-0000-0000-000000000004', 'Edited', 5,
       '[{"kind": "text", "content": "1"}, {"kind": "text", "content": "2"}, {"kind": "text", "content": "3"},
         {"kind": "text", "content": "4"}, {"kind": "text", "content": "5"}, {"kind": "text", "content": "6"},
         {"kind": "text", "content": "7"}]'::jsonb) $$,
  '22023',
  null,
  'validation: 7 variants raises 22023'
);

select throws_ok(
  $$ select public.update_study_draft('f1000000-0000-0000-0000-000000000004', 'Edited', 5,
       '[{"kind": "text", "content": "Left"}, {"kind": "text", "content": "   "}]'::jsonb) $$,
  '22023',
  null,
  'validation: a blank variant raises 22023'
);

select throws_ok(
  $$ select public.update_study_draft('f1000000-0000-0000-0000-000000000004', 'Edited', 5,
       '[{"kind": "text", "content": "Left"}, {"kind": "text", "content": "Right"}]'::jsonb,
       '2099-06-15 18:00', null) $$,
  '22023',
  null,
  'validation: deadline local time without a zone raises 22023'
);

select throws_ok(
  $$ select public.update_study_draft('f1000000-0000-0000-0000-000000000004', 'Edited', 5,
       '[{"kind": "text", "content": "Left"}, {"kind": "text", "content": "Right"}]'::jsonb,
       null, 'Europe/Warsaw') $$,
  '22023',
  null,
  'validation: deadline zone without a local time raises 22023'
);

select throws_ok(
  $$ select public.update_study_draft('f1000000-0000-0000-0000-000000000004', 'Edited', 5,
       '[{"kind": "text", "content": "Left"}, {"kind": "text", "content": "Right"}]'::jsonb,
       '2099-06-15 18:00', 'Mars/Olympus_Mons') $$,
  '22023',
  null,
  'validation: unknown time zone raises 22023'
);

select throws_ok(
  $$ select public.update_study_draft('f1000000-0000-0000-0000-000000000004', 'Edited', 5,
       '[{"kind": "text", "content": "Left"}, {"kind": "text", "content": "Right"}]'::jsonb,
       '2099-06-15 18:00', 'posix/Europe/Warsaw') $$,
  '22023',
  null,
  'validation: a posix/ zone (Intl cannot format it) raises 22023'
);

select throws_ok(
  $$ select public.update_study_draft('f1000000-0000-0000-0000-000000000004', 'Edited', 5,
       '[{"kind": "text", "content": "Left"}, {"kind": "text", "content": "Right"}]'::jsonb,
       '2000-01-01 12:00', 'Europe/Warsaw') $$,
  '22023',
  null,
  'validation: a deadline in the past raises 22023'
);

select throws_ok(
  $$ select public.update_study_draft('f1000000-0000-0000-0000-000000000004', 'Edited', 0,
       '[{"kind": "text", "content": "Left"}, {"kind": "text", "content": "Right"}]'::jsonb) $$,
  '23514',
  null,
  'validation: N = 0 raises 23514'
);

select throws_ok(
  $$ select public.update_study_draft('f1000000-0000-0000-0000-000000000004', 'Edited', 101,
       '[{"kind": "text", "content": "Left"}, {"kind": "text", "content": "Right"}]'::jsonb) $$,
  '23514',
  null,
  'validation: N = 101 raises 23514'
);

select throws_ok(
  $$ select public.update_study_draft('f1000000-0000-0000-0000-000000000004', '   ', 5,
       '[{"kind": "text", "content": "Left"}, {"kind": "text", "content": "Right"}]'::jsonb) $$,
  '23514',
  null,
  'validation: a blank title raises 23514'
);

select throws_ok(
  $$ select public.update_study_draft('f1000000-0000-0000-0000-000000000004', repeat('t', 201), 5,
       '[{"kind": "text", "content": "Left"}, {"kind": "text", "content": "Right"}]'::jsonb) $$,
  '23514',
  null,
  'validation: a 201-character title raises 23514'
);

select throws_ok(
  $$ select public.update_study_draft('f1000000-0000-0000-0000-000000000004', 'Edited', 5,
       jsonb_build_array(jsonb_build_object('kind', 'text', 'content', 'Left'),
                         jsonb_build_object('kind', 'text', 'content', repeat('v', 2001)))) $$,
  '23514',
  null,
  'validation: a 2001-character variant raises 23514'
);

select throws_ok(
  $$ select public.update_study_draft('f1000000-0000-0000-0000-000000000004', 'Edited', 5,
       '[{"kind": "text", "content": "Only"}]'::jsonb) $$,
  '22023',
  null,
  'validation (jsonb): 1 variant raises 22023'
);

select throws_ok(
  $$ select public.update_study_draft('f1000000-0000-0000-0000-000000000004', 'Edited', 5,
       '[{"kind": "text", "content": "Left"}, {"kind": "text", "content": " "}]'::jsonb) $$,
  '22023',
  null,
  'validation (jsonb): a blank variant raises 22023'
);

reset role;

-- ---------------------------------------------------------------------------
-- As the superuser: refused edits changed nothing
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(title || '|' || participant_target || '|' || status || '|'
                    || coalesce(closes_at::text, '-') || '|' || coalesce(closes_tz, '-') order by id)
     from public.studies
    where id in ('f1000000-0000-0000-0000-000000000002',
                 'f1000000-0000-0000-0000-000000000003',
                 'f1000000-0000-0000-0000-000000000004')),
  array['A active|2|active|' || ('2099-02-01 12:00+00'::timestamptz)::text || '|UTC',
        'A closed|4|closed|-|-',
        'A validate|3|draft|' || ('2099-03-01 12:00+00'::timestamptz)::text || '|UTC'],
  'draft-only and validation: title, N, status and deadline unchanged'
);

select is(
  (select array_agg(id::text || '|' || position || '|' || content order by id)
     from public.variants
    where study_id in ('f1000000-0000-0000-0000-000000000002',
                       'f1000000-0000-0000-0000-000000000003',
                       'f1000000-0000-0000-0000-000000000004')),
  array['f2000000-0000-0000-0000-000000000003|0|Active left',
        'f2000000-0000-0000-0000-000000000004|1|Active right',
        'f2000000-0000-0000-0000-000000000005|0|Closed left',
        'f2000000-0000-0000-0000-000000000006|1|Closed right',
        'f2000000-0000-0000-0000-000000000007|0|Keep left',
        'f2000000-0000-0000-0000-000000000008|1|Keep right'],
  'draft-only and validation: variants unchanged (same rows, positions, contents)'
);

select is(
  (select count(*)::int from public.study_links where study_id = 'f1000000-0000-0000-0000-000000000002'),
  1,
  'draft-only: the active study keeps its links'
);

-- ---------------------------------------------------------------------------
-- Delete of an own active study with a cast vote
-- ---------------------------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

select is(
  public.cast_vote(
    'ed-del-1',
    'f2000000-0000-0000-0000-000000000009',
    '[{"variant_id": "f2000000-0000-0000-0000-00000000000a", "body": "Too busy"}]'::jsonb
  ),
  'accepted',
  'delete fixture: a vote with a comment is cast on the active study'
);

select isnt(
  public.get_ballot('ed-del-2'),
  null::jsonb,
  'delete fixture: the unused link still shows the ballot'
);

reset role;

-- B deletes A's studies: zero rows affected
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '66666666-6666-6666-6666-666666666666', 'role', 'authenticated')::text,
  true
);

select lives_ok(
  $$ delete from public.studies
      where id in ('f1000000-0000-0000-0000-000000000001',
                   'f1000000-0000-0000-0000-000000000005') $$,
  'B: delete of A''s studies runs without error'
);

reset role;

select is(
  (select count(*)::int from public.studies
    where id in ('f1000000-0000-0000-0000-000000000001',
                 'f1000000-0000-0000-0000-000000000005')),
  2,
  'B: delete of A''s studies affected zero rows (both still exist)'
);

select is(
  array[
    (select count(*)::int from public.study_links where study_id = 'f1000000-0000-0000-0000-000000000005'),
    (select count(*)::int from public.votes where study_id = 'f1000000-0000-0000-0000-000000000005'),
    (select count(*)::int from public.comments where study_id = 'f1000000-0000-0000-0000-000000000005')
  ],
  array[2, 1, 1],
  'B: A''s links, vote and comment survive B''s delete'
);

-- A deletes the own active study
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '55555555-5555-5555-5555-555555555555', 'role', 'authenticated')::text,
  true
);

select is(
  (select count(*)::int from public.studies where id = 'f1000000-0000-0000-0000-000000000005'),
  1,
  'A: sees own active study before deleting it'
);

select lives_ok(
  $$ delete from public.studies where id = 'f1000000-0000-0000-0000-000000000005' $$,
  'A: delete of own active study succeeds'
);

reset role;
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

select is(
  public.get_ballot('ed-del-1'),
  null::jsonb,
  'after delete: get_ballot on the used token returns null'
);

select is(
  public.get_ballot('ed-del-2'),
  null::jsonb,
  'after delete: get_ballot on the unused token returns null'
);

select is(
  public.cast_vote('ed-del-2', 'f2000000-0000-0000-0000-000000000009'),
  'study_ended',
  'after delete: cast_vote on its token returns study_ended'
);

reset role;

select is(
  (select count(*)::int from public.studies where id = 'f1000000-0000-0000-0000-000000000005'),
  0,
  'after delete: the study row is gone'
);

select is(
  array[
    (select count(*)::int from public.study_links where study_id = 'f1000000-0000-0000-0000-000000000005'),
    (select count(*)::int from public.variants where study_id = 'f1000000-0000-0000-0000-000000000005'),
    (select count(*)::int from public.votes where study_id = 'f1000000-0000-0000-0000-000000000005'),
    (select count(*)::int from public.comments where study_id = 'f1000000-0000-0000-0000-000000000005')
  ],
  array[0, 0, 0, 0],
  'after delete: no links, variants, votes or comments remain for it'
);

select * from finish();
rollback;
