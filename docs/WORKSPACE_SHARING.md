# Sharing one workspace with a second authorized user (APPLIED 2026-10-16)

**Status:** migration `database/migrations/014_add_workspace_members.sql` was applied to the hosted project on 2026-10-16 (SQL Editor, once, result: Success). The owner then authorized one member (`2dbf7437-81e6-42f9-bb8a-36762c0d4861`, `can_approve = false`) with `database/authorize_workspace_member.sql`. Before/after row counts were identical (16 motors, 1 profile, 2 limits, 3 tests, 21 readings, 5 results, 5 findings). The file in `migrations/` is byte-identical to what was run (its header comment still says PROPOSED and names the old rollback path; the rollback script is now `database/rollback/014_rollback.sql`). Tests run on a local PostgreSQL engine (PGlite), not on the hosted project. Other files: `database/rollback/014_rollback.sql`, `database/authorize_workspace_member.sql`, `database/verify/workspace_sharing_check.sql`.

## How ownership works today
Every private table has `owner_id` (default `auth.uid()`), composite foreign keys `(id, owner_id)` and an owner-only RLS policy. A "workspace" is all rows with one `owner_id`. There was no membership model. `parameter_definitions` is the only shared table (read-only catalog).

## Permission model

| Capability | Workspace owner | Member (default) | Member with `can_approve` | Unrelated user / anon |
|---|---|---|---|---|
| View motors, profiles, limits, tests, readings, results, findings, audit trail | yes | yes | yes | no |
| Create/edit motors, create/edit **draft** profiles and limits, create/submit tests, run assessments | yes | yes | yes | no |
| **Approve** or **retire** a reference profile (irreversible) | yes | **no** (database refuses) | yes | no |
| Add / remove members, change `can_approve` | administrator only (SQL Editor) | no | no | no |
| Rewrite or delete audit events, stored results, submitted tests, approved profiles | nobody (append-only / immutable triggers) | | | |

Approval authority is enforced in the database (trigger `reference_profiles_approval_authority`), not only in the UI: a member without it gets "requires approval authority". Administrator sessions (SQL Editor, `auth.uid()` null) are allowed; API callers cannot reach the table without a user.
Recommendation: leave `can_approve = false` for the second user until you have discussed who may approve the NEMA profile.

## What 014 does
1. `workspace_members(member_id -> owner_id, can_approve)`: RLS on, no policies, all API privileges revoked. Administrator-only.
2. `current_workspace_owner()` (SECURITY DEFINER, empty `search_path`, EXECUTE for `authenticated` only): the mapped owner for a member, otherwise the caller's own id, so the original owner is unaffected.
3. `owner_id` defaults on the seven private tables and the nine private-table policies now use that function (same shape and strictness as migration 009). Rows keep their original `owner_id`, ids and revisions; a member's new rows are stamped with the owner's id so the composite keys keep working.
4. `current_user_can_approve()` + trigger `enforce_approval_authority` (see the table above).
5. `audit_events`: append-only (even administrators cannot update/delete), select-only for the workspace, written by SECURITY DEFINER triggers using the **real** `auth.uid()` of the session. A client cannot supply or forge the actor. Logged: motor created/updated/deleted; profile created/approved/retired/deleted; test created/submitted/assessed/deleted; assessment saved (revision, status, profile version).

Not changed: any data row or column, the lifecycle/immutability/append-only triggers, `save_diagnostic_assessment` (SECURITY INVOKER), the `parameter_definitions` policy, grants on the private tables, approval status, effective dates, supply types, diagnostic rules, historical results.

## Review results (checked by tests)
- All four functions 014 adds have an empty `search_path`; three are SECURITY DEFINER; none is executable by `anon`/`public`; only the two helpers evaluated as the caller are executable by `authenticated`. Tested with Supabase-style default grants on (new tables/functions granted to API roles by default), so the explicit revokes are exercised.
- No private-table policy or default uses a bare `auth.uid()`; foreign keys are byte-identical to before.
- A member cannot stamp rows with their own or a third id; a stranger cannot read, update, delete, insert into, or assess against the workspace.
- Revoking membership takes effect on the next statement (membership is checked in the database on every query), removes the member's access and approval ability, and deletes nothing: rows the member created stay with the owner, and the audit trail stays readable by the owner.

## Limitations
- Rows carry the owner's `owner_id`; "who" lives in `audit_events`, not on the row. Events **before** 014 are not recorded (everything earlier was created by the owner, the only user).
- Not logged: readings, limits and findings (children of logged records), and edits to a draft test or draft profile.
- A member has the same rights as the owner except approval authority; there is no read-only role.
- One workspace per member; the grant script refuses chaining and refuses a member who already owns data.
- The frontend does not yet show the audit trail (query it with `database/verify/workspace_sharing_check.sql`, query 8). A member without authority sees the message "You do not have approval authority in this workspace…" if they try to approve.
- Deleting a user in Supabase Auth cascades their membership row; their audit events remain (actor id kept, no foreign key).

## Rollback
`database/rollback/014_rollback.sql` (manual, one transaction): restores `auth.uid()` defaults and policies, drops the triggers/functions/`workspace_members`, keeps `audit_events` (optional drop at the end). No private row is touched; rows members created remain visible to the owner. Member mappings and `can_approve` flags are lost: record them first. Tested (rehearsal in `database/tests/workspace-rollback.test.ts`).
Revoking just one user does not need a rollback: `delete from public.workspace_members where member_id = '<uid>';`

## Verification and deployment steps (record of what was done; reuse for a further member by repeating steps 5-7)
1. **Record the "before" state:** run queries 1-4 of `database/verify/workspace_sharing_check.sql` in the SQL Editor; save the output.
2. Back up (Supabase dashboard -> Database -> Backups; free plans have no automatic backups: export manually).
3. `git mv database/migrations/014_add_workspace_members.sql database/migrations/`. Paste it into the SQL Editor and run it **once** (not idempotent). Expect "Success".
4. Run queries 6 and 7: every row `bare_auth_uid = false`, `workspace_members` privileges all false, new functions `anon_exec = false`.
5. Edit and run `database/authorize_workspace_member.sql`: owner = your existing User UID, member = `2dbf7437-81e6-42f9-bb8a-36762c0d4861`, `v_can_approve` = `false` (recommended). Expect a notice naming both ids.
6. Run queries 1-4 again: results must be **identical** to step 1. Query 5 shows the single membership row.
7. Sign in as yourself: same motors, profile (still approved, same dates), history. Sign in as the second user: the same data; try creating a draft (works) and approving a profile (refused).
8. After some use, query 8 shows the actions attributed to each account.
9. If anything is wrong: `delete from public.workspace_members ...` (stops sharing at once), or run `014_rollback.sql`.
