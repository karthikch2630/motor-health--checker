-- hosted_smoke.sql — post-migration verification for a Supabase project.   READ THIS FIRST:
--
--  * Run it in the Supabase SQL Editor AFTER applying migrations 001-012 and creating your user.
--  * Replace PUT-YOUR-USER-UUID-HERE (one place, below) with your user's id (Authentication -> Users -> copy "User UID").
--  * It runs inside a transaction that ends with ROLLBACK, so nothing it creates persists. It creates NO reference data.
--  * The result of the final SELECT is the report: every row must show passed = true.
--  * If the editor reports an error part-way, run   rollback;   before anything else. If the editor does not allow
--    transaction control (begin/rollback), do not run this file; use the browser checks in docs/DEPLOYMENT.md instead.
--  * It checks ONLY what is listed below. It does not replace the browser smoke test.
--
-- Tested on a local PostgreSQL engine (PGlite) with stand-ins for Supabase's roles; it has NOT been run on hosted Supabase.

begin;

create temp table qa_results (n serial primary key, check_name text not null, passed boolean not null, detail text);
grant all on qa_results to public;
grant usage, select on sequence qa_results_n_seq to public;

select set_config('qa.uid', 'PUT-YOUR-USER-UUID-HERE', true);

-- Test rows are created as the table owner (bypasses RLS) with explicit ownership, and are rolled back at the end.
insert into public.motors (id, owner_id, motor_tag, name, motor_type)
values ('aaaaaaaa-0000-0000-0000-000000000001', current_setting('qa.uid')::uuid, 'SMOKE-ROLLBACK', 'smoke', 'smoke');
insert into public.test_sessions (id, owner_id, motor_id)
values ('bbbbbbbb-0000-0000-0000-000000000001', current_setting('qa.uid')::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'),  -- D: stays draft, no readings
       ('bbbbbbbb-0000-0000-0000-000000000002', current_setting('qa.uid')::uuid, 'aaaaaaaa-0000-0000-0000-000000000001');  -- S: will be submitted
insert into public.test_readings (owner_id, test_session_id, parameter_code, measured_value, measured_unit, normalized_value, normalized_unit)
values (current_setting('qa.uid')::uuid, 'bbbbbbbb-0000-0000-0000-000000000002', 'voltage', 1, 'V', 1, 'V');
update public.test_sessions set status = 'submitted' where id = 'bbbbbbbb-0000-0000-0000-000000000002';

-- Runs one statement as the given API role and records whether it was rejected.
create function pg_temp.try_as(label text, role_name text, stmt text, expect_rejected boolean) returns void
language plpgsql as $f$
declare
  rejected boolean := false;
  msg text := '';
begin
  execute format('set local role %I', role_name);
  perform set_config('request.jwt.claim.sub', case when role_name = 'authenticated' then current_setting('qa.uid') else '' end, true);
  perform set_config('request.jwt.claims',
    case when role_name = 'authenticated'
         then json_build_object('sub', current_setting('qa.uid'), 'role', 'authenticated')::text else '' end, true);
  begin
    execute stmt;
  exception when others then
    rejected := true;
    msg := sqlerrm;
  end;
  reset role;
  insert into qa_results (check_name, passed, detail)
  values (label, rejected = expect_rejected, case when rejected then 'rejected: ' || left(msg, 90) else 'accepted' end);
end
$f$;

-- ---- anonymous access
select pg_temp.try_as('anon cannot read motors', 'anon', 'select * from public.motors', true);
select pg_temp.try_as('anon cannot read assessments', 'anon', 'select * from public.diagnostic_results', true);
select pg_temp.try_as('anon cannot run the assessment function', 'anon',
  $$select public.save_diagnostic_assessment('bbbbbbbb-0000-0000-0000-000000000002'::uuid, null, null, 'x', 'INSUFFICIENT_DATA', 's', '[]'::jsonb)$$, true);

-- ---- signed-in user: allowed and refused actions
select pg_temp.try_as('signed-in user can read the parameter catalog', 'authenticated', 'select * from public.parameter_definitions', false);
select pg_temp.try_as('signed-in user cannot change the parameter catalog', 'authenticated',
  $$insert into public.parameter_definitions (code, display_name, canonical_unit) values ('smoke', 'x', 'x')$$, true);
select pg_temp.try_as('cannot create a motor owned by someone else', 'authenticated',
  $$insert into public.motors (owner_id, motor_tag, name, motor_type) values (gen_random_uuid(), 'x', 'x', 'x')$$, true);
select pg_temp.try_as('cannot create a session that is not a draft', 'authenticated',
  $$insert into public.test_sessions (motor_id, status) values ('aaaaaaaa-0000-0000-0000-000000000001', 'submitted')$$, true);
select pg_temp.try_as('cannot submit a draft that has no readings', 'authenticated',
  $$update public.test_sessions set status = 'submitted' where id = 'bbbbbbbb-0000-0000-0000-000000000001'$$, true);

-- ---- immutability of a submitted test (session S)
select pg_temp.try_as('submitted test: cannot edit the session', 'authenticated',
  $$update public.test_sessions set notes = 'tamper' where id = 'bbbbbbbb-0000-0000-0000-000000000002'$$, true);
select pg_temp.try_as('submitted test: cannot revert to draft', 'authenticated',
  $$update public.test_sessions set status = 'draft' where id = 'bbbbbbbb-0000-0000-0000-000000000002'$$, true);
select pg_temp.try_as('submitted test: cannot add a reading', 'authenticated',
  $$insert into public.test_readings (test_session_id, parameter_code, measured_value, measured_unit) values ('bbbbbbbb-0000-0000-0000-000000000002', 'current', 1, 'A')$$, true);
select pg_temp.try_as('submitted test: cannot change a reading', 'authenticated',
  $$update public.test_readings set measured_value = 99 where test_session_id = 'bbbbbbbb-0000-0000-0000-000000000002'$$, true);
select pg_temp.try_as('submitted test: cannot delete a reading', 'authenticated',
  $$delete from public.test_readings where test_session_id = 'bbbbbbbb-0000-0000-0000-000000000002'$$, true);

-- ---- assessment persistence
select pg_temp.try_as('a draft cannot be assessed', 'authenticated',
  $$select public.save_diagnostic_assessment('bbbbbbbb-0000-0000-0000-000000000001'::uuid, null, null, 'smoke', 'INSUFFICIENT_DATA', 's', '[]'::jsonb)$$, true);
select pg_temp.try_as('a bad finding rolls back the whole assessment', 'authenticated',
  $$select public.save_diagnostic_assessment('bbbbbbbb-0000-0000-0000-000000000002'::uuid, null, null, 'smoke', 'INSUFFICIENT_DATA', 's',
      '[{"rule_code":"X","severity":"BOGUS","finding_description":"x"}]'::jsonb)$$, true);
select pg_temp.try_as('submitted test can be assessed through the function', 'authenticated',
  $$select public.save_diagnostic_assessment('bbbbbbbb-0000-0000-0000-000000000002'::uuid, null, null, 'smoke', 'INSUFFICIENT_DATA', 's',
      '[{"rule_code":"PROFILE_NOT_AVAILABLE","severity":"INFO","finding_description":"smoke test"}]'::jsonb)$$, false);
insert into qa_results (check_name, passed, detail)
select 'the failed attempt left no partial data (exactly 1 result, 1 finding)',
       (select count(*) from public.diagnostic_results where test_session_id = 'bbbbbbbb-0000-0000-0000-000000000002') = 1
       and (select count(*) from public.diagnostic_findings f join public.diagnostic_results r on r.id = f.diagnostic_result_id
             where r.test_session_id = 'bbbbbbbb-0000-0000-0000-000000000002') = 1,
       null;
select pg_temp.try_as('assessment results cannot be edited', 'authenticated',
  $$update public.diagnostic_results set overall_status = 'NORMAL' where test_session_id = 'bbbbbbbb-0000-0000-0000-000000000002'$$, true);
select pg_temp.try_as('assessment results cannot be deleted', 'authenticated',
  $$delete from public.diagnostic_results where test_session_id = 'bbbbbbbb-0000-0000-0000-000000000002'$$, true);
select pg_temp.try_as('assessment findings cannot be edited', 'authenticated',
  $$update public.diagnostic_findings set severity = 'INFO'$$, true);

-- ---- function hardening (migration 012)
select pg_temp.try_as('API users cannot call trigger functions directly', 'authenticated', 'select public.reject_modification()', true);

-- ---- catalog checks (run as the table owner)
insert into qa_results (check_name, passed, detail)
select 'row level security is enabled on every application table', count(*) = 0, string_agg(c.relname, ', ')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

insert into qa_results (check_name, passed, detail)
select 'every application table has at least one policy', count(*) = 0, string_agg(c.relname, ', ')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
   and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname);

insert into qa_results (check_name, passed, detail)
select 'the anon role has no table privileges in the public schema', count(*) = 0, string_agg(distinct table_name, ', ')
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'anon';

insert into qa_results (check_name, passed, detail)
select 'every application function has a fixed search_path', count(*) = 0, string_agg(p.proname, ', ')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and not coalesce(p.proconfig::text like '%search_path%', false);

insert into qa_results (check_name, passed, detail)
select 'no function other than the assessment function is executable by API roles', count(*) = 0, string_agg(p.proname, ', ')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname <> 'save_diagnostic_assessment'
   and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));

insert into qa_results (check_name, passed, detail)
select 'the save function is not executable by anon but is by signed-in users',
       not has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute'), null
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'save_diagnostic_assessment';

insert into qa_results (check_name, passed, detail)
select 'the parameter catalog has the 7 expected parameters', count(*) = 7, count(*)::text from public.parameter_definitions;

-- ---- report: every row must be passed = true
select check_name, passed, detail from qa_results order by n;

rollback;
