-- =====================================================================================================================
-- authorize_workspace_member.sql  (PROPOSED - run only AFTER migration 014 is applied, and only with your explicit decision)
-- Authorizes ONE existing Supabase Auth user to work in another user's workspace. Run in the Supabase SQL Editor (admin role);
-- never from the frontend. Idempotent. Touches only public.workspace_members: no motor, profile, test or result is read or changed.
--
-- BEFORE YOU RUN IT, edit the lines marked  >>> EDIT <<<  (Authentication -> Users -> "User UID"):
--   v_owner_text   : the user who owns the existing data (your original account)
--   v_member_text  : the user to authorize
--   v_can_approve  : false (default) = the member works normally but CANNOT approve or retire reference profiles.
--                    true = the member also holds approval authority. Approval is irreversible; grant it deliberately.
--
-- It REFUSES (nothing changes) when: either id is not a valid existing Auth user; owner and member are the same; the owner is
-- itself a member of another workspace; the member already owns any data (granting would hide it from them); or the member
-- is already mapped to a DIFFERENT owner (remove that row deliberately first).
-- Running it again for the same pair updates can_approve to the value above (and says so).
--
-- Change approval authority later:  update public.workspace_members set can_approve = true|false where member_id = '<member uid>';
-- Revoke access entirely:           delete from public.workspace_members where member_id = '<member uid>';   (data stays with the owner)
-- =====================================================================================================================

do $grant$
declare
  v_owner_text   text    := 'PUT-OWNER-AUTH-USER-UUID-HERE';    -- >>> EDIT <<<
  v_member_text  text    := 'PUT-MEMBER-AUTH-USER-UUID-HERE';   -- >>> EDIT <<<
  v_can_approve  boolean := false;                              -- >>> EDIT <<<
  v_owner    uuid;
  v_member   uuid;
  v_existing uuid;
  v_owned    integer;
begin
  begin
    v_owner  := v_owner_text::uuid;
    v_member := v_member_text::uuid;
  exception when invalid_text_representation then
    raise exception 'Edit the script first: replace both PUT-...-HERE placeholders with Auth User UIDs.';
  end;

  if v_owner = v_member then raise exception 'Owner and member must be different users.'; end if;
  if not exists (select 1 from auth.users where id = v_owner)  then raise exception 'No Auth user % (owner).', v_owner; end if;
  if not exists (select 1 from auth.users where id = v_member) then raise exception 'No Auth user % (member).', v_member; end if;
  if exists (select 1 from public.workspace_members where member_id = v_owner) then
    raise exception 'The owner is itself a member of another workspace; refusing to chain workspaces.';
  end if;

  select (select count(*) from public.motors where owner_id = v_member)
       + (select count(*) from public.reference_profiles where owner_id = v_member)
       + (select count(*) from public.test_sessions where owner_id = v_member)
    into v_owned;
  if v_owned > 0 then
    raise exception 'The member already owns % record(s) in their own workspace. Granting access would hide them. Resolve that first.', v_owned;
  end if;

  select owner_id into v_existing from public.workspace_members where member_id = v_member;
  if v_existing is not null and v_existing <> v_owner then
    raise exception 'The member is already mapped to a different owner (%). Remove that row deliberately first.', v_existing;
  end if;

  insert into public.workspace_members (member_id, owner_id, can_approve) values (v_member, v_owner, v_can_approve)
  on conflict (member_id) do update set can_approve = excluded.can_approve;
  raise notice 'Member % may use the workspace of owner %. Approval authority: %.', v_member, v_owner, v_can_approve;
end
$grant$;
