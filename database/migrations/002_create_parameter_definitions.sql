-- 002_create_parameter_definitions.sql
-- Parameter metadata only: stable code, display name, description, canonical unit.
-- NO engineering limits live here; limits belong to reference profiles
-- (reference_limits). This table is global, read-only through the API, and
-- changed only by migrations.
--
-- canonical_unit is the unit reference limits for the parameter are expressed in
-- and the unit readings are normalised to. These are unit definitions, not thresholds.
-- ASSUMPTION: vibration uses mm/s (PRD allows "mm/s or a defined acceleration unit").
-- Power factor is dimensionless and uses the unit label 'ratio'.

create table public.parameter_definitions (
  code            text primary key,
  display_name    text not null,
  description     text,
  canonical_unit  text not null,
  created_at      timestamptz not null default now(),

  constraint parameter_definitions_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint parameter_definitions_name_not_blank check (length(btrim(display_name)) > 0),
  constraint parameter_definitions_unit_not_blank check (length(btrim(canonical_unit)) > 0)
);

alter table public.parameter_definitions enable row level security;

insert into public.parameter_definitions (code, display_name, description, canonical_unit) values
  ('voltage',      'Voltage',          'Measured supply voltage at the motor.',                        'V'),
  ('current',      'Current',          'Measured line current drawn by the motor.',                    'A'),
  ('temperature',  'Temperature',      'Measured temperature at a stated measurement location.',       '°C'),
  ('vibration',    'Vibration',        'Measured vibration; method and location must be recorded.',    'mm/s'),
  ('speed',        'Rotational speed', 'Measured shaft rotational speed.',                             'RPM'),
  ('frequency',    'Frequency',        'Measured supply frequency.',                                   'Hz'),
  ('power_factor', 'Power factor',     'Measured power factor (dimensionless).',                       'ratio');
