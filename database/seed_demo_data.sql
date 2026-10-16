-- =====================================================================================================================
-- seed_demo_data.sql — OPTIONAL demonstration data for Motor Health Checker.
-- Run it in the Supabase SQL Editor AFTER migrations 001-012. It is idempotent: running it again changes nothing.
--
-- WHAT IT CREATES (all clearly labelled DEMONSTRATION DATA, all owned by YOUR user):
--   4 demo motors (tags DEMO-M-001 … DEMO-M-004), 8 demo test sessions and their synthetic readings.
--   It creates NO reference profiles, NO reference limits, NO diagnostic results and NO findings.
--   So nothing is "assessed" and no motor looks healthy: submitted demo tests show as "awaiting assessment".
--   Readings, nameplate values and dates are made up. They are NOT engineering data and not engineering limits.
--
-- BEFORE YOU RUN IT — edit the two lines marked  >>> EDIT <<<  below:
--   1. v_user_id_text : your Auth user id.  Supabase dashboard -> Authentication -> Users -> click your user ->
--      copy "User UID" (a uuid like 3f2b...-....). Paste it between the quotes. Do not invent one.
--   2. v_submit_demo_tests : read the warning below, then leave true or set false.
--
-- !! WARNING ABOUT PERMANENCE !!
--   With v_submit_demo_tests = true, six demo tests are SUBMITTED so the dashboard, history and trend chart have
--   content. Submitted tests are IMMUTABLE by design (migration 010): they cannot be edited or deleted through the app or
--   the API, so they — and the three motors that have them — cannot be removed by database/cleanup_demo_data.sql.
--   With v_submit_demo_tests = false every demo test stays a draft: fewer screens are populated, but cleanup removes
--   everything completely. You can run the script first with false and later with true (it upgrades drafts); you cannot go back.
--
-- SAFETY
--   * One DO block = one transaction: either everything is created or nothing is.
--   * No TRUNCATE, no DELETE, no ALTER, no trigger or RLS changes, no ID resets. Existing rows are never overwritten
--     (ON CONFLICT DO NOTHING on stable demo ids). Real data is never touched.
--   * The migrations' triggers stay enabled and are respected (sessions start as drafts; readings are only added to drafts;
--     a draft is submitted only after it has readings).
--   * The SQL Editor runs as an administrator role, which bypasses RLS; that is why every row is stamped with your user id
--     explicitly. The app (signed in as you) sees exactly these rows through the normal RLS policies.
--
-- DEMO IDENTIFICATION: motor_tag 'DEMO-…', name 'DEMO — …', notes/operating conditions 'DEMONSTRATION DATA…',
--   measurement method 'DEMO — not a real instrument', and fixed ids starting dede0001- (motors) and dede0002- (sessions).
-- =====================================================================================================================

do $seed$
declare
  -- >>> EDIT <<<  paste your Authentication -> Users -> "User UID" between the quotes
  v_user_id_text      text    := 'PUT-YOUR-AUTH-USER-UUID-HERE';
  -- >>> EDIT <<<  true = submit 6 demo tests (permanent, see warning); false = keep all demo tests as removable drafts
  v_submit_demo_tests boolean := true;

  v_uid        uuid;
  v_found      integer;
  v_motors     integer;
  v_sessions   integer;
  v_readings   integer;
  v_submitted  integer;
begin
  -- ---- 1. validate inputs and the target database -------------------------------------------------------------
  begin
    v_uid := v_user_id_text::uuid;
  exception when invalid_text_representation then
    raise exception 'Edit the script first: replace PUT-YOUR-AUTH-USER-UUID-HERE with your User UID (Authentication -> Users).';
  end;

  if not exists (select 1 from auth.users where id = v_uid) then
    raise exception 'No Auth user with id % exists in this project. Copy the "User UID" from Authentication -> Users.', v_uid;
  end if;

  select count(*) into v_found from public.parameter_definitions
   where code in ('voltage', 'current', 'temperature', 'vibration', 'speed', 'frequency', 'power_factor');
  if v_found <> 7 then
    raise exception 'parameter_definitions has % of the 7 expected rows. Apply migration 002 first (it is not touched by this script).', v_found;
  end if;

  if exists (select 1 from public.motors where id::text like 'dede0001-%' and owner_id <> v_uid)
     or exists (select 1 from public.test_sessions where id::text like 'dede0002-%' and owner_id <> v_uid) then
    raise exception 'Demo records already exist for a DIFFERENT user. Nothing was changed.';
  end if;

  -- ---- 2. demo motors ----------------------------------------------------------------------------------------
  insert into public.motors
    (id, owner_id, motor_tag, name, motor_type, manufacturer, model, serial_number,
     rated_voltage, rated_current, rated_power, power_unit, rated_frequency, rated_rpm, phase_count, location, notes)
  select m.id, v_uid, m.tag, m.name, m.mtype, 'Demo Manufacturer (fictitious)', m.model, m.serial,
         m.volt, m.amp, m.power, 'kW', m.freq, m.rpm, m.phases, m.location,
         'DEMONSTRATION DATA — fictitious motor created by database/seed_demo_data.sql. Nameplate values are made up. '
         || 'It can be ignored; see database/cleanup_demo_data.sql for what can be removed.'
    from (values
      ('dede0001-0000-4000-8000-000000000001'::uuid, 'DEMO-M-001', 'DEMO — Cooling water pump motor', 'induction',   'DEMO-100', 'DEMO-SN-0001', 400::numeric, 10::numeric,  5.5::numeric, 50::numeric, 1450, 3::smallint, 'Demo plant / Area A'),
      ('dede0001-0000-4000-8000-000000000002'::uuid, 'DEMO-M-002', 'DEMO — Ventilation fan motor',     'induction',   'DEMO-200', 'DEMO-SN-0002', 400,          5,           2.2,          50,          2900, 3,            'Demo plant / Area B'),
      ('dede0001-0000-4000-8000-000000000003'::uuid, 'DEMO-M-003', 'DEMO — Conveyor drive motor',      'synchronous', 'DEMO-300', 'DEMO-SN-0003', 690,          15,          11,           50,          1500, 3,            'Demo plant / Area C'),
      ('dede0001-0000-4000-8000-000000000004'::uuid, 'DEMO-M-004', 'DEMO — Spare motor (no tests)',    'induction',   'DEMO-100', 'DEMO-SN-0004', 400,          10,          5.5,          50,          1450, 3,            'Demo plant / Store')
    ) as m(id, tag, name, mtype, model, serial, volt, amp, power, freq, rpm, phases, location)
  on conflict (id) do nothing;

  -- ---- 3. demo test sessions (always created as DRAFTS first; the trigger requires it) ---------------------------
  insert into public.test_sessions
    (id, owner_id, motor_id, test_timestamp, operating_conditions, measurement_method, notes, status)
  select s.id, v_uid, s.motor_id, now() - s.age,
         jsonb_build_object('operator', 'DEMO', 'description', 'DEMONSTRATION DATA — synthetic, not a real test'),
         'DEMO — not a real instrument',
         'DEMONSTRATION DATA: synthetic readings for exploring the application. This is not a real test.',
         'draft'
    from (values
      ('dede0002-0000-4000-8000-000000000001'::uuid, 'dede0001-0000-4000-8000-000000000001'::uuid, interval '28 days'),
      ('dede0002-0000-4000-8000-000000000002'::uuid, 'dede0001-0000-4000-8000-000000000001'::uuid, interval '21 days'),
      ('dede0002-0000-4000-8000-000000000003'::uuid, 'dede0001-0000-4000-8000-000000000001'::uuid, interval '14 days'),
      ('dede0002-0000-4000-8000-000000000004'::uuid, 'dede0001-0000-4000-8000-000000000001'::uuid, interval '7 days'),
      ('dede0002-0000-4000-8000-000000000005'::uuid, 'dede0001-0000-4000-8000-000000000001'::uuid, interval '1 day'),   -- stays a draft
      ('dede0002-0000-4000-8000-000000000006'::uuid, 'dede0001-0000-4000-8000-000000000002'::uuid, interval '10 days'),
      ('dede0002-0000-4000-8000-000000000007'::uuid, 'dede0001-0000-4000-8000-000000000002'::uuid, interval '2 days'),  -- stays a draft
      ('dede0002-0000-4000-8000-000000000008'::uuid, 'dede0001-0000-4000-8000-000000000003'::uuid, interval '5 days')
    ) as s(id, motor_id, age)
  on conflict (id) do nothing;

  -- ---- 4. synthetic readings ---------------------------------------------------------------------------------
  -- Added only while the session is still a draft (the trigger from migration 010 forbids changing a submitted test's
  -- readings, so re-runs simply skip them). Original value + unit are kept; normalized value is in the canonical unit.
  -- Variety on purpose: kV and °F entries show unit conversion; some tests lack parameters; the same method and
  -- (blank) location across DEMO-M-001's tests lets the trend chart compare them.
  insert into public.test_readings
    (test_session_id, owner_id, parameter_code, measured_value, measured_unit, normalized_value, normalized_unit, measurement_location)
  select r.sid, v_uid, r.code, r.val, r.unit, r.nval, r.nunit, null
    from (values
      -- DEMO-M-001, 28 days ago
      ('dede0002-0000-4000-8000-000000000001'::uuid, 'voltage'::text,     398::numeric, 'V'::text,    398::numeric, 'V'::text),
      ('dede0002-0000-4000-8000-000000000001'::uuid, 'current',           9.6,          'A',          9.6,          'A'),
      ('dede0002-0000-4000-8000-000000000001'::uuid, 'temperature',       62,           '°C',         62,           '°C'),
      ('dede0002-0000-4000-8000-000000000001'::uuid, 'vibration',         1.8,          'mm/s',       1.8,          'mm/s'),
      ('dede0002-0000-4000-8000-000000000001'::uuid, 'speed',             1448,         'RPM',        1448,         'RPM'),
      -- 21 days ago (voltage entered in kV, converted)
      ('dede0002-0000-4000-8000-000000000002'::uuid, 'voltage',           0.401,        'kV',         401,          'V'),
      ('dede0002-0000-4000-8000-000000000002'::uuid, 'current',           9.8,          'A',          9.8,          'A'),
      ('dede0002-0000-4000-8000-000000000002'::uuid, 'temperature',       63,           '°C',         63,           '°C'),
      ('dede0002-0000-4000-8000-000000000002'::uuid, 'vibration',         1.9,          'mm/s',       1.9,          'mm/s'),
      ('dede0002-0000-4000-8000-000000000002'::uuid, 'speed',             1449,         'RPM',        1449,         'RPM'),
      -- 14 days ago (temperature entered in °F, converted: (140-32)*5/9 = 60)
      ('dede0002-0000-4000-8000-000000000003'::uuid, 'voltage',           399,          'V',          399,          'V'),
      ('dede0002-0000-4000-8000-000000000003'::uuid, 'current',           9.7,          'A',          9.7,          'A'),
      ('dede0002-0000-4000-8000-000000000003'::uuid, 'temperature',       140,          '°F',         60,           '°C'),
      ('dede0002-0000-4000-8000-000000000003'::uuid, 'vibration',         2.0,          'mm/s',       2.0,          'mm/s'),
      ('dede0002-0000-4000-8000-000000000003'::uuid, 'speed',             1447,         'RPM',        1447,         'RPM'),
      -- 7 days ago (vibration NOT measured)
      ('dede0002-0000-4000-8000-000000000004'::uuid, 'voltage',           402,          'V',          402,          'V'),
      ('dede0002-0000-4000-8000-000000000004'::uuid, 'current',           9.9,          'A',          9.9,          'A'),
      ('dede0002-0000-4000-8000-000000000004'::uuid, 'temperature',       64,           '°C',         64,           '°C'),
      ('dede0002-0000-4000-8000-000000000004'::uuid, 'speed',             1450,         'RPM',        1450,         'RPM'),
      -- 1 day ago: unfinished draft with a single reading
      ('dede0002-0000-4000-8000-000000000005'::uuid, 'voltage',           400,          'V',          400,          'V'),
      -- DEMO-M-002, 10 days ago
      ('dede0002-0000-4000-8000-000000000006'::uuid, 'voltage',           399,          'V',          399,          'V'),
      ('dede0002-0000-4000-8000-000000000006'::uuid, 'current',           4.9,          'A',          4.9,          'A'),
      ('dede0002-0000-4000-8000-000000000006'::uuid, 'temperature',       55,           '°C',         55,           '°C'),
      ('dede0002-0000-4000-8000-000000000006'::uuid, 'vibration',         1.2,          'mm/s',       1.2,          'mm/s'),
      -- 2 days ago: unfinished draft
      ('dede0002-0000-4000-8000-000000000007'::uuid, 'current',           5.0,          'A',          5.0,          'A'),
      -- DEMO-M-003, 5 days ago: only two parameters measured
      ('dede0002-0000-4000-8000-000000000008'::uuid, 'voltage',           689,          'V',          689,          'V'),
      ('dede0002-0000-4000-8000-000000000008'::uuid, 'temperature',       70,           '°C',         70,           '°C')
    ) as r(sid, code, val, unit, nval, nunit)
   where exists (select 1 from public.test_sessions t
                  where t.id = r.sid and t.owner_id = v_uid and t.status = 'draft')
  on conflict (test_session_id, parameter_code) do nothing;

  -- ---- 5. submit the demo tests chosen for it (permanent; see warning) ---------------------------------------------
  if v_submit_demo_tests then
    update public.test_sessions t
       set status = 'submitted'
     where t.owner_id = v_uid
       and t.status = 'draft'
       and t.id in ('dede0002-0000-4000-8000-000000000001', 'dede0002-0000-4000-8000-000000000002',
                    'dede0002-0000-4000-8000-000000000003', 'dede0002-0000-4000-8000-000000000004',
                    'dede0002-0000-4000-8000-000000000006', 'dede0002-0000-4000-8000-000000000008')
       and exists (select 1 from public.test_readings r where r.test_session_id = t.id);
  end if;

  -- ---- 6. summary (shown as a notice where the editor displays them; use database/verify_demo_data.sql to inspect) --
  select count(*) into v_motors    from public.motors        where id::text like 'dede0001-%' and owner_id = v_uid;
  select count(*) into v_sessions  from public.test_sessions where id::text like 'dede0002-%' and owner_id = v_uid;
  select count(*) into v_submitted from public.test_sessions where id::text like 'dede0002-%' and owner_id = v_uid and status = 'submitted';
  select count(*) into v_readings  from public.test_readings r join public.test_sessions t on t.id = r.test_session_id
                                    where t.id::text like 'dede0002-%' and t.owner_id = v_uid;
  raise notice 'Demo data present for user %: % motors, % sessions (% submitted), % readings. Expected on a complete run: 4 / 8 / % / 27.',
    v_uid, v_motors, v_sessions, v_submitted, v_readings, case when v_submit_demo_tests then 6 else 0 end;
end
$seed$;
