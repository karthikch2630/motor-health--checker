-- 008_create_diagnostic_findings.sql
-- Individual findings of an assessment. Append-only, like diagnostic_results.
-- Finding severity (INFO/WARNING/CRITICAL) is separate from the overall status.

create table public.diagnostic_findings (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null default auth.uid(),
  diagnostic_result_id  uuid not null,
  parameter_code        text references public.parameter_definitions (code) on delete restrict,
  rule_code             text not null,
  severity              text not null,
  observed_value        numeric,
  observed_unit         text,
  applicable_limit      numeric,
  finding_description   text not null,
  possible_causes       jsonb,
  recommended_action    text,
  created_at            timestamptz not null default now(),

  constraint diagnostic_findings_result_fk
    foreign key (diagnostic_result_id, owner_id)
    references public.diagnostic_results (id, owner_id) on delete restrict,
  constraint diagnostic_findings_severity_valid check (severity in ('INFO', 'WARNING', 'CRITICAL')),
  constraint diagnostic_findings_rule_not_blank check (length(btrim(rule_code)) > 0),
  constraint diagnostic_findings_description_not_blank check (length(btrim(finding_description)) > 0),
  constraint diagnostic_findings_observed_pair check (
    observed_value is null or observed_unit is not null
  ),
  constraint diagnostic_findings_causes_array check (
    possible_causes is null or jsonb_typeof(possible_causes) = 'array'
  )
);

create index diagnostic_findings_result_idx on public.diagnostic_findings (diagnostic_result_id);

alter table public.diagnostic_findings enable row level security;

create trigger diagnostic_findings_append_only
  before update or delete on public.diagnostic_findings
  for each row execute function public.reject_modification();
