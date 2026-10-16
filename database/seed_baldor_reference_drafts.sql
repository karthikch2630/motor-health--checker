-- =====================================================================================================================
-- seed_baldor_reference_drafts.sql — creates ONE DRAFT reference profile for the 15 Baldor-Reliance catalog motors
-- (MTR-BAL-001 … MTR-BAL-015). Run it in the Supabase SQL Editor AFTER migrations 001-012. Idempotent.
--
-- WHAT IT CREATES: one profile (DRAFT, never approved here) with two limits, both taken from NEMA MG 1 clause 12.44
--   "Variations from rated voltage and rated frequency" for general-purpose three-phase induction motors:
--     voltage    414 – 506 V   (rated 460 V  ±10 %)   stored as WARNING thresholds
--     frequency   57 –  63 Hz  (rated 60 Hz  ±5 %)    stored as WARNING thresholds
--   plus the COMBINED rule 12.44.1(d): |voltage %| + |frequency %| <= 10 % of the motor's rated values, frequency within ±5 %
--   (stored in applicable_specs.combined_variation and evaluated as an explicit rule, not as two ranges).
--   All three apply only at RATED LOAD, which the test must record (Load during the test = Rated load).
--   WARNING (not hard boundaries) because the standard defines a tolerance within which the motor operates
--   "successfully", not a fault boundary. Leaving the hard boundaries empty means nothing here can raise FAULT_SUSPECTED.
--
-- WHAT IT DELIBERATELY DOES NOT CREATE: limits for current, temperature, vibration, speed or power factor. No source
--   with limits applicable to these motors in the repository's measurement terms was verified. See docs/REFERENCE_DATA_SOURCES.md.
--
-- REQUIRES migration 013 (motors.supply_type). The profile applies only to motors whose supply_type is 'line'; motors with the supply
--   not recorded show applicability UNKNOWN and inverter-fed motors are INCOMPATIBLE. Set the supply on each motor yourself, after verifying it.
--
-- BEFORE YOU RUN IT: replace PUT-YOUR-AUTH-USER-UUID-HERE with your Authentication -> Users -> "User UID".
--   The profile is owned by that user (profiles are per-user in this schema; there is no shared/global profile table).
--
-- BEFORE YOU APPROVE IT: the clause text was verified against the primary NEMA MG 1-2016 (Rev. 2018) Part 12 PDF. Newer
--   editions were not checked, and rated load is declared by the operator, not measured (docs/REFERENCE_DATA_SOURCES.md).
--   Approval makes the profile immutable (migration 003). If you ran an EARLIER version of this script, delete that
--   unapproved draft in the app first (drafts can be deleted) and run this one: an existing profile is never modified.
--
-- SAFETY: one DO block (one transaction); no DELETE/TRUNCATE/ALTER; existing profiles are never modified; it refuses to
--   run if the 15 motors do not share ONE motor_type (a profile has exactly one), or if none are found.
-- =====================================================================================================================

do $seed$
declare
  -- >>> EDIT <<<
  v_user_id_text text := '7086297d-c4b2-462f-8be1-490a90ea5ff5';

  v_uid         uuid;
  v_types       text[];
  v_found       integer;
  v_profile_id  uuid := 'bab00003-0000-4000-8000-000000000001';
  v_inserted    integer;
  v_src_ref     text := 'ANSI/NEMA MG 1-2016 (Revised 2018), Section II, Part 12, clause 12.44.1 "Running", items a, c, d '
                        '(primary text read from https://www.nema.org/docs/default-source/standards-document-library/mg-1-part-12-watermark.pdf). '
                        'Later MG 1 / MG 00001 editions were NOT checked.';
begin
  begin
    v_uid := v_user_id_text::uuid;
  exception when invalid_text_representation then
    raise exception 'Edit the script first: replace PUT-YOUR-AUTH-USER-UUID-HERE with your User UID (Authentication -> Users).';
  end;
  if not exists (select 1 from auth.users where id = v_uid) then
    raise exception 'No Auth user with id % exists in this project.', v_uid;
  end if;

  select count(*), array_agg(distinct motor_type) into v_found, v_types
  from public.motors
  where owner_id = v_uid and motor_tag ~ '^MTR-BAL-0(0[1-9]|1[0-5])$';

  if v_found = 0 then
    raise exception 'None of the motors MTR-BAL-001 … MTR-BAL-015 exist for this user.';
  end if;
  if array_length(v_types, 1) <> 1 then
    raise exception 'The Baldor motors have different motor types (%). Make them consistent first (a profile matches exactly one motor type).', v_types;
  end if;

  insert into public.reference_profiles
    (id, owner_id, name, motor_type, description, applicable_specs, source_name, source_reference, version, approval_status)
  values (
    v_profile_id, v_uid,
    'NEMA MG 1 12.44 supply tolerance - 460 V / 60 Hz three-phase',
    v_types[1],
    'DRAFT. Supply voltage and frequency tolerance for general-purpose three-phase induction motors rated 460 V, 60 Hz, per ANSI/NEMA MG 1-2016 (Rev. 2018) 12.44.1 (a), (c) and (d). '
    'Individual ranges are stored as warning thresholds; the combined rule (d) is an explicit rule in applicable_specs.combined_variation. '
    'All three apply only at RATED LOAD, which must be recorded on the test ("Load during the test" = Rated load); otherwise they are reported as not assessed. '
    'Rated load is declared by the operator, not measured. Covers voltage and frequency ONLY; current, temperature, vibration, speed and power factor are NOT assessed. '
    'Applies only to motors recorded with a fixed-frequency line supply (not inverter-fed). Within the tolerance the motor is not guaranteed to meet its rated-condition performance.',
    jsonb_build_object(
      'phase_count', 3, 'supply_type', 'line', 'rated_frequency_hz', 60, 'rated_voltage_min_v', 460, 'rated_voltage_max_v', 460,
      'combined_variation', jsonb_build_object(
        'voltage_parameter', 'voltage', 'frequency_parameter', 'frequency', 'voltage_unit', 'V', 'frequency_unit', 'Hz',
        'max_combined_percent', 10, 'max_frequency_percent', 5, 'required_load_condition', 'rated',
        'source', 'ANSI/NEMA MG 1-2016 (Rev. 2018) 12.44.1(d)')),
    'ANSI/NEMA MG 1-2016 (Rev. 2018), 12.44.1',
    v_src_ref,
    1, 'draft'
  )
  on conflict do nothing;
  get diagnostics v_inserted = row_count;

  -- Limits only for a profile created by THIS run (limits are draft-only; an existing profile is left untouched).
  if v_inserted = 1 then
    insert into public.reference_limits
      (owner_id, reference_profile_id, parameter_code, parameter_name, unit, warning_lower, warning_upper, applicable_conditions, source_note)
    select v_uid, v_profile_id, d.code, d.display_name, d.canonical_unit, l.wl, l.wu,
           '{"required_load_condition": "rated", "description": "Rated load; sinusoidal utility supply"}'::jsonb, l.note
    from (values
      ('voltage',   414::numeric, 506::numeric, 'Rated 460 V +/-10 % at rated frequency (ANSI/NEMA MG 1-2016 Rev. 2018, 12.44.1(a)), at rated load. Measure at the motor terminals. The combined rule 12.44.1(d) is a separate explicit rule in the profile.'),
      ('frequency',  57::numeric,  63::numeric, 'Rated 60 Hz +/-5 % at rated voltage (ANSI/NEMA MG 1-2016 Rev. 2018, 12.44.1(c)), at rated load. The combined rule 12.44.1(d) is a separate explicit rule in the profile.')
    ) as l(code, wl, wu, note)
    join public.parameter_definitions d on d.code = l.code;
  end if;

  raise notice 'Baldor reference draft: motors found % of 15; profile % (0 = already existed).', v_found, v_inserted;
end
$seed$;
