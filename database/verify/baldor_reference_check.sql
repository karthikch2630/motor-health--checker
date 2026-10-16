-- baldor_reference_check.sql — READ-ONLY checks for the Baldor motors and reference data. Run in the Supabase SQL Editor.
-- Only SELECT statements. No user id is hard-coded. The SQL Editor runs as an admin role and bypasses RLS, so these show ALL owners'
-- rows: compare owner_id with your "User UID" in Authentication -> Users. (The app only ever sees rows owned by the signed-in user.)
-- Query 3 and 6 need migration 013 (motors.supply_type); if it is not applied they fail with "column supply_type does not exist" - that
-- itself is the answer: apply 013 before deploying this version of the app.

-- 1. All 15 expected asset tags: present or MISSING, with owner.  Expect 15 rows, present = true everywhere, one owner.
select t.tag, (m.id is not null) as present, m.owner_id, m.model
from (select 'MTR-BAL-' || lpad(n::text, 3, '0') as tag from generate_series(1, 15) n) t
left join public.motors m on m.motor_tag = t.tag
order by t.tag;

-- 2. Consistency summary for the Baldor set. Expect motors = 15, owners = 1, motor_types = 1, phase_counts = 1, voltages = 1,
--    frequencies = 1. (More than one motor_type means the seed refuses to run; fix the motor_type text first.)
select count(*) as motors, count(distinct owner_id) as owners, count(distinct lower(btrim(motor_type))) as motor_types,
       array_agg(distinct motor_type) as motor_type_values, count(distinct phase_count) as phase_counts,
       count(distinct rated_voltage) as voltages, count(distinct rated_frequency) as frequencies
from public.motors
where motor_tag ~ '^MTR-BAL-0(0[1-9]|1[0-5])$';

-- 3. The motors with the fields that decide applicability. supply_type NULL = not recorded = the NEMA draft shows applicability
--    UNKNOWN (never assumed). Inverter-duty models (e.g. VEBM3558, VECP3770T-4) must NOT be set to 'line' unless verified.
select motor_tag, model, motor_type, phase_count, rated_voltage, rated_frequency, supply_type, owner_id
from public.motors
where motor_tag ~ '^MTR-BAL-0(0[1-9]|1[0-5])$'
order by motor_tag;

-- 4. Profiles: status, owner, effective dates, limit count. Zero rows = nothing can be assessed (PROFILE_NOT_AVAILABLE).
--    Also shows any combined-rule configuration and the required supply type.
select p.id, p.name, p.version, p.motor_type, p.approval_status, p.effective_from, p.effective_to, p.owner_id,
       p.applicable_specs ->> 'supply_type' as required_supply_type,
       (p.applicable_specs -> 'combined_variation') is not null as has_combined_rule,
       (select count(*) from public.reference_limits l where l.reference_profile_id = p.id) as limits
from public.reference_profiles p
order by p.name, p.version;

-- 5. Limits with their sources and required load condition.
select p.name, p.version, p.approval_status, l.parameter_code, l.unit, l.lower_limit, l.warning_lower, l.warning_upper, l.upper_limit,
       l.applicable_conditions ->> 'required_load_condition' as required_load_condition, l.source_note
from public.reference_limits l
join public.reference_profiles p on p.id = l.reference_profile_id
order by p.name, p.version, l.parameter_code;

-- 6. Every Baldor motor x every profile. 'verdict' mirrors profileMatch.ts for the keys the profiles use: usable / unknown / incompatible.
--    A profile is usable only when verdict = 'usable' AND it is approved AND has limits. The app remains the authority.
select m.motor_tag, p.name, p.version, p.approval_status,
       (p.owner_id = m.owner_id) as same_owner,
       (lower(btrim(p.motor_type)) = lower(btrim(m.motor_type))) as type_match,
       case
         when lower(btrim(p.motor_type)) <> lower(btrim(m.motor_type)) then 'incompatible'
         when p.applicable_specs ->> 'phase_count' is not null and m.phase_count is distinct from (p.applicable_specs ->> 'phase_count')::numeric
              and m.phase_count is not null then 'incompatible'
         when p.applicable_specs ->> 'rated_frequency_hz' is not null and m.rated_frequency is not null
              and m.rated_frequency <> (p.applicable_specs ->> 'rated_frequency_hz')::numeric then 'incompatible'
         when p.applicable_specs ->> 'rated_voltage_min_v' is not null and m.rated_voltage is not null
              and m.rated_voltage < (p.applicable_specs ->> 'rated_voltage_min_v')::numeric then 'incompatible'
         when p.applicable_specs ->> 'rated_voltage_max_v' is not null and m.rated_voltage is not null
              and m.rated_voltage > (p.applicable_specs ->> 'rated_voltage_max_v')::numeric then 'incompatible'
         when p.applicable_specs ->> 'supply_type' is not null and m.supply_type is not null
              and m.supply_type <> p.applicable_specs ->> 'supply_type' then 'incompatible'
         when (p.applicable_specs ->> 'phase_count' is not null and m.phase_count is null)
              or (p.applicable_specs ->> 'rated_frequency_hz' is not null and m.rated_frequency is null)
              or ((p.applicable_specs ->> 'rated_voltage_min_v' is not null or p.applicable_specs ->> 'rated_voltage_max_v' is not null) and m.rated_voltage is null)
              or (p.applicable_specs ->> 'supply_type' is not null and m.supply_type is null) then 'unknown'
         else 'usable'
       end as verdict,
       (p.effective_from is null or p.effective_from <= now()) and (p.effective_to is null or p.effective_to >= now()) as in_date
from public.motors m
cross join public.reference_profiles p
where m.motor_tag ~ '^MTR-BAL-0(0[1-9]|1[0-5])$'
order by m.motor_tag, p.name, p.version;

-- 7. Stored assessments of the Baldor motors (history is never altered by reference-data changes).
select m.motor_tag, s.test_timestamp, r.revision, r.overall_status, r.reference_profile_id, r.reference_profile_version, r.diagnostic_engine_version
from public.diagnostic_results r
join public.test_sessions s on s.id = r.test_session_id
join public.motors m on m.id = s.motor_id
where m.motor_tag ~ '^MTR-BAL-0(0[1-9]|1[0-5])$'
order by m.motor_tag, s.test_timestamp, r.revision;
