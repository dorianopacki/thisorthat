-- generate-extra-links: adding links and the last-link vote never end with a
-- closed study that still has unused links. Both writers lock the study row,
-- so one waits for the other:
--   * vote first: the vote on the last link closes the study; the waiting
--     add then sees it closed and raises 55000 (no links added);
--   * add first: the waiting vote then sees unused links, is accepted and
--     does not close the study.
-- Like study_closing_race.test.sql this needs committed data: every actor is
-- a separate dblink session. conn_seed commits the fixtures and deletes them
-- (first, in case an earlier run failed, and again at the end).
-- dblink connects to the server address of this connection: over 127.0.0.1
-- the server trusts without a password, which dblink refuses for non-superusers.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(15);

select isnt(inet_server_addr(), null, 'the test runner is connected over TCP (dblink needs the server address)');

select set_config(
  'test.conninfo',
  'host=' || host(inet_server_addr()) || ' port=' || inet_server_port() || ' dbname=postgres user=postgres password=postgres',
  true
);

select extensions.dblink_connect('conn_seed', current_setting('test.conninfo'));
select extensions.dblink_connect('conn_add', current_setting('test.conninfo'));
select extensions.dblink_connect('conn_vote', current_setting('test.conninfo'));

-- ---------------------------------------------------------------------------
-- Committed fixtures (prefix c8: author, studies, variants; tokens xrace-*)
--   c8..a1: vote-first scenario, one unused link left (N = 1)
--   c8..a2: add-first scenario, one unused link left (N = 1)
-- ---------------------------------------------------------------------------

select extensions.dblink_exec('conn_seed', $$
  delete from auth.users where id = 'c8000000-0000-0000-0000-000000000001';
$$);

select extensions.dblink_exec('conn_seed', $$
  insert into auth.users (id, email) values
    ('c8000000-0000-0000-0000-000000000001', 'xrace-author@example.com');
  insert into public.studies (id, author_id, title, participant_target, status) values
    ('c8000000-0000-0000-0000-0000000000a1', 'c8000000-0000-0000-0000-000000000001', 'Vote first', 1, 'active'),
    ('c8000000-0000-0000-0000-0000000000a2', 'c8000000-0000-0000-0000-000000000001', 'Add first', 1, 'active');
  insert into public.variants (id, study_id, position, content) values
    ('c8000000-0000-0000-0000-0000000000b1', 'c8000000-0000-0000-0000-0000000000a1', 0, 'Left'),
    ('c8000000-0000-0000-0000-0000000000b2', 'c8000000-0000-0000-0000-0000000000a1', 1, 'Right'),
    ('c8000000-0000-0000-0000-0000000000b3', 'c8000000-0000-0000-0000-0000000000a2', 0, 'Left'),
    ('c8000000-0000-0000-0000-0000000000b4', 'c8000000-0000-0000-0000-0000000000a2', 1, 'Right');
  insert into public.study_links (study_id, token) values
    ('c8000000-0000-0000-0000-0000000000a1', 'xrace-1'),
    ('c8000000-0000-0000-0000-0000000000a2', 'xrace-2');
$$);

-- conn_add reports the SQLSTATE of add_study_links instead of failing, so a
-- refused add can be asserted after it stopped waiting.
select extensions.dblink_exec('conn_add', $$
  create function pg_temp.try_add(p_study_id uuid, p_count integer)
  returns text
  language plpgsql
  as $f$
  begin
    perform public.add_study_links(p_study_id, p_count);
    return 'ok';
  exception when others then
    return sqlstate;
  end;
  $f$;
$$);

-- A regression that never releases the study lock must fail this suite, not hang CI.
select extensions.dblink_exec('conn_add', $$set lock_timeout = '10s'$$);
select extensions.dblink_exec('conn_vote', $$set lock_timeout = '10s'$$);

select set_config(
  'test.add_pid',
  (select pid::text from extensions.dblink('conn_add', 'select pg_backend_pid()') as t (pid int)),
  true
);
select set_config(
  'test.vote_pid',
  (select pid::text from extensions.dblink('conn_vote', 'select pg_backend_pid()') as t (pid int)),
  true
);

-- ---------------------------------------------------------------------------
-- Scenario 1 (vote first): the last-link vote is uncommitted while the add
-- arrives
-- ---------------------------------------------------------------------------

select extensions.dblink_exec('conn_vote', $$
  begin;
  set local role anon;
$$);

select is(
  (select r from extensions.dblink('conn_vote', $$
     select public.cast_vote('xrace-1', 'c8000000-0000-0000-0000-0000000000b1')
   $$) as t (r text)),
  'accepted',
  'vote first: the last-link vote is accepted (still uncommitted)'
);

select extensions.dblink_exec('conn_add', $$
  begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"c8000000-0000-0000-0000-000000000001","role":"authenticated"}';
$$);

select extensions.dblink_send_query('conn_add', $$
  select pg_temp.try_add('c8000000-0000-0000-0000-0000000000a1', 2)
$$);

do $$
begin
  for i in 1..50 loop
    exit when exists (
      select 1 from pg_catalog.pg_stat_activity a
       where a.pid = current_setting('test.add_pid')::int
         and (a.wait_event_type = 'Lock' or a.state like 'idle%')
    );
    perform pg_catalog.pg_sleep(0.1);
  end loop;
end
$$;

select is(
  (select a.wait_event_type from pg_catalog.pg_stat_activity a
    where a.pid = current_setting('test.add_pid')::int),
  'Lock',
  'vote first: the add waits on the study row lock held by the vote'
);

select extensions.dblink_exec('conn_vote', 'commit');

select is(
  (select r from extensions.dblink_get_result('conn_add') as t (r text)),
  '55000',
  'vote first: after the vote commits, the waiting add raises 55000'
);

-- Drain the async result set so the connection can be reused.
select * from extensions.dblink_get_result('conn_add') as t (r text);
select extensions.dblink_exec('conn_add', 'commit');

select is(
  (select s from extensions.dblink('conn_seed', $$
     select status::text from public.studies where id = 'c8000000-0000-0000-0000-0000000000a1'
   $$) as t (s text)),
  'closed',
  'vote first: the study is closed'
);

select is(
  (select n from extensions.dblink('conn_seed', $$
     select count(*)::int from public.study_links where study_id = 'c8000000-0000-0000-0000-0000000000a1'
   $$) as t (n int)),
  1,
  'vote first: no links were added'
);

select is(
  (select n from extensions.dblink('conn_seed', $$
     select participant_target from public.studies where id = 'c8000000-0000-0000-0000-0000000000a1'
   $$) as t (n int)),
  1,
  'vote first: N is unchanged'
);

-- ---------------------------------------------------------------------------
-- Scenario 2 (add first): the add is uncommitted while the last-link vote
-- arrives
-- ---------------------------------------------------------------------------

select extensions.dblink_exec('conn_add', $$
  begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"c8000000-0000-0000-0000-000000000001","role":"authenticated"}';
$$);

select is(
  (select r from extensions.dblink('conn_add', $$
     select pg_temp.try_add('c8000000-0000-0000-0000-0000000000a2', 2)
   $$) as t (r text)),
  'ok',
  'add first: the add succeeds (still uncommitted)'
);

select extensions.dblink_exec('conn_vote', 'set role anon');
select extensions.dblink_send_query('conn_vote', $$
  select public.cast_vote('xrace-2', 'c8000000-0000-0000-0000-0000000000b3')
$$);

do $$
begin
  for i in 1..50 loop
    exit when exists (
      select 1 from pg_catalog.pg_stat_activity a
       where a.pid = current_setting('test.vote_pid')::int
         and (a.wait_event_type = 'Lock' or a.state like 'idle%')
    );
    perform pg_catalog.pg_sleep(0.1);
  end loop;
end
$$;

select is(
  (select a.wait_event_type from pg_catalog.pg_stat_activity a
    where a.pid = current_setting('test.vote_pid')::int),
  'Lock',
  'add first: the vote waits on the study row lock held by the add'
);

select extensions.dblink_exec('conn_add', 'commit');

select is(
  (select r from extensions.dblink_get_result('conn_vote') as t (r text)),
  'accepted',
  'add first: after the add commits, the waiting vote is accepted'
);

select * from extensions.dblink_get_result('conn_vote') as t (r text);
select extensions.dblink_exec('conn_vote', 'reset role');

select is(
  (select s from extensions.dblink('conn_seed', $$
     select status::text from public.studies where id = 'c8000000-0000-0000-0000-0000000000a2'
   $$) as t (s text)),
  'active',
  'add first: the vote did not close the study (unused links remain)'
);

select is(
  (select n from extensions.dblink('conn_seed', $$
     select count(*)::int from public.study_links
      where study_id = 'c8000000-0000-0000-0000-0000000000a2' and not used
   $$) as t (n int)),
  2,
  'add first: the two added links are unused'
);

select is(
  (select n from extensions.dblink('conn_seed', $$
     select participant_target from public.studies where id = 'c8000000-0000-0000-0000-0000000000a2'
   $$) as t (n int)),
  3,
  'add first: N is 3'
);

-- ---------------------------------------------------------------------------
-- The invariant across both orders
-- ---------------------------------------------------------------------------

select is(
  (select n from extensions.dblink('conn_seed', $$
     select count(*)::int from public.studies s
      where s.author_id = 'c8000000-0000-0000-0000-000000000001'
        and s.status = 'closed'
        and exists (select 1 from public.study_links l where l.study_id = s.id and not l.used)
   $$) as t (n int)),
  0,
  'no closed study has unused links'
);

select is(
  (select n from extensions.dblink('conn_seed', $$
     select count(*)::int from public.studies s
      where s.author_id = 'c8000000-0000-0000-0000-000000000001'
        and s.status = 'active'
        and not exists (select 1 from public.study_links l where l.study_id = s.id and not l.used)
   $$) as t (n int)),
  0,
  'no active study is left without unused links'
);

-- ---------------------------------------------------------------------------
-- Cleanup (cascade from the author removes the studies, links, variants, votes)
-- ---------------------------------------------------------------------------

select extensions.dblink_exec('conn_seed', $$
  delete from auth.users where id = 'c8000000-0000-0000-0000-000000000001';
$$);

select extensions.dblink_disconnect('conn_vote');
select extensions.dblink_disconnect('conn_add');
select extensions.dblink_disconnect('conn_seed');

select * from finish();
rollback;
