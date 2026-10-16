-- =====================================================================================================================
-- replace_baldor_reference_draft.sql — removes ONE earlier UNAPPROVED draft created by seed_baldor_reference_drafts.sql so the
-- current version of that script can be run. Run in the Supabase SQL Editor. Do this only if an older draft already exists
-- (the seed never modifies an existing profile, so it would otherwise leave the old content in place).
--
-- WHAT IT TOUCHES: exactly the profile with id bab00003-0000-4000-8000-000000000001 owned by YOUR user, and only its limits.
-- WHAT IT REFUSES (raises, nothing changes): a missing user id; the profile being approved or retired; any stored assessment
--   (diagnostic_results) referencing it. It never touches other profiles, motors, tests, readings, results or findings.
-- One DO block = one transaction. No TRUNCATE, no ALTER, no trigger or RLS change. An approved profile can never be removed by this.
--
-- BEFORE YOU RUN IT: replace PUT-YOUR-AUTH-USER-UUID-HERE (Authentication -> Users -> "User UID"). Then run the seed script again.
-- =====================================================================================================================

do $replace$
declare
  v_user_id_text text := 'PUT-YOUR-AUTH-USER-UUID-HERE';   -- >>> EDIT <<<
  v_profile_id   uuid := 'bab00003-0000-4000-8000-000000000001';
  v_uid          uuid;
  v_status       text;
  v_refs         integer;
  v_limits       integer;
begin
  begin
    v_uid := v_user_id_text::uuid;
  exception when invalid_text_representation then
    raise exception 'Edit the script first: replace PUT-YOUR-AUTH-USER-UUID-HERE with your User UID.';
  end;

  select approval_status into v_status from public.reference_profiles where id = v_profile_id and owner_id = v_uid;
  if not found then
    raise notice 'No Baldor draft profile exists for this user. Nothing to remove; run the seed script.';
    return;
  end if;
  if v_status <> 'draft' then
    raise exception 'The profile is % (not draft). It is immutable and is NOT removed. Create a new version in the app instead.', v_status;
  end if;

  select count(*) into v_refs from public.diagnostic_results where reference_profile_id = v_profile_id;
  if v_refs > 0 then
    raise exception 'Refusing: % stored assessment(s) reference this profile.', v_refs;
  end if;

  delete from public.reference_limits where reference_profile_id = v_profile_id and owner_id = v_uid;
  get diagnostics v_limits = row_count;
  delete from public.reference_profiles where id = v_profile_id and owner_id = v_uid and approval_status = 'draft';

  raise notice 'Removed the draft profile and its % limit(s). Now run seed_baldor_reference_drafts.sql.', v_limits;
end
$replace$;
