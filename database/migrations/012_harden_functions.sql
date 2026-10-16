-- 012_harden_functions.sql
-- Security hardening of the functions created by migrations 001-011. No table, policy or function BODY changes;
-- behaviour is identical. Apply once, after 011.
--
-- 1. Fixed search_path. Supabase's database linter flags functions without one ("function_search_path_mutable"),
--    because an unqualified name could otherwise resolve to an object in a schema the caller controls.
--    Every function here already qualifies its tables (`public.`) and uses only built-in functions, so an empty
--    search_path is safe. Built-ins in pg_catalog are always found.
--
-- 2. Trigger functions are not meant to be called by API users. They cannot run outside a trigger anyway, but
--    they were still listed as callable endpoints. Revoke EXECUTE from API roles. Triggers keep firing: PostgreSQL
--    checks EXECUTE on a trigger function when the trigger is created, not when it fires.
--
-- save_diagnostic_assessment keeps SECURITY INVOKER and its existing grant (authenticated only).

alter function public.set_updated_at()                          set search_path = '';
alter function public.enforce_reference_profile_lifecycle()     set search_path = '';
alter function public.enforce_reference_limits_draft_only()     set search_path = '';
alter function public.enforce_test_session_lifecycle()          set search_path = '';
alter function public.enforce_test_session_insert_draft()       set search_path = '';
alter function public.enforce_test_readings_draft_only()        set search_path = '';
alter function public.enforce_diagnostic_result_rules()         set search_path = '';
alter function public.reject_modification()                     set search_path = '';
alter function public.save_diagnostic_assessment(uuid, uuid, integer, text, text, text, jsonb) set search_path = '';

revoke all on function public.set_updated_at()                      from public, anon, authenticated;
revoke all on function public.enforce_reference_profile_lifecycle() from public, anon, authenticated;
revoke all on function public.enforce_reference_limits_draft_only() from public, anon, authenticated;
revoke all on function public.enforce_test_session_lifecycle()      from public, anon, authenticated;
revoke all on function public.enforce_test_session_insert_draft()   from public, anon, authenticated;
revoke all on function public.enforce_test_readings_draft_only()    from public, anon, authenticated;
revoke all on function public.enforce_diagnostic_result_rules()     from public, anon, authenticated;
revoke all on function public.reject_modification()                 from public, anon, authenticated;
