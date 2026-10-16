-- 009_rls_policies_and_grants.sql
-- Access model (single authorized user, Supabase Auth):
--   * anon has NO access to any application table.
--   * authenticated users can only touch rows where owner_id = auth.uid().
--   * Child tables carry their own owner_id and use composite foreign keys to the
--     parent's (id, owner_id), so a row can never be linked to another owner's
--     parent, and no policy needs a join/subquery that could leak data.
--   * parameter_definitions is global metadata: readable by authenticated users,
--     not writable through the API (change it with migrations).
--   * Issued assessments (diagnostic_results, diagnostic_findings) are
--     insert/select only. API users cannot update or delete them.
--
-- Public sign-ups must also be disabled in the Supabase dashboard (see README).
-- Policies use (select auth.uid()) so the value is evaluated once per statement.

-- ---------------------------------------------------------------- grants
revoke all on public.motors, public.parameter_definitions, public.reference_profiles,
  public.reference_limits, public.test_sessions, public.test_readings,
  public.diagnostic_results, public.diagnostic_findings
  from anon, authenticated;

grant select, insert, update, delete on public.motors              to authenticated;
grant select                         on public.parameter_definitions to authenticated;
grant select, insert, update, delete on public.reference_profiles  to authenticated;
grant select, insert, update, delete on public.reference_limits    to authenticated;
grant select, insert, update, delete on public.test_sessions       to authenticated;
grant select, insert, update, delete on public.test_readings       to authenticated;
grant select, insert                 on public.diagnostic_results  to authenticated;
grant select, insert                 on public.diagnostic_findings to authenticated;

-- ---------------------------------------------------------------- policies
create policy motors_owner_all on public.motors
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy parameter_definitions_read on public.parameter_definitions
  for select to authenticated
  using (true);

create policy reference_profiles_owner_all on public.reference_profiles
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy reference_limits_owner_all on public.reference_limits
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy test_sessions_owner_all on public.test_sessions
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy test_readings_owner_all on public.test_readings
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy diagnostic_results_owner_select on public.diagnostic_results
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy diagnostic_results_owner_insert on public.diagnostic_results
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy diagnostic_findings_owner_select on public.diagnostic_findings
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy diagnostic_findings_owner_insert on public.diagnostic_findings
  for insert to authenticated
  with check (owner_id = (select auth.uid()));
