-- 004_create_reference_limits.sql
-- Limits for one parameter within one reference profile.
-- Values come from approved sources only; this migration inserts none.
--
-- Threshold semantics (lower_limit/upper_limit vs warning_*) are NOT fixed here;
-- they are defined by the diagnostic rules implemented in Phase 6. Only structural
-- consistency is enforced (lower <= upper, warning_lower <= warning_upper).
-- One row per (profile, parameter): applicable_conditions describes the conditions
-- under which that row is valid; conditional variants need a separate profile.

create table public.reference_limits (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null default auth.uid(),
  reference_profile_id  uuid not null,
  parameter_code        text not null references public.parameter_definitions (code) on delete restrict,
  parameter_name        text not null,
  unit                  text not null,
  lower_limit           numeric,
  upper_limit           numeric,
  warning_lower         numeric,
  warning_upper         numeric,
  applicable_conditions jsonb not null default '{}'::jsonb,
  source_note           text not null,
  created_at            timestamptz not null default now(),

  -- Same owner as the profile; deleting a profile never cascades to its limits.
  constraint reference_limits_profile_fk
    foreign key (reference_profile_id, owner_id)
    references public.reference_profiles (id, owner_id) on delete restrict,
  constraint reference_limits_profile_parameter_key unique (reference_profile_id, parameter_code),
  constraint reference_limits_name_not_blank check (length(btrim(parameter_name)) > 0),
  constraint reference_limits_unit_not_blank check (length(btrim(unit)) > 0),
  constraint reference_limits_source_not_blank check (length(btrim(source_note)) > 0),
  constraint reference_limits_has_limit check (
    lower_limit is not null or upper_limit is not null
    or warning_lower is not null or warning_upper is not null
  ),
  constraint reference_limits_range_order check (
    lower_limit is null or upper_limit is null or lower_limit <= upper_limit
  ),
  constraint reference_limits_warning_order check (
    warning_lower is null or warning_upper is null or warning_lower <= warning_upper
  ),
  constraint reference_limits_conditions_object check (jsonb_typeof(applicable_conditions) = 'object')
);

create index reference_limits_profile_idx on public.reference_limits (reference_profile_id);

alter table public.reference_limits enable row level security;

-- Limits can only be changed while their profile is a draft.
create or replace function public.enforce_reference_limits_draft_only()
returns trigger
language plpgsql
as $$
declare
  profile_ids uuid[];
  pid uuid;
  st text;
begin
  if tg_op = 'INSERT' then
    profile_ids := array[new.reference_profile_id];
  elsif tg_op = 'DELETE' then
    profile_ids := array[old.reference_profile_id];
  else
    profile_ids := array[old.reference_profile_id, new.reference_profile_id];
  end if;

  foreach pid in array profile_ids loop
    select approval_status into st from public.reference_profiles where id = pid;
    if st is distinct from 'draft' then
      raise exception 'Limits of reference profile % cannot be changed because it is %; create a new profile version',
        pid, coalesce(st, 'missing') using errcode = 'check_violation';
    end if;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger reference_limits_draft_only
  before insert or update or delete on public.reference_limits
  for each row execute function public.enforce_reference_limits_draft_only();
