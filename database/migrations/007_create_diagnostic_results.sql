-- 007_create_diagnostic_results.sql
-- Overall assessment of a test. Append-only: reassessment creates a new revision
-- (highest revision = current); issued results are never updated or deleted.
--
-- Each result records the exact reference profile id + version and the diagnostic
-- engine version used. The profile is nullable only for results that could not be
-- assessed against a profile (INSUFFICIENT_DATA / NOT_ASSESSED); the application
-- must not attach an unrelated profile in that case.

create table public.diagnostic_results (
  id                         uuid primary key default gen_random_uuid(),
  owner_id                   uuid not null default auth.uid(),
  test_session_id            uuid not null,
  revision                   integer not null default 1,
  reference_profile_id       uuid,
  reference_profile_version  integer,
  diagnostic_engine_version  text not null,
  overall_status             text not null,
  summary                    text,
  assessed_at                timestamptz not null default now(),

  constraint diagnostic_results_session_fk
    foreign key (test_session_id, owner_id)
    references public.test_sessions (id, owner_id) on delete restrict,
  -- Ensures the stored version is the real version of the referenced profile.
  constraint diagnostic_results_profile_fk
    foreign key (reference_profile_id, reference_profile_version)
    references public.reference_profiles (id, version) on delete restrict,
  constraint diagnostic_results_profile_owner_fk
    foreign key (reference_profile_id, owner_id)
    references public.reference_profiles (id, owner_id) on delete restrict,
  constraint diagnostic_results_id_owner_key unique (id, owner_id),
  constraint diagnostic_results_session_revision_key unique (test_session_id, revision),
  constraint diagnostic_results_revision_positive check (revision > 0),
  constraint diagnostic_results_status_valid check (
    overall_status in ('NORMAL', 'WARNING', 'FAULT_SUSPECTED', 'INSUFFICIENT_DATA', 'NOT_ASSESSED')
  ),
  constraint diagnostic_results_profile_pair check (
    (reference_profile_id is null) = (reference_profile_version is null)
  ),
  -- A NORMAL/WARNING/FAULT_SUSPECTED assessment is meaningless without a profile.
  constraint diagnostic_results_profile_required check (
    overall_status in ('INSUFFICIENT_DATA', 'NOT_ASSESSED') or reference_profile_id is not null
  ),
  constraint diagnostic_results_engine_not_blank check (length(btrim(diagnostic_engine_version)) > 0)
);

create index diagnostic_results_session_idx on public.diagnostic_results (test_session_id);
create index diagnostic_results_status_idx on public.diagnostic_results (overall_status);

alter table public.diagnostic_results enable row level security;

create or replace function public.enforce_diagnostic_result_rules()
returns trigger
language plpgsql
as $$
declare
  session_status text;
  profile_status text;
begin
  select status into session_status from public.test_sessions where id = new.test_session_id;
  if session_status = 'draft' then
    raise exception 'Draft test session % cannot be assessed; submit it first', new.test_session_id
      using errcode = 'check_violation';
  end if;

  -- Only approved profiles may back an authoritative assessment.
  -- (A missing profile is rejected by the diagnostic_results_profile_required check.)
  if new.overall_status in ('NORMAL', 'WARNING', 'FAULT_SUSPECTED') and new.reference_profile_id is not null then
    select approval_status into profile_status
      from public.reference_profiles where id = new.reference_profile_id;
    if profile_status is distinct from 'approved' then
      raise exception 'Reference profile % is not approved and cannot support a % assessment',
        new.reference_profile_id, new.overall_status using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger diagnostic_results_rules
  before insert on public.diagnostic_results
  for each row execute function public.enforce_diagnostic_result_rules();

-- Append-only guard (defence in depth; API grants and RLS also deny these).
create or replace function public.reject_modification()
returns trigger
language plpgsql
as $$
begin
  raise exception '% on % is not allowed: records are append-only', tg_op, tg_table_name
    using errcode = 'check_violation';
end;
$$;

create trigger diagnostic_results_append_only
  before update or delete on public.diagnostic_results
  for each row execute function public.reject_modification();
