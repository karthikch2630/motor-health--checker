-- =====================================================================================================================
-- clear_test_history.sql  -  DESTRUCTIVE AND IRREVERSIBLE. Deletes ALL tests of one workspace owner, with their readings,
-- assessments (diagnostic results) and findings. Run in the Supabase SQL Editor (administrator). There is no undo and no backup.
--
-- WHAT IT DELETES   every row of test_sessions, test_readings, diagnostic_results, diagnostic_findings owned by v_owner.
-- WHAT IT KEEPS     motors, reference profiles and limits, parameter catalog, workspace members, and audit_events.
--                   The audit trail records one 'test.deleted' event per removed test (actor empty = administrator), and the
--                   earlier 'test.created' / 'test.submitted' / 'assessment.saved' events stay, so the deletion is itself traceable.
--
-- WHY IT TAKES SPECIAL STEPS   Submitted tests and stored assessments are protected on purpose: nothing in the app can delete
--   them. This script temporarily turns off exactly four protection triggers, deletes in a safe order (findings, results,
--   readings, tests), and turns them back on, all inside ONE transaction. If anything fails, everything rolls back, including
--   the trigger changes. At the end it checks that the four triggers are enabled again.
--
-- BEFORE YOU RUN IT, edit the two lines marked  >>> EDIT <<<
--   v_owner_text : your Authentication -> Users "User UID" (the workspace owner)
--   v_confirm    : type exactly   DELETE ALL TEST HISTORY   to confirm. Anything else and the script refuses.
-- =====================================================================================================================

do $clear$
declare
  v_owner_text text := 'PUT-OWNER-AUTH-USER-UUID-HERE';   -- >>> EDIT <<<
  v_confirm    text := 'NOT CONFIRMED';                    -- >>> EDIT <<<  (type: DELETE ALL TEST HISTORY)
  v_owner      uuid;
  n_findings   integer;
  n_results    integer;
  n_readings   integer;
  n_sessions   integer;
  n_enabled    integer;
begin
  if v_confirm <> 'DELETE ALL TEST HISTORY' then
    raise exception 'Not confirmed. Nothing was deleted. To proceed, set v_confirm to exactly: DELETE ALL TEST HISTORY';
  end if;
  begin
    v_owner := v_owner_text::uuid;
  exception when invalid_text_representation then
    raise exception 'Edit the script first: replace PUT-OWNER-AUTH-USER-UUID-HERE with the owner User UID.';
  end;
  if not exists (select 1 from auth.users where id = v_owner) then
    raise exception 'No Auth user % exists. Nothing was deleted.', v_owner;
  end if;

  -- 1. turn off exactly the four protections that block deleting stored history
  alter table public.diagnostic_findings disable trigger diagnostic_findings_append_only;
  alter table public.diagnostic_results  disable trigger diagnostic_results_append_only;
  alter table public.test_readings       disable trigger test_readings_draft_only;
  alter table public.test_sessions       disable trigger test_sessions_lifecycle;

  -- 2. delete in dependency order, only this owner's rows
  delete from public.diagnostic_findings where owner_id = v_owner;  get diagnostics n_findings = row_count;
  delete from public.diagnostic_results  where owner_id = v_owner;  get diagnostics n_results  = row_count;
  delete from public.test_readings       where owner_id = v_owner;  get diagnostics n_readings = row_count;
  delete from public.test_sessions       where owner_id = v_owner;  get diagnostics n_sessions = row_count;

  -- 3. turn the protections back on
  alter table public.diagnostic_findings enable trigger diagnostic_findings_append_only;
  alter table public.diagnostic_results  enable trigger diagnostic_results_append_only;
  alter table public.test_readings       enable trigger test_readings_draft_only;
  alter table public.test_sessions       enable trigger test_sessions_lifecycle;

  -- 4. prove they are on again; otherwise abort and roll everything back
  select count(*) into n_enabled
    from pg_trigger
   where tgname in ('diagnostic_findings_append_only', 'diagnostic_results_append_only',
                    'test_readings_draft_only', 'test_sessions_lifecycle')
     and tgenabled = 'O' and not tgisinternal;
  if n_enabled <> 4 then
    raise exception 'Safety check failed: only % of 4 protection triggers are enabled. Rolled back; nothing was deleted.', n_enabled;
  end if;

  raise notice 'Deleted % finding(s), % assessment(s), % reading(s), % test(s). Protections are enabled again.',
    n_findings, n_results, n_readings, n_sessions;
end
$clear$;
