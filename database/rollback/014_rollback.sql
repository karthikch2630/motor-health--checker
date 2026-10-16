-- 014_rollback.sql  (PROPOSED, MANUAL - not a migration; run only if you must undo 014)
-- Restores the pre-014 ownership behaviour: owner_id defaults to auth.uid() and every policy compares owner_id with auth.uid().
--
-- WHAT HAPPENS TO DATA
--   * No private row is changed or deleted. Rows that members created carry the WORKSPACE OWNER's owner_id, so after the rollback
--     the original owner still sees them. Members lose all access immediately (their own workspace is empty).
--   * audit_events is KEPT (its select policy is re-pointed at auth.uid()), so the who-did-what trail survives. To discard it too,
--     uncomment the last statement. workspace_members is dropped, so member mappings and can_approve flags are lost: note them first.
--   * Approval authority is no longer enforced after the rollback (as before 014): anyone signed in as the workspace owner can approve.
-- Run in the SQL Editor (admin role), as one script. It is not idempotent: run it once.

begin;

-- 1. Policies back to auth.uid() (identical to migration 009)
drop policy motors_owner_all on public.motors;
create policy motors_owner_all on public.motors
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy reference_profiles_owner_all on public.reference_profiles;
create policy reference_profiles_owner_all on public.reference_profiles
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy reference_limits_owner_all on public.reference_limits;
create policy reference_limits_owner_all on public.reference_limits
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy test_sessions_owner_all on public.test_sessions;
create policy test_sessions_owner_all on public.test_sessions
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy test_readings_owner_all on public.test_readings;
create policy test_readings_owner_all on public.test_readings
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy diagnostic_results_owner_select on public.diagnostic_results;
create policy diagnostic_results_owner_select on public.diagnostic_results
  for select to authenticated using (owner_id = (select auth.uid()));
drop policy diagnostic_results_owner_insert on public.diagnostic_results;
create policy diagnostic_results_owner_insert on public.diagnostic_results
  for insert to authenticated with check (owner_id = (select auth.uid()));

drop policy diagnostic_findings_owner_select on public.diagnostic_findings;
create policy diagnostic_findings_owner_select on public.diagnostic_findings
  for select to authenticated using (owner_id = (select auth.uid()));
drop policy diagnostic_findings_owner_insert on public.diagnostic_findings;
create policy diagnostic_findings_owner_insert on public.diagnostic_findings
  for insert to authenticated with check (owner_id = (select auth.uid()));

drop policy audit_events_workspace_select on public.audit_events;
create policy audit_events_workspace_select on public.audit_events
  for select to authenticated using (owner_id = (select auth.uid()));

-- 2. Defaults back to auth.uid()
alter table public.motors              alter column owner_id set default auth.uid();
alter table public.reference_profiles  alter column owner_id set default auth.uid();
alter table public.reference_limits    alter column owner_id set default auth.uid();
alter table public.test_sessions       alter column owner_id set default auth.uid();
alter table public.test_readings       alter column owner_id set default auth.uid();
alter table public.diagnostic_results  alter column owner_id set default auth.uid();
alter table public.diagnostic_findings alter column owner_id set default auth.uid();

-- 3. Triggers and functions added by 014
drop trigger motors_audit              on public.motors;
drop trigger reference_profiles_audit  on public.reference_profiles;
drop trigger test_sessions_audit       on public.test_sessions;
drop trigger diagnostic_results_audit  on public.diagnostic_results;
drop trigger reference_profiles_approval_authority on public.reference_profiles;
drop function public.log_audit_event();
drop function public.enforce_approval_authority();
drop function public.current_user_can_approve();
drop function public.current_workspace_owner();

-- 4. Membership (members lose access here)
drop table public.workspace_members;

-- 5. OPTIONAL: discard the audit trail as well (the append-only trigger blocks row deletes, not DROP TABLE).
-- drop table public.audit_events;

commit;
