-- 013_add_motor_supply_type.sql
-- Records how a motor is supplied, so reference profiles that apply only to a fixed-frequency sinusoidal line supply
-- (e.g. NEMA MG 1 clause 12.44.1) cannot be matched to an inverter-fed or unverified motor.
--   NULL       = not recorded (applicability to such a profile is UNKNOWN, never assumed)
--   'line'     = fixed-frequency line supply, not fed from a drive
--   'inverter' = fed from an inverter / variable-frequency drive
-- Additive and forward-only: one nullable column. No data is changed; existing rows stay NULL. Existing RLS policies,
-- grants and triggers apply to the new column unchanged. Apply BEFORE deploying the frontend that sends this field.

alter table public.motors add column supply_type text;

alter table public.motors
  add constraint motors_supply_type_valid check (supply_type is null or supply_type in ('line', 'inverter'));
