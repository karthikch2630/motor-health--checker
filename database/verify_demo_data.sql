-- =====================================================================================================================
-- verify_demo_data.sql — read-only checks for the demo data. Nothing here changes anything.
-- The Supabase SQL Editor shows only the LAST result of a run: paste and run ONE numbered query at a time.
-- Queries 1-7 look for demo records by their fixed ids (dede0001- motors, dede0002- sessions), so they work without your user id.
-- Expected values are for a COMPLETE seed with v_submit_demo_tests = true (with false: submitted = 0, draft = 8).
-- =====================================================================================================================

-- 1. parameter_definitions — NOT created by the seed (migration 002). Expect 7.
select count(*) as parameter_definitions, string_agg(code, ', ' order by code) as codes from public.parameter_definitions;

-- 2. motors — expect 4 rows DEMO-M-001 … DEMO-M-004, all notes starting 'DEMONSTRATION DATA'.
select motor_tag, name, motor_type, owner_id, left(notes, 40) as notes_start
  from public.motors where id::text like 'dede0001-%' order by motor_tag;

-- 3. test_sessions — expect 8 rows: 6 submitted + 2 draft (DEMO-M-001: 4 submitted + 1 draft; DEMO-M-002: 1 + 1; DEMO-M-003: 1).
select m.motor_tag, s.status, s.test_timestamp::date as test_date, s.measurement_method
  from public.test_sessions s join public.motors m on m.id = s.motor_id
 where s.id::text like 'dede0002-%' order by m.motor_tag, s.test_timestamp;

-- 4. test_readings — expect 27 rows in total (5, 5, 5, 4, 1, 4, 1, 2 per session, in the order of query 3).
select m.motor_tag, s.test_timestamp::date as test_date, s.status, count(*) as readings,
       string_agg(r.parameter_code || '=' || r.measured_value || ' ' || r.measured_unit, ', ' order by r.parameter_code) as values_entered
  from public.test_readings r
  join public.test_sessions s on s.id = r.test_session_id
  join public.motors m on m.id = s.motor_id
 where s.id::text like 'dede0002-%'
 group by m.motor_tag, s.test_timestamp, s.status order by m.motor_tag, s.test_timestamp;

-- 5. reference_profiles and reference_limits — the seed creates none. Expect 0 rows containing the word DEMO.
select (select count(*) from public.reference_profiles where name ilike '%demo%' or source_name ilike '%demo%') as demo_profiles,
       (select count(*) from public.reference_limits   where source_note ilike '%demo%')                         as demo_limits;

-- 6. diagnostic_results and diagnostic_findings — the seed creates none. Expect 0 and 0.
select (select count(*) from public.diagnostic_results  where test_session_id::text like 'dede0002-%') as demo_results,
       (select count(*) from public.diagnostic_findings f join public.diagnostic_results r on r.id = f.diagnostic_result_id
         where r.test_session_id::text like 'dede0002-%')                                              as demo_findings;

-- 7. Integrity: every demo row belongs to ONE user, and no real (non-demo) motor/test uses a demo id range.
select (select count(distinct owner_id) from public.motors where id::text like 'dede0001-%')        as owners_of_demo_motors,
       (select count(distinct owner_id) from public.test_sessions where id::text like 'dede0002-%') as owners_of_demo_sessions,
       (select count(*) from public.motors where id::text like 'dede0001-%' and motor_tag not like 'DEMO-%') as demo_ids_without_demo_tag;

-- 8. VISIBILITY TO YOUR SIGNED-IN USER (what the app sees through row-level security).
--    In the set_config line, replace the placeholder text with your User UID, then run the whole block at once.
--    If the editor shows no result, remove the last line, run it, then run  rollback;  on its own.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'PUT-YOUR-AUTH-USER-UUID-HERE', true);
select (select count(*) from public.motors        where id::text like 'dede0001-%') as motors_visible_to_you,
       (select count(*) from public.test_sessions where id::text like 'dede0002-%') as sessions_visible_to_you,
       (select count(*) from public.test_readings r join public.test_sessions s on s.id = r.test_session_id
         where s.id::text like 'dede0002-%')                                         as readings_visible_to_you;
rollback;
