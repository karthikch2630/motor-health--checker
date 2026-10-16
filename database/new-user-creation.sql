do $grant$
declare
  v_owner_text   text    := '7086297d-c4b2-462f-8be1-490a90ea5ff5';
  v_member_text  text    := 'PASTE-NEW-USER-UID-HERE';
  v_can_approve  boolean := false;   -- false = cannot approve profiles; true = can
  v_owner uuid; v_member uuid; v_existing uuid; v_owned integer;
begin
  v_owner := v_owner_text::uuid;
  v_member := v_member_text::uuid;
  if v_owner = v_member then raise exception 'Owner and member must be different users.'; end if;
  if not exists (select 1 from auth.users where id = v_owner)  then raise exception 'No Auth user % (owner).', v_owner; end if;
  if not exists (select 1 from auth.users where id = v_member) then raise exception 'No Auth user % (member).', v_member; end if;
  select (select count(*) from public.motors where owner_id = v_member)
       + (select count(*) from public.reference_profiles where owner_id = v_member)
       + (select count(*) from public.test_sessions where owner_id = v_member) into v_owned;
  if v_owned > 0 then raise exception 'This user already owns % record(s) of their own. Resolve that first.', v_owned; end if;
  select owner_id into v_existing from public.workspace_members where member_id = v_member;
  if v_existing is not null and v_existing <> v_owner then raise exception 'Already mapped to a different owner.'; end if;
  insert into public.workspace_members (member_id, owner_id, can_approve) values (v_member, v_owner, v_can_approve)
  on conflict (member_id) do update set can_approve = excluded.can_approve;
end
$grant$;
