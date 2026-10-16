-- =====================================================================================================================
-- cleanup_demo_data.sql — removes ONLY what database/seed_demo_data.sql created, and ONLY what can be removed
-- without breaking the database's history rules.
--
-- What it removes:   demo DRAFT test sessions (and their readings), then demo motors that have no tests left.
-- What it CANNOT remove: SUBMITTED demo tests (immutable by design, migration 010) and the motors that have them.
--   Those stay. This script does not disable triggers, change policies or touch anything that is not a demo record.
--   (If you seeded with v_submit_demo_tests = false, nothing is submitted and the cleanup is complete.)
-- Real data is safe: rows are matched by the fixed demo ids (dede0001-… motors, dede0002-… sessions) AND your user id.
-- It never deletes reference profiles, limits, diagnostic results or findings (the seed creates none).
--
-- BEFORE YOU RUN IT: in the line marked >>> EDIT <<< below, replace the placeholder text with your User UID
-- (Authentication -> Users), exactly as you did in the seed.
-- Run database/verify_demo_data.sql afterwards to see what remains.
-- =====================================================================================================================

do $cleanup$
declare
  -- >>> EDIT <<<
  v_user_id_text text := 'PUT-YOUR-AUTH-USER-UUID-HERE';

  v_uid uuid;
  v_readings integer;
  v_sessions integer;
  v_motors integer;
  v_left_sessions integer;
  v_left_motors integer;
begin
  begin
    v_uid := v_user_id_text::uuid;
  exception when invalid_text_representation then
    raise exception 'Edit the script first: replace PUT-YOUR-AUTH-USER-UUID-HERE with your User UID (Authentication -> Users).';
  end;

  -- Readings of demo DRAFT sessions (the only readings the database allows to be deleted).
  delete from public.test_readings r
   using public.test_sessions t
   where r.test_session_id = t.id
     and t.id::text like 'dede0002-%' and t.owner_id = v_uid and t.status = 'draft';
  get diagnostics v_readings = row_count;

  -- Demo DRAFT sessions.
  delete from public.test_sessions t
   where t.id::text like 'dede0002-%' and t.owner_id = v_uid and t.status = 'draft';
  get diagnostics v_sessions = row_count;

  -- Demo motors that no longer have any test (the database forbids deleting a motor that has tests).
  delete from public.motors m
   where m.id::text like 'dede0001-%' and m.owner_id = v_uid
     and not exists (select 1 from public.test_sessions s where s.motor_id = m.id);
  get diagnostics v_motors = row_count;

  select count(*) into v_left_sessions from public.test_sessions where id::text like 'dede0002-%' and owner_id = v_uid;
  select count(*) into v_left_motors   from public.motors        where id::text like 'dede0001-%' and owner_id = v_uid;

  raise notice 'Removed % readings, % draft sessions, % motors. Remaining demo records: % sessions (submitted, immutable), % motors.',
    v_readings, v_sessions, v_motors, v_left_sessions, v_left_motors;
end
$cleanup$;
