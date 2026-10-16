-- 003_create_reference_profiles.sql
-- Versioned reference configurations. A profile moves draft -> approved -> retired.
-- Approved/retired profiles are immutable (except approved -> retired), so
-- previously issued assessments stay interpretable. To change limits, create a new
-- profile version.
--
-- No profile rows are seeded: this project must not invent engineering thresholds.

create table public.reference_profiles (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid() references auth.users (id) on delete restrict,
  name             text not null,
  motor_type       text not null,
  description      text,
  -- Applicable motor specifications / configuration, e.g. {"phase_count": 3}.
  -- Interpreted by the application; never used to hold limits.
  applicable_specs jsonb not null default '{}'::jsonb,
  source_name      text not null,
  source_reference text,
  version          integer not null,
  approval_status  text not null default 'draft',
  effective_from   timestamptz,
  effective_to     timestamptz,
  created_at       timestamptz not null default now(),

  constraint reference_profiles_id_owner_key unique (id, owner_id),
  -- (id, version) lets assessments reference the exact version they used.
  constraint reference_profiles_id_version_key unique (id, version),
  constraint reference_profiles_name_version_key unique (owner_id, name, version),
  constraint reference_profiles_name_not_blank check (length(btrim(name)) > 0),
  constraint reference_profiles_type_not_blank check (length(btrim(motor_type)) > 0),
  constraint reference_profiles_source_not_blank check (length(btrim(source_name)) > 0),
  constraint reference_profiles_version_positive check (version > 0),
  constraint reference_profiles_status_valid check (approval_status in ('draft', 'approved', 'retired')),
  constraint reference_profiles_specs_object check (jsonb_typeof(applicable_specs) = 'object'),
  constraint reference_profiles_effective_order check (
    effective_from is null or effective_to is null or effective_from <= effective_to
  )
);

create index reference_profiles_lookup_idx
  on public.reference_profiles (motor_type, approval_status);

alter table public.reference_profiles enable row level security;

-- Immutability / lifecycle rules.
create or replace function public.enforce_reference_profile_lifecycle()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.approval_status <> 'draft' then
      raise exception 'Only draft reference profiles can be deleted (profile % is %)',
        old.id, old.approval_status using errcode = 'check_violation';
    end if;
    return old;
  end if;

  -- UPDATE
  if old.approval_status = 'retired' then
    raise exception 'Retired reference profile % cannot be modified', old.id
      using errcode = 'check_violation';
  end if;

  if old.approval_status = 'approved' then
    if new.approval_status not in ('approved', 'retired') then
      raise exception 'Approved reference profile % can only be retired', old.id
        using errcode = 'check_violation';
    end if;
    if (new.owner_id, new.name, new.motor_type, new.description, new.applicable_specs,
        new.source_name, new.source_reference, new.version, new.effective_from)
       is distinct from
       (old.owner_id, old.name, old.motor_type, old.description, old.applicable_specs,
        old.source_name, old.source_reference, old.version, old.effective_from) then
      raise exception 'Approved reference profile % is immutable; create a new version instead', old.id
        using errcode = 'check_violation';
    end if;
  end if;

  if old.approval_status = 'draft' and new.approval_status = 'retired' then
    raise exception 'A draft profile must be approved before it can be retired'
      using errcode = 'check_violation';
  end if;

  -- Approval requires at least one configured limit.
  if new.approval_status = 'approved' and old.approval_status = 'draft' then
    if not exists (select 1 from public.reference_limits where reference_profile_id = new.id) then
      raise exception 'Reference profile % has no limits and cannot be approved', new.id
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- NOTE: the function above references public.reference_limits only at run time
-- (migration 004 creates it), which plpgsql permits.
create trigger reference_profiles_lifecycle
  before update or delete on public.reference_profiles
  for each row execute function public.enforce_reference_profile_lifecycle();
