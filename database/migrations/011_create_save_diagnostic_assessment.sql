-- 011_create_save_diagnostic_assessment.sql
-- Atomic persistence of an assessment: result + findings + (first time only) session -> assessed,
-- in ONE transaction.
--
-- Why: diagnostic_results and diagnostic_findings are append-only (migrations 007/008). Writing them with
-- separate API calls could leave a result without its findings that nobody could correct. A function body
-- runs as a single transaction, so either everything is stored or nothing is.
--
-- Security: SECURITY INVOKER (the default). The function runs with the caller's privileges, so RLS,
-- ownership (owner_id = auth.uid()), column defaults, the composite foreign keys and every trigger apply
-- exactly as for direct inserts. Nothing here can be used to bypass them. EXECUTE is granted to
-- `authenticated` only.
--
-- The revision number is computed inside the transaction (after locking the session row), so concurrent
-- reassessments cannot produce duplicates; the UNIQUE (test_session_id, revision) constraint is the backstop.
-- Previous revisions are never touched.
--
-- p_findings: JSON array of objects with keys
--   parameter_code, rule_code, severity, observed_value, observed_unit, applicable_limit,
--   finding_description, possible_causes (array), recommended_action
-- Only rule_code, severity and finding_description are required; the table constraints validate the rest.

create or replace function public.save_diagnostic_assessment(
  p_session_id        uuid,
  p_profile_id        uuid,
  p_profile_version   integer,
  p_engine_version    text,
  p_status            text,
  p_summary           text,
  p_findings          jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_session_status text;
  v_revision       integer;
  v_result_id      uuid;
begin
  if p_findings is null or jsonb_typeof(p_findings) <> 'array' then
    raise exception 'p_findings must be a JSON array' using errcode = 'check_violation';
  end if;

  -- Lock the session row so concurrent assessments are serialised. RLS hides other owners' sessions.
  select status into v_session_status
    from public.test_sessions
   where id = p_session_id
     for update;

  if v_session_status is null then
    raise exception 'Test session % was not found', p_session_id using errcode = 'no_data_found';
  end if;
  if v_session_status = 'draft' then
    raise exception 'Test session % is still a draft and cannot be assessed', p_session_id
      using errcode = 'check_violation';
  end if;

  select coalesce(max(revision), 0) + 1 into v_revision
    from public.diagnostic_results
   where test_session_id = p_session_id;

  insert into public.diagnostic_results (
    test_session_id, revision, reference_profile_id, reference_profile_version,
    diagnostic_engine_version, overall_status, summary
  ) values (
    p_session_id, v_revision, p_profile_id, p_profile_version,
    p_engine_version, p_status, p_summary
  )
  returning id into v_result_id;

  insert into public.diagnostic_findings (
    diagnostic_result_id, parameter_code, rule_code, severity, observed_value, observed_unit,
    applicable_limit, finding_description, possible_causes, recommended_action
  )
  select v_result_id, f.parameter_code, f.rule_code, f.severity, f.observed_value, f.observed_unit,
         f.applicable_limit, f.finding_description, f.possible_causes, f.recommended_action
    from jsonb_to_recordset(p_findings) as f(
      parameter_code      text,
      rule_code           text,
      severity            text,
      observed_value      numeric,
      observed_unit       text,
      applicable_limit    numeric,
      finding_description text,
      possible_causes     jsonb,
      recommended_action  text
    );

  -- First assessment of a submitted test: mark it assessed (migration 010 allows exactly this change).
  if v_session_status = 'submitted' then
    update public.test_sessions set status = 'assessed' where id = p_session_id;
  end if;

  return jsonb_build_object('result_id', v_result_id, 'revision', v_revision);
end;
$$;

revoke all on function public.save_diagnostic_assessment(uuid, uuid, integer, text, text, text, jsonb) from public, anon;
grant execute on function public.save_diagnostic_assessment(uuid, uuid, integer, text, text, text, jsonb) to authenticated;
