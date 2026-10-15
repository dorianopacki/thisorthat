-- study-closing-rules: a vote in flight cannot slip past a close.
-- Unlike the other suites this one needs committed data: every actor is a
-- separate dblink session, and those sessions cannot see this test's
-- uncommitted transaction. conn_seed commits the fixtures and deletes them
-- (first, in case an earlier run failed, and again at the end); conn_close
-- holds close_study open; conn_vote sends cast_vote asynchronously and must
-- wait on the study row lock, then see the study closed.
-- dblink connects to the server address of this connection: over 127.0.0.1
-- the server trusts without a password, which dblink refuses for non-superusers.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(7);

select isnt(inet_server_addr(), null, 'the test runner is connected over TCP (dblink needs the server address)');

select set_config(
  'test.conninfo',
  'host=' || host(inet_server_addr()) || ' port=5432 dbname=postgres user=postgres password=postgres',
  true
);

select extensions.dblink_connect('conn_seed', current_setting('test.conninfo'));
select extensions.dblink_connect('conn_close', current_setting('test.conninfo'));
select extensions.dblink_connect('conn_vote', current_setting('test.conninfo'));

-- ---------------------------------------------------------------------------
-- Committed fixtures (prefix c9: author, study, variant; tokens race-*)
-- ---------------------------------------------------------------------------

select extensions.dblink_exec('conn_seed', $$
  delete from auth.users where id = 'c9000000-0000-0000-0000-000000000001';
$$);

select extensions.dblink_exec('conn_seed', $$
  insert into auth.users (id, email) values
    ('c9000000-0000-0000-0000-000000000001', 'race-author@example.com');
  insert into public.studies (id, author_id, title, participant_target, status) values
    ('c9000000-0000-0000-0000-0000000000a1', 'c9000000-0000-0000-0000-000000000001', 'Race', 3, 'active');
  insert into public.variants (id, study_id, position, content) values
    ('c9000000-0000-0000-0000-0000000000b1', 'c9000000-0000-0000-0000-0000000000a1', 0, 'Left'),
    ('c9000000-0000-0000-0000-0000000000b2', 'c9000000-0000-0000-0000-0000000000a1', 1, 'Right');
  insert into public.study_links (study_id, token) values
    ('c9000000-0000-0000-0000-0000000000a1', 'race-1'),
    ('c9000000-0000-0000-0000-0000000000a1', 'race-2'),
    ('c9000000-0000-0000-0000-0000000000a1', 'race-3');
$$);

-- ---------------------------------------------------------------------------
-- conn_close: the author closes the study and keeps the transaction open
-- ---------------------------------------------------------------------------

select extensions.dblink_exec('conn_close', $$
  begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"c9000000-0000-0000-0000-000000000001","role":"authenticated"}';
$$);

select * from extensions.dblink('conn_close', $$
  select public.close_study('c9000000-0000-0000-0000-0000000000a1')::text
$$) as t (r text);

-- ---------------------------------------------------------------------------
-- conn_vote: a participant votes while the close is still uncommitted
-- ---------------------------------------------------------------------------

select set_config(
  'test.vote_pid',
  (select pid::text from extensions.dblink('conn_vote', 'select pg_backend_pid()') as t (pid int)),
  true
);

select extensions.dblink_exec('conn_vote', 'set role anon');
select extensions.dblink_send_query('conn_vote', $$
  select public.cast_vote('race-1', 'c9000000-0000-0000-0000-0000000000b1')
$$);

-- Wait (up to ~5 s) until the vote is either done or waiting on a lock.
do $$
begin
  for i in 1..50 loop
    exit when exists (
      select 1 from pg_catalog.pg_stat_activity a
       where a.pid = current_setting('test.vote_pid')::int
         and (a.wait_event_type = 'Lock' or a.state = 'idle')
    );
    perform pg_catalog.pg_sleep(0.1);
  end loop;
end
$$;

select is(
  (select a.wait_event_type from pg_catalog.pg_stat_activity a
    where a.pid = current_setting('test.vote_pid')::int),
  'Lock',
  'the vote waits on the study row lock held by the close'
);

select is(extensions.dblink_is_busy('conn_vote'), 1, 'the vote has not finished while the close is open');

select extensions.dblink_exec('conn_close', 'commit');

select is(
  (select r from extensions.dblink_get_result('conn_vote') as t (r text)),
  'study_ended',
  'after the close commits, the waiting vote returns study_ended'
);

-- Drain the async result set so the connection can be reused.
select * from extensions.dblink_get_result('conn_vote') as t (r text);

-- ---------------------------------------------------------------------------
-- Recorded state (read through conn_seed: committed data only)
-- ---------------------------------------------------------------------------

select is(
  (select n from extensions.dblink('conn_seed', $$
     select count(*)::int from public.votes where study_id = 'c9000000-0000-0000-0000-0000000000a1'
   $$) as t (n int)),
  0,
  'no vote was recorded'
);

select is(
  (select u from extensions.dblink('conn_seed', $$
     select used from public.study_links where token = 'race-1'
   $$) as t (u boolean)),
  false,
  'the link stayed unused'
);

select is(
  (select s from extensions.dblink('conn_seed', $$
     select status::text from public.studies where id = 'c9000000-0000-0000-0000-0000000000a1'
   $$) as t (s text)),
  'closed',
  'the study is closed'
);

-- ---------------------------------------------------------------------------
-- Cleanup (cascade from the author removes the study, links, variants, votes)
-- ---------------------------------------------------------------------------

select extensions.dblink_exec('conn_seed', $$
  delete from auth.users where id = 'c9000000-0000-0000-0000-000000000001';
$$);

select extensions.dblink_disconnect('conn_vote');
select extensions.dblink_disconnect('conn_close');
select extensions.dblink_disconnect('conn_seed');

select * from finish();
rollback;
