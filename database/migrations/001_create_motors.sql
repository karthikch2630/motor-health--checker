-- 001_create_motors.sql
-- Registered electric motors. Private, owned by the authenticated user.
-- Ownership model: every private table carries owner_id (default auth.uid()).
-- (id, owner_id) is unique so child tables can use composite foreign keys that
-- make cross-owner links impossible at the database level.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.motors (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid() references auth.users (id) on delete restrict,
  motor_tag        text not null,
  name             text not null,
  motor_type       text not null,
  manufacturer     text,
  model            text,
  serial_number    text,
  rated_voltage    numeric,
  rated_current    numeric,
  rated_power      numeric,
  power_unit       text,
  rated_frequency  numeric,
  rated_rpm        integer,
  phase_count      smallint,
  location         text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint motors_id_owner_key unique (id, owner_id),
  constraint motors_owner_tag_key unique (owner_id, motor_tag),
  constraint motors_tag_not_blank check (length(btrim(motor_tag)) > 0),
  constraint motors_name_not_blank check (length(btrim(name)) > 0),
  constraint motors_type_not_blank check (length(btrim(motor_type)) > 0),
  constraint motors_rated_voltage_positive check (rated_voltage is null or rated_voltage > 0),
  constraint motors_rated_current_positive check (rated_current is null or rated_current > 0),
  constraint motors_rated_power_positive check (rated_power is null or rated_power > 0),
  constraint motors_power_unit_valid check (power_unit is null or power_unit in ('W', 'kW')),
  constraint motors_power_unit_required check (rated_power is null or power_unit is not null),
  constraint motors_rated_frequency_positive check (rated_frequency is null or rated_frequency > 0),
  constraint motors_rated_rpm_positive check (rated_rpm is null or rated_rpm > 0),
  constraint motors_phase_count_positive check (phase_count is null or phase_count > 0)
);

create index motors_motor_type_idx on public.motors (motor_type);

create trigger motors_set_updated_at
  before update on public.motors
  for each row execute function public.set_updated_at();

alter table public.motors enable row level security;
