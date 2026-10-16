-- 014_add_workspace_members.sql  (PROPOSED - not applied to any hosted database)
-- Lets named, individually authorized users work in ANOTHER user's existing workspace, with their own attribution and without
-- changing who owns any row.
--
-- Model: every private row already carries owner_id = the user who created it (migrations 001-009). A "workspace" is simply
-- "all rows with a given owner_id". This migration adds:
--
--   workspace_members(member_id -> owner_id, can_approve)   one row per authorized member, at most ONE workspace per member
--   current_workspace_owner()                                the owner_id the caller works under (own id unless mapped)
--   current_user_can_approve()                               approval authority of the caller (see below)
--   audit_events                                             append-only log: WHO (the real authenticated user) did WHAT, WHEN
--
-- 1. workspace_members: RLS on, NO policies, ALL API privileges revoked. Only an administrator (SQL Editor / service role, never the
--    frontend) can add, change or remove members.
-- 2. current_workspace_owner(): SECURITY DEFINER (it reads the locked-down table), empty search_path, EXECUTE for `authenticated` only.
-- 3. owner_id column defaults on the seven private tables change from auth.uid() to current_workspace_owner(), so rows a member
--    creates are stamped with the workspace owner; the composite foreign keys (id, owner_id) keep working.
-- 4. The owner-scoped policies are re-created against current_workspace_owner(): same structure and strictness as migration 009.
-- 5. Approval authority (irreversible actions). Ordinary membership does NOT include it. A profile moving to `approved` or `retired`
--    is refused by a trigger unless the caller is the workspace owner or a member with can_approve = true. Administrator contexts
--    (auth.uid() is null: SQL Editor) are allowed; anon/API callers never reach the table (no privileges).
-- 6. Attribution. owner_id keeps meaning "which workspace". WHO acted is recorded in audit_events by triggers using the real
--    auth.uid() of the session; a client can neither supply nor forge it, cannot insert, update or delete audit rows (no privileges,
--    and an append-only trigger blocks even administrators), and can read only its own workspace's events.
--    Logged: motor created/updated/deleted; profile created/approved/retired/deleted; test created/submitted/assessed/deleted;
--    assessment saved (revision, status, profile version). Not logged: readings, limits and findings (children of the above),
--    edits to a draft test, edits to a draft profile. Events before this migration are NOT recorded.
--
-- NOT changed: any data row, any column, triggers for submitted-test immutability / profile lifecycle / append-only results,
-- save_diagnostic_assessment (SECURITY INVOKER; it relies on defaults and RLS), the parameter_definitions policy, grants on the
-- private tables, approval status, effective dates, supply types, diagnostic rules, historical results.
--
-- Rollback: database/proposed/014_rollback.sql (manual, documented). Revoking ONE user: delete their workspace_members row.

-- ------------------------------------------------------------------ membership
create table public.workspace_members (
  member_id   uuid primary key references auth.users (id) on delete cascade,
  owner_id    uuid not null references auth.users (id) on delete restrict,
  can_approve boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint workspace_members_not_self check (member_id <> owner_id)
);

alter table public.workspace_members enable row level security;
revoke all on public.workspace_members from public, anon, authenticated;

create or replace function public.current_workspace_owner()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select m.owner_id from public.workspace_members m where m.member_id = auth.uid()),
    auth.uid()
  )
$$;

revoke all on function public.current_workspace_owner() from public, anon;
grant execute on function public.current_workspace_owner() to authenticated;

-- ------------------------------------------------------------------ defaults and policies
alter table public.motors              alter column owner_id set default public.current_workspace_owner();
alter table public.reference_profiles  alter column owner_id set default public.current_workspace_owner();
alter table public.reference_limits    alter column owner_id set default public.current_workspace_owner();
alter table public.test_sessions       alter column owner_id set default public.current_workspace_owner();
alter table public.test_readings       alter column owner_id set default public.current_workspace_owner();
alter table public.diagnostic_results  alter column owner_id set default public.current_workspace_owner();
alter table public.diagnostic_findings alter column owner_id set default public.current_workspace_owner();

drop policy motors_owner_all on public.motors;
create policy motors_owner_all on public.motors
  for all to authenticated
  using (owner_id = (select public.current_workspace_owner()))
  with check (owner_id = (select public.current_workspace_owner()));

drop policy reference_profiles_owner_all on public.reference_profiles;
create policy reference_profiles_owner_all on public.reference_profiles
  for all to authenticated
  using (owner_id = (select public.current_workspace_owner()))
  with check (owner_id = (select public.current_workspace_owner()));

drop policy reference_limits_owner_all on public.reference_limits;
create policy reference_limits_owner_all on public.reference_limits
  for all to authenticated
  using (owner_id = (select public.current_workspace_owner()))
  with check (owner_id = (select public.current_workspace_owner()));

drop policy test_sessions_owner_all on public.test_sessions;
create policy test_sessions_owner_all on public.test_sessions
  for all to authenticated
  using (owner_id = (select public.current_workspace_owner()))
  with check (owner_id = (select public.current_workspace_owner()));

drop policy test_readings_owner_all on public.test_readings;
create policy test_readings_owner_all on public.test_readings
  for all to authenticated
  using (owner_id = (select public.current_workspace_owner()))
  with check (owner_id = (select public.current_workspace_owner()));

drop policy diagnostic_results_owner_select on public.diagnostic_results;
create policy diagnostic_results_owner_select on public.diagnostic_results
  for select to authenticated
  using (owner_id = (select public.current_workspace_owner()));

drop policy diagnostic_results_owner_insert on public.diagnostic_results;
create policy diagnostic_results_owner_insert on public.diagnostic_results
  for insert to authenticated
  with check (owner_id = (select public.current_workspace_owner()));

drop policy diagnostic_findings_owner_select on public.diagnostic_findings;
create policy diagnostic_findings_owner_select on public.diagnostic_findings
  for select to authenticated
  using (owner_id = (select public.current_workspace_owner()));

drop policy diagnostic_findings_owner_insert on public.diagnostic_findings;
create policy diagnostic_findings_owner_insert on public.diagnostic_findings
  for insert to authenticated
  with check (owner_id = (select public.current_workspace_owner()));

-- ------------------------------------------------------------------ approval authority
create or replace function public.current_user_can_approve()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then true                                   -- administrator context (SQL Editor); API callers cannot reach the table
    when auth.uid() = public.current_workspace_owner() then true        -- the workspace owner
    else coalesce((select m.can_approve from public.workspace_members m where m.member_id = auth.uid()), false)
  end
$$;

revoke all on function public.current_user_can_approve() from public, anon;
grant execute on function public.current_user_can_approve() to authenticated;

create or replace function public.enforce_approval_authority()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.approval_status is distinct from new.approval_status
     and new.approval_status in ('approved', 'retired')
     and not public.current_user_can_approve() then
    raise exception 'Approving or retiring a reference profile requires approval authority in this workspace'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_approval_authority() from public, anon, authenticated;

-- Name sorts before reference_profiles_lifecycle, so the authority check runs first.
create trigger reference_profiles_approval_authority
  before update on public.reference_profiles
  for each row execute function public.enforce_approval_authority();

-- ------------------------------------------------------------------ audit trail
create table public.audit_events (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  owner_id   uuid not null,                 -- the workspace the record belongs to (deliberately no foreign key: the log must outlive users)
  actor_id   uuid,                          -- the real authenticated user (auth.uid()); NULL = administrator / SQL Editor
  action     text not null,
  table_name text not null,
  record_id  uuid,
  detail     jsonb not null default '{}'::jsonb,
  constraint audit_events_detail_object check (jsonb_typeof(detail) = 'object')
);

create index audit_events_owner_at_idx on public.audit_events (owner_id, at desc);
create index audit_events_record_idx on public.audit_events (record_id);

alter table public.audit_events enable row level security;
revoke all on public.audit_events from public, anon, authenticated;
grant select on public.audit_events to authenticated;

create policy audit_events_workspace_select on public.audit_events
  for select to authenticated
  using (owner_id = (select public.current_workspace_owner()));

create trigger audit_events_append_only
  before update or delete on public.audit_events
  for each row execute function public.reject_modification();

create or replace function public.log_audit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row    record;
  v_action text;
  v_detail jsonb := '{}'::jsonb;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;

  if tg_table_name = 'motors' then
    v_action := 'motor.' || case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end;

  elsif tg_table_name = 'reference_profiles' then
    if tg_op = 'INSERT' then
      v_action := 'profile.created';
      v_detail := jsonb_build_object('version', new.version);
    elsif tg_op = 'DELETE' then
      v_action := 'profile.deleted';
      v_detail := jsonb_build_object('version', old.version);
    elsif old.approval_status is distinct from new.approval_status then
      v_action := 'profile.' || new.approval_status;
      v_detail := jsonb_build_object('version', new.version, 'from', old.approval_status, 'to', new.approval_status);
    else
      return null;                                           -- edits to a draft are not logged
    end if;

  elsif tg_table_name = 'test_sessions' then
    if tg_op = 'INSERT' then
      v_action := 'test.created';
    elsif tg_op = 'DELETE' then
      v_action := 'test.deleted';
    elsif old.status is distinct from new.status then
      v_action := 'test.' || case new.status when 'submitted' then 'submitted' when 'assessed' then 'assessed' else 'status_changed' end;
      v_detail := jsonb_build_object('from', old.status, 'to', new.status);
    else
      return null;                                           -- edits to a draft are not logged
    end if;

  elsif tg_table_name = 'diagnostic_results' then
    v_action := 'assessment.saved';
    v_detail := jsonb_build_object('test_session_id', new.test_session_id, 'revision', new.revision, 'overall_status', new.overall_status,
                                   'reference_profile_id', new.reference_profile_id, 'reference_profile_version', new.reference_profile_version,
                                   'engine_version', new.diagnostic_engine_version);
  else
    return null;
  end if;

  insert into public.audit_events (owner_id, actor_id, action, table_name, record_id, detail)
  values (v_row.owner_id, auth.uid(), v_action, tg_table_name, v_row.id, v_detail);
  return null;
end;
$$;

revoke all on function public.log_audit_event() from public, anon, authenticated;

create trigger motors_audit
  after insert or update or delete on public.motors
  for each row execute function public.log_audit_event();
create trigger reference_profiles_audit
  after insert or update or delete on public.reference_profiles
  for each row execute function public.log_audit_event();
create trigger test_sessions_audit
  after insert or update or delete on public.test_sessions
  for each row execute function public.log_audit_event();
create trigger diagnostic_results_audit
  after insert on public.diagnostic_results
  for each row execute function public.log_audit_event();
