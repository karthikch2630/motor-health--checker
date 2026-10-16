-- 010_enforce_submitted_session_immutability.sql
-- Closes the gap found in Phase 5: migrations 005/006 froze a test session and its readings only once it
-- was `assessed`, so a `submitted` test could still be altered through direct API calls.
--
-- New rules (enforced by triggers, on top of the existing ownership / RLS policies):
--   * A session can only be INSERTED as `draft`.
--   * draft     : editable; may be submitted (needs at least one reading) or deleted.
--   * submitted : immutable. The ONLY permitted change is submitted -> assessed, with every other column
--                 unchanged and at least one diagnostic result already stored.
--   * assessed  : immutable.
--   * Readings can be inserted / updated / deleted only while their session is `draft`.
--   * A draft can no longer jump straight to `assessed`.
-- Assessing a submitted test is unaffected: diagnostic_results / diagnostic_findings inserts (migrations 007/008)
-- are allowed for submitted and assessed sessions.
--
-- This migration REPLACES functions/triggers created by 005 and 006 (it does not edit those files), so it is safe
-- to apply on a database where 001-009 were already applied. Apply it once, after 009.
-- Existing rows are not rewritten. If a database already contains `submitted` sessions without readings,
-- they stay as they are; the new checks apply to future changes only.

-- ------------------------------------------------------------------ test_sessions: lifecycle
create or replace function public.enforce_test_session_lifecycle()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Only draft test sessions can be deleted (session % is %)', old.id, old.status
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  -- UPDATE
  if old.status in ('submitted', 'assessed') then
    -- The single legitimate change: recording that a submitted test has been assessed.
    if old.status = 'submitted'
       and new.status = 'assessed'
       and (new.id, new.owner_id, new.motor_id, new.test_timestamp, new.operating_conditions,
            new.measurement_method, new.notes, new.created_at)
           is not distinct from
           (old.id, old.owner_id, old.motor_id, old.test_timestamp, old.operating_conditions,
            old.measurement_method, old.notes, old.created_at)
       and exists (select 1 from public.diagnostic_results where test_session_id = new.id) then
      return new;
    end if;
    raise exception '% test session % is immutable', initcap(old.status), old.id
      using errcode = 'check_violation';
  end if;

  -- old.status = 'draft'
  if new.motor_id <> old.motor_id or new.owner_id <> old.owner_id then
    raise exception 'Motor and owner of a test session cannot be changed' using errcode = 'check_violation';
  end if;

  if new.status = 'assessed' then
    raise exception 'Test session % must be submitted before it can be assessed', new.id
      using errcode = 'check_violation';
  end if;

  if new.status = 'submitted' and not exists (
    select 1 from public.test_readings where test_session_id = new.id
  ) then
    raise exception 'Test session % has no readings and cannot be submitted', new.id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
-- The existing trigger test_sessions_lifecycle (migration 005) keeps pointing at this function name.

-- ------------------------------------------------------------------ test_sessions: insert as draft only
create or replace function public.enforce_test_session_insert_draft()
returns trigger
language plpgsql
as $$
begin
  if new.status <> 'draft' then
    raise exception 'A test session must be created as a draft (got %)', new.status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger test_sessions_insert_draft_only
  before insert on public.test_sessions
  for each row execute function public.enforce_test_session_insert_draft();

-- ------------------------------------------------------------------ test_readings: draft sessions only
create or replace function public.enforce_test_readings_draft_only()
returns trigger
language plpgsql
as $$
declare
  sids uuid[];
  sid uuid;
  st text;
begin
  if tg_op = 'INSERT' then
    sids := array[new.test_session_id];
  elsif tg_op = 'DELETE' then
    sids := array[old.test_session_id];
  else
    sids := array[old.test_session_id, new.test_session_id];
  end if;

  foreach sid in array sids loop
    select status into st from public.test_sessions where id = sid;
    -- A missing session is rejected by the foreign key; only existing non-draft sessions are blocked here.
    if st is not null and st <> 'draft' then
      raise exception 'Readings of % test session % cannot be changed', st, sid
        using errcode = 'check_violation';
    end if;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger test_readings_unassessed_only on public.test_readings;
drop function public.enforce_test_readings_unassessed_only();

create trigger test_readings_draft_only
  before insert or update or delete on public.test_readings
  for each row execute function public.enforce_test_readings_draft_only();
