-- 005_create_test_sessions.sql
-- One row per motor test. Status flow: draft -> submitted -> assessed.
-- An assessed session is immutable. Motors with tests cannot be deleted
-- (ON DELETE RESTRICT) so history is never lost implicitly.

create table public.test_sessions (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null default auth.uid(),
  motor_id              uuid not null,
  test_timestamp        timestamptz not null default now(),
  operating_conditions  jsonb not null default '{}'::jsonb,
  measurement_method    text,
  notes                 text,
  status                text not null default 'draft',
  created_at            timestamptz not null default now(),

  constraint test_sessions_motor_fk
    foreign key (motor_id, owner_id)
    references public.motors (id, owner_id) on delete restrict,
  constraint test_sessions_id_owner_key unique (id, owner_id),
  constraint test_sessions_status_valid check (status in ('draft', 'submitted', 'assessed')),
  constraint test_sessions_conditions_object check (jsonb_typeof(operating_conditions) = 'object')
);

create index test_sessions_motor_id_idx on public.test_sessions (motor_id);
create index test_sessions_test_timestamp_idx on public.test_sessions (test_timestamp desc);

alter table public.test_sessions enable row level security;

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

  if old.status = 'assessed' then
    raise exception 'Assessed test session % is immutable', old.id using errcode = 'check_violation';
  end if;

  if new.motor_id <> old.motor_id or new.owner_id <> old.owner_id then
    raise exception 'Motor and owner of a test session cannot be changed' using errcode = 'check_violation';
  end if;

  if old.status = 'submitted' and new.status = 'draft' then
    raise exception 'A submitted test session cannot return to draft' using errcode = 'check_violation';
  end if;

  -- Never mark a session assessed unless an assessment actually exists.
  if new.status = 'assessed' and not exists (
    select 1 from public.diagnostic_results where test_session_id = new.id
  ) then
    raise exception 'Test session % has no diagnostic result and cannot be marked assessed', new.id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- diagnostic_results is created in migration 007; the reference above is resolved at run time.
create trigger test_sessions_lifecycle
  before update or delete on public.test_sessions
  for each row execute function public.enforce_test_session_lifecycle();
