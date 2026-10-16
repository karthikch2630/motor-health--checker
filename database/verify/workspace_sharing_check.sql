-- workspace_sharing_check.sql - READ-ONLY checks around migration 014 (workspace sharing). Run in the Supabase SQL Editor.
-- Only SELECT statements; no user id is hard-coded. Run queries 1-4 BEFORE applying 014 (to record the "before" state) and again
-- AFTER (they must be identical except where noted). Queries 5-8 need 014 applied.
-- The SQL Editor bypasses RLS, so these show all owners' rows: compare owner_id with Authentication -> Users.

-- 1. Row counts per owner (record this). After 014 and the grant these numbers must be IDENTICAL.
select 'motors' as t, owner_id, count(*) from public.motors group by owner_id
union all select 'reference_profiles', owner_id, count(*) from public.reference_profiles group by owner_id
union all select 'reference_limits', owner_id, count(*) from public.reference_limits group by owner_id
union all select 'test_sessions', owner_id, count(*) from public.test_sessions group by owner_id
union all select 'test_readings', owner_id, count(*) from public.test_readings group by owner_id
union all select 'diagnostic_results', owner_id, count(*) from public.diagnostic_results group by owner_id
union all select 'diagnostic_findings', owner_id, count(*) from public.diagnostic_findings group by owner_id
order by 1, 2;

-- 2. Reference profiles: status, version and dates must NOT change.
select id, name, version, approval_status, effective_from, effective_to, owner_id
from public.reference_profiles order by name, version;

-- 3. Stored assessments: revisions, statuses, profile versions and engine versions must NOT change.
select r.test_session_id, r.revision, r.overall_status, r.reference_profile_id, r.reference_profile_version, r.diagnostic_engine_version, r.assessed_at
from public.diagnostic_results r order by r.test_session_id, r.revision;

-- 4. Motors: ratings and supply type must NOT change.
select motor_tag, motor_type, rated_voltage, rated_frequency, phase_count, supply_type, owner_id from public.motors order by motor_tag;

-- 5. (014 applied) Members: who works in whose workspace, and who holds approval authority.
select m.member_id, u.email as member_email, m.owner_id, o.email as owner_email, m.can_approve, m.created_at
from public.workspace_members m
left join auth.users u on u.id = m.member_id
left join auth.users o on o.id = m.owner_id
order by m.created_at;

-- 6. (014 applied) Every private-table policy and owner default must use current_workspace_owner(). Expect: bare_auth_uid = 0 on every row.
select 'policy' as kind, tablename as name, policyname as detail,
       (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ 'auth\.uid' as bare_auth_uid
from pg_policies where schemaname = 'public' and tablename <> 'parameter_definitions'
union all
select 'default', table_name, column_default, coalesce(column_default, '') ~ 'auth\.uid'
from information_schema.columns
where table_schema = 'public' and column_name = 'owner_id' and table_name not in ('audit_events', 'workspace_members')
order by 1, 2;

-- 7. (014 applied) Exposure check. Expect every privilege column false for workspace_members and audit_events to anon;
--    false for workspace_members to authenticated; audit_events: select only. All new functions: anon_exec false, fixed search_path.
select t.table_name,
       has_table_privilege('anon', 'public.' || t.table_name, 'select') as anon_select,
       has_table_privilege('authenticated', 'public.' || t.table_name, 'select') as auth_select,
       has_table_privilege('authenticated', 'public.' || t.table_name, 'insert') as auth_insert,
       has_table_privilege('authenticated', 'public.' || t.table_name, 'update') as auth_update,
       has_table_privilege('authenticated', 'public.' || t.table_name, 'delete') as auth_delete
from (values ('workspace_members'), ('audit_events')) as t(table_name);

select p.proname, p.prosecdef as security_definer, p.proconfig as config,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('current_workspace_owner', 'current_user_can_approve', 'enforce_approval_authority', 'log_audit_event')
order by p.proname;

-- 8. (014 applied) Who did what. actor_email NULL = administrator (SQL Editor) or an account since deleted.
select e.at, e.action, u.email as actor_email, e.table_name, e.record_id, e.detail
from public.audit_events e left join auth.users u on u.id = e.actor_id
order by e.id desc limit 100;
