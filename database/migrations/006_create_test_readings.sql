-- 006_create_test_readings.sql
-- One row per measured parameter per test. Original value and unit are always
-- stored; normalised value/unit are filled only when a supported conversion exists.
-- A missing measurement is simply an absent row (never stored as zero).

create table public.test_readings (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null default auth.uid(),
  test_session_id       uuid not null,
  parameter_code        text not null references public.parameter_definitions (code) on delete restrict,
  measured_value        numeric not null,
  measured_unit         text not null,
  normalized_value      numeric,
  normalized_unit       text,
  measurement_location  text,
  recorded_at           timestamptz not null default now(),

  constraint test_readings_session_fk
    foreign key (test_session_id, owner_id)
    references public.test_sessions (id, owner_id) on delete restrict,
  -- Repeated measurements are not supported in the MVP.
  constraint test_readings_session_parameter_key unique (test_session_id, parameter_code),
  constraint test_readings_unit_not_blank check (length(btrim(measured_unit)) > 0),
  constraint test_readings_normalized_pair check (
    (normalized_value is null) = (normalized_unit is null)
  ),
  constraint test_readings_normalized_unit_not_blank check (
    normalized_unit is null or length(btrim(normalized_unit)) > 0
  )
);

create index test_readings_session_idx on public.test_readings (test_session_id);

alter table public.test_readings enable row level security;

-- Readings can be changed only while their session has not been assessed.
create or replace function public.enforce_test_readings_unassessed_only()
returns trigger
language plpgsql
as $$
declare
  sids uuid[];
  sid uuid;
  st text;
begin
  if tg_op = 'INSERT' then
    sids := array[new.test_session_id];
  elsif tg_op = 'DELETE' then
    sids := array[old.test_session_id];
  else
    sids := array[old.test_session_id, new.test_session_id];
  end if;

  foreach sid in array sids loop
    select status into st from public.test_sessions where id = sid;
    if st = 'assessed' then
      raise exception 'Readings of assessed test session % cannot be changed', sid
        using errcode = 'check_violation';
    end if;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger test_readings_unassessed_only
  before insert or update or delete on public.test_readings
  for each row execute function public.enforce_test_readings_unassessed_only();
