/**
 * Tests the PROPOSED migration database/migrations/014_add_workspace_members.sql and database/authorize_workspace_member.sql on PGlite
 * (migrations 001-013 + 014). Not Supabase: it proves the SQL we would ship, not a hosted project. All data is SYNTHETIC.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

const OWNER = '11111111-1111-1111-1111-111111111111'
const MEMBER = '2dbf7437-81e6-42f9-bb8a-36762c0d4861'
const STRANGER = '33333333-3333-3333-3333-333333333333'
const OTHER = '44444444-4444-4444-4444-444444444444'
const root = process.cwd()
const migration014 = readFileSync(join(root, 'database/migrations/014_add_workspace_members.sql'), 'utf8')
const grantScript = (owner: string, member: string) =>
  readFileSync(join(root, 'database/authorize_workspace_member.sql'), 'utf8')
    .replace('PUT-OWNER-AUTH-USER-UUID-HERE', owner)
    .replace('PUT-MEMBER-AUTH-USER-UUID-HERE', member)

let db: PGlite
const as = async (uid: string | null) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${uid === null ? 'anon' : 'authenticated'}`)
}
const admin = () => db.exec('reset role')
const q = (sql: string, p: unknown[] = []) => db.query<Record<string, unknown>>(sql, p)
const one = async (sql: string, p: unknown[] = []) => (await q(sql, p)).rows[0]
const count = async (table: string) => Number((await one(`select count(*)::int n from ${table}`)).n)

const finding = [{ parameter_code: 'voltage', rule_code: 'LIMIT_ABOVE_UPPER', severity: 'CRITICAL', observed_value: 5, observed_unit: 'V', applicable_limit: 1, finding_description: 'synthetic', possible_causes: [], recommended_action: 'inspect' }]
const ids: Record<string, string> = {}

async function newSubmittedSession(motorId: string) {
  const s = (await one(`insert into test_sessions (motor_id) values ($1) returning id`, [motorId])).id as string
  await q(`insert into test_readings (test_session_id,parameter_code,measured_value,measured_unit,normalized_value,normalized_unit) values ($1,'voltage',5,'V',5,'V')`, [s])
  await q(`update test_sessions set status='submitted' where id=$1`, [s])
  return s
}
const assess = (session: string) =>
  q(`select public.save_diagnostic_assessment($1,$2,1,'t-1','FAULT_SUSPECTED','s',$3::jsonb) as r`, [session, ids.profile, JSON.stringify(finding)])

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    insert into auth.users values ('${OWNER}'), ('${MEMBER}'), ('${STRANGER}'), ('${OTHER}');
  `)
  const dir = join(root, 'database', 'migrations')
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql') && !x.startsWith('014_')).sort()) await db.exec(readFileSync(join(dir, f), 'utf8'))

  // Existing workspace of OWNER, created BEFORE the proposed migration (as on the hosted project).
  await admin()
  await db.exec(`select set_config('request.jwt.claim.sub', '${OWNER}', false); set role authenticated`)
  ids.motor = (await one(`insert into motors (motor_tag,name,motor_type,supply_type) values ('MTR-X','m','induction',null) returning id`)).id as string
  ids.profile = (await one(`insert into reference_profiles (name,motor_type,source_name,version,applicable_specs) values ('P','induction','synthetic',1,'{"supply_type":"line"}') returning id`)).id as string
  await q(`insert into reference_limits (reference_profile_id,parameter_code,parameter_name,unit,upper_limit,source_note) values ($1,'voltage','Voltage','V',1,'synthetic')`, [ids.profile])
  await q(`update reference_profiles set approval_status='approved' where id=$1`, [ids.profile])
  ids.session = await newSubmittedSession(ids.motor)
  await assess(ids.session)
  await admin()
  await db.exec(migration014) // the proposed migration, applied to an already populated database
}, 120_000)

/** Everything in the workspace, as an admin sees it: used to prove the grant changes no data. */
async function fingerprint() {
  await admin()
  const out: string[] = []
  for (const t of ['motors', 'reference_profiles', 'reference_limits', 'test_sessions', 'test_readings', 'diagnostic_results', 'diagnostic_findings']) {
    out.push(JSON.stringify((await q(`select * from ${t} order by id`)).rows))
  }
  return out.join('\n')
}

describe('before any grant', () => {
  it('the existing owner keeps full access to the workspace created before the migration', async () => {
    await as(OWNER)
    expect(await count('motors')).toBe(1)
    expect(await count('reference_profiles')).toBe(1)
    expect(await count('diagnostic_results')).toBe(1)
    expect(await count('diagnostic_findings')).toBe(1)
  })
  it('a not-yet-authorized user sees nothing, even though the migration is applied', async () => {
    for (const uid of [MEMBER, STRANGER]) {
      await as(uid)
      for (const t of ['motors', 'reference_profiles', 'reference_limits', 'test_sessions', 'test_readings', 'diagnostic_results', 'diagnostic_findings']) {
        expect(await count(t), `${uid} ${t}`).toBe(0)
      }
    }
  })
})

describe('workspace_members is not reachable through the API', () => {
  it('no API role can read or write it', async () => {
    for (const uid of [OWNER, MEMBER, STRANGER]) {
      await as(uid)
      await expect(q(`select * from workspace_members`)).rejects.toThrow(/permission denied/)
      await expect(q(`insert into workspace_members (member_id, owner_id) values ($1,$2)`, [STRANGER, OWNER])).rejects.toThrow(/permission denied/)
      await expect(q(`delete from workspace_members`)).rejects.toThrow(/permission denied/)
    }
    await as(null)
    await expect(q(`select * from workspace_members`)).rejects.toThrow(/permission denied/)
    await expect(q(`select public.current_workspace_owner()`)).rejects.toThrow(/permission denied/)
  })
  it('RLS is enabled on it, and the function has a fixed search_path and no public/anon execute', async () => {
    await admin()
    expect((await one(`select relrowsecurity from pg_class where relname='workspace_members'`)).relrowsecurity).toBe(true)
    const fn = await one(`select prosecdef, proconfig, has_function_privilege('anon','public.current_workspace_owner()','execute') anon_x, has_function_privilege('authenticated','public.current_workspace_owner()','execute') auth_x from pg_proc where proname='current_workspace_owner'`)
    expect(fn).toMatchObject({ prosecdef: true, anon_x: false, auth_x: true })
    expect(String(fn.proconfig)).toMatch(/search_path=""/)
  })
})

describe('authorize_workspace_member.sql', () => {
  it('refuses the unedited placeholders, identical ids, unknown users, and a member who already owns data', async () => {
    await admin()
    await expect(db.exec(readFileSync(join(root, 'database/authorize_workspace_member.sql'), 'utf8'))).rejects.toThrow(/Edit the script first/)
    await expect(db.exec(grantScript(OWNER, OWNER))).rejects.toThrow(/must be different/)
    await expect(db.exec(grantScript(OWNER, '99999999-9999-9999-9999-999999999999'))).rejects.toThrow(/No Auth user/)
    await expect(db.exec(grantScript(MEMBER, OWNER))).rejects.toThrow(/already owns/) // OWNER owns data, so cannot become a member
    expect(await count('workspace_members')).toBe(0)
  })

  it('grants exactly one member, changes no data, and is idempotent', async () => {
    const before = await fingerprint()
    await admin()
    await db.exec(grantScript(OWNER, MEMBER))
    await db.exec(grantScript(OWNER, MEMBER)) // second run: no error, no duplicate
    expect(await fingerprint()).toBe(before)
    expect((await q(`select member_id, owner_id, can_approve from workspace_members`)).rows).toEqual([{ member_id: MEMBER, owner_id: OWNER, can_approve: false }]) // approval authority is OFF by default
  })

  it('refuses chaining and re-mapping to a different owner', async () => {
    await admin()
    await expect(db.exec(grantScript(MEMBER, STRANGER))).rejects.toThrow(/chain/) // MEMBER is already a member
    await expect(db.exec(grantScript(OTHER, MEMBER))).rejects.toThrow(/different owner/)
  })
})

describe('after the grant', () => {
  it('the member sees the same workspace: motors, profile + limits, tests, readings, results, findings, revisions', async () => {
    await as(MEMBER)
    expect(await count('motors')).toBe(1)
    expect(await count('reference_profiles')).toBe(1)
    expect(await count('reference_limits')).toBe(1)
    expect(await count('test_sessions')).toBe(1)
    expect(await count('test_readings')).toBe(1)
    expect(await count('diagnostic_results')).toBe(1)
    expect(await count('diagnostic_findings')).toBe(1)
    expect((await one(`select revision, overall_status, reference_profile_version from diagnostic_results`))).toMatchObject({ revision: 1, overall_status: 'FAULT_SUSPECTED', reference_profile_version: 1 })
  })

  it('the original owner still has the same access with the same ids', async () => {
    await as(OWNER)
    expect((await one(`select id from motors`)).id).toBe(ids.motor)
    expect((await one(`select id, approval_status from reference_profiles`))).toMatchObject({ id: ids.profile, approval_status: 'approved' })
    expect(await count('diagnostic_results')).toBe(1)
  })

  it('an unrelated user still sees nothing and cannot write into the workspace', async () => {
    await as(STRANGER)
    for (const t of ['motors', 'reference_profiles', 'reference_limits', 'test_sessions', 'test_readings', 'diagnostic_results', 'diagnostic_findings']) expect(await count(t)).toBe(0)
    await expect(q(`insert into motors (owner_id,motor_tag,name,motor_type) values ($1,'EVIL','x','induction')`, [OWNER])).rejects.toThrow(/row-level security/)
    await expect(q(`insert into test_sessions (motor_id) values ($1)`, [ids.motor])).rejects.toThrow(/foreign key/)
    expect((await q(`update motors set name='hijack' where id=$1 returning id`, [ids.motor])).rows).toHaveLength(0)
    expect((await q(`delete from reference_profiles where id=$1 returning id`, [ids.profile])).rows).toHaveLength(0)
    await expect(assess(ids.session)).rejects.toThrow()
  })

  it('the member works inside the owner workspace: new rows belong to the owner, new tests attach to the owner motors', async () => {
    await as(MEMBER)
    const m2 = (await one(`insert into motors (motor_tag,name,motor_type) values ('MTR-Y','m','induction') returning id, owner_id`))
    expect(m2.owner_id).toBe(OWNER)
    const s2 = await newSubmittedSession(ids.motor)
    const r = await assess(s2)
    expect((r.rows[0].r as { revision: number }).revision).toBe(1)
    expect((await one(`select owner_id from diagnostic_results where test_session_id=$1`, [s2])).owner_id).toBe(OWNER)
    await as(OWNER)
    expect(await count('motors')).toBe(2)
    expect(await count('diagnostic_results')).toBe(2)
  })

  it('the member cannot forge ownership: rows stamped with their own or a third id are refused', async () => {
    await as(MEMBER)
    await expect(q(`insert into motors (owner_id,motor_tag,name,motor_type) values ($1,'F1','x','induction')`, [MEMBER])).rejects.toThrow(/row-level security/)
    await expect(q(`insert into motors (owner_id,motor_tag,name,motor_type) values ($1,'F2','x','induction')`, [STRANGER])).rejects.toThrow(/row-level security/)
  })

  it('all integrity rules still bind the member: submitted tests, approved profiles and stored results stay immutable', async () => {
    await as(MEMBER)
    await expect(q(`update test_sessions set notes='x' where id=$1`, [ids.session])).rejects.toThrow(/immutable/)
    await expect(q(`update reference_profiles set name='x' where id=$1`, [ids.profile])).rejects.toThrow(/immutable/)
    await expect(q(`insert into reference_limits (reference_profile_id,parameter_code,parameter_name,unit,upper_limit,source_note) values ($1,'current','Current','A',1,'s')`, [ids.profile])).rejects.toThrow(/cannot be changed/)
    await expect(q(`update diagnostic_results set overall_status='NORMAL'`)).rejects.toThrow(/permission denied/)
    await expect(q(`delete from diagnostic_findings`)).rejects.toThrow(/permission denied/)
    await expect(q(`delete from reference_profiles where id=$1`, [ids.profile])).rejects.toThrow(/Only draft/)
  })

  it('the original assessment revision is byte-for-byte what it was', async () => {
    await admin()
    const r = await one(`select revision, overall_status, summary, diagnostic_engine_version, reference_profile_version from diagnostic_results where test_session_id=$1`, [ids.session])
    expect(r).toMatchObject({ revision: 1, overall_status: 'FAULT_SUSPECTED', summary: 's', diagnostic_engine_version: 't-1', reference_profile_version: 1 })
  })
})

describe('approval authority is separate from ordinary membership', () => {
  const newDraftProfile = async (name: string) => {
    const id = (await one(`insert into reference_profiles (name,motor_type,source_name,version) values ($1,'induction','synthetic',1) returning id`, [name])).id as string
    await q(`insert into reference_limits (reference_profile_id,parameter_code,parameter_name,unit,upper_limit,source_note) values ($1,'voltage','Voltage','V',1,'synthetic')`, [id])
    return id
  }

  it('a member without authority can create and edit drafts, but cannot approve them', async () => {
    await as(MEMBER)
    const id = await newDraftProfile('M-draft-1')
    await q(`update reference_profiles set description='edited by member' where id=$1`, [id])
    await expect(q(`update reference_profiles set approval_status='approved' where id=$1`, [id])).rejects.toThrow(/requires approval authority/)
    expect((await one(`select approval_status from reference_profiles where id=$1`, [id])).approval_status).toBe('draft')
    ids.memberDraft = id
  })

  it('a member without authority cannot retire an approved profile', async () => {
    await as(MEMBER)
    await expect(q(`update reference_profiles set approval_status='retired', effective_to=now() where id=$1`, [ids.profile])).rejects.toThrow(/requires approval authority/)
    expect((await one(`select approval_status from reference_profiles where id=$1`, [ids.profile])).approval_status).toBe('approved')
  })

  it('the workspace owner keeps approval authority', async () => {
    await as(OWNER)
    const id = await newDraftProfile('O-draft-1')
    await q(`update reference_profiles set approval_status='approved' where id=$1`, [id])
    expect((await one(`select approval_status from reference_profiles where id=$1`, [id])).approval_status).toBe('approved')
  })

  it('an unrelated user cannot approve the workspace profiles (they cannot even see them)', async () => {
    await as(STRANGER)
    expect((await q(`update reference_profiles set approval_status='approved' where id=$1 returning id`, [ids.memberDraft])).rows).toHaveLength(0)
  })

  it('authority is granted only by the administrator, takes effect at once, and can be withdrawn', async () => {
    await as(MEMBER)
    await expect(q(`update workspace_members set can_approve=true`)).rejects.toThrow(/permission denied/)
    await admin()
    await q(`update workspace_members set can_approve=true where member_id=$1`, [MEMBER])
    await as(MEMBER)
    await q(`update reference_profiles set approval_status='approved' where id=$1`, [ids.memberDraft])
    expect((await one(`select approval_status from reference_profiles where id=$1`, [ids.memberDraft])).approval_status).toBe('approved')
    await admin()
    await q(`update workspace_members set can_approve=false where member_id=$1`, [MEMBER])
    await as(MEMBER)
    await expect(q(`update reference_profiles set approval_status='retired', effective_to=now() where id=$1`, [ids.memberDraft])).rejects.toThrow(/requires approval authority/)
  })

  it('the existing approved profile and its dates are untouched by all of this', async () => {
    await admin()
    expect(await one(`select approval_status, version, effective_from, effective_to from reference_profiles where id=$1`, [ids.profile])).toEqual({ approval_status: 'approved', version: 1, effective_from: null, effective_to: null })
  })
})

describe('attribution: the real user is recorded, whatever the owner_id', () => {
  const events = async (where = '') => (await q(`select action, actor_id, owner_id, table_name, record_id, detail from audit_events ${where} order by id`)).rows

  it('the member actions are logged with the member as actor and the workspace owner as owner', async () => {
    await as(OWNER)
    const mine = await events(`where actor_id='${MEMBER}'`)
    expect(mine.map((e) => e.action)).toEqual(expect.arrayContaining(['motor.created', 'test.created', 'test.submitted', 'assessment.saved', 'test.assessed', 'profile.created']))
    expect(mine.every((e) => e.owner_id === OWNER)).toBe(true)
    expect(mine.find((e) => e.action === 'assessment.saved')!.detail).toMatchObject({ revision: 1, overall_status: 'FAULT_SUSPECTED', reference_profile_version: 1 })
  })

  it('profile approvals are attributed to whoever approved', async () => {
    await as(OWNER)
    const approvals = await events(`where action='profile.approved'`)
    expect(approvals.map((e) => e.actor_id).sort()).toEqual([MEMBER, OWNER].sort())
    expect(approvals.every((e) => (e.detail as { from: string }).from === 'draft')).toBe(true)
  })

  it('actor_id comes from the session: nobody can insert, change or delete events, not even an administrator', async () => {
    await as(MEMBER)
    await expect(q(`insert into audit_events (owner_id, actor_id, action, table_name) values ($1,$1,'x','x')`, [OWNER])).rejects.toThrow(/permission denied/)
    await expect(q(`update audit_events set actor_id=$1`, [OWNER])).rejects.toThrow(/permission denied/)
    await expect(q(`delete from audit_events`)).rejects.toThrow(/permission denied/)
    await admin()
    await expect(q(`update audit_events set actor_id=null`)).rejects.toThrow(/append-only/)
    await expect(q(`delete from audit_events`)).rejects.toThrow(/append-only/)
  })

  it('only the workspace can read its own audit trail; an unrelated user and anon cannot', async () => {
    await as(MEMBER)
    expect((await events()).length).toBeGreaterThan(0)
    await as(STRANGER)
    expect(await count('audit_events')).toBe(0)
    await as(null)
    await expect(q(`select * from audit_events`)).rejects.toThrow(/permission denied/)
  })

  it('events before the migration are not recorded (documented limitation); the owner later actions are logged', async () => {
    await admin()
    const old = await q(`select count(*)::int n from audit_events where record_id=$1 and action in ('motor.created','test.created')`, [ids.motor])
    expect(old.rows[0].n).toBe(0)
    await as(OWNER)
    expect((await events(`where actor_id='${OWNER}'`)).length).toBeGreaterThan(0)
  })

  it('audit triggers do not break the immutability rules', async () => {
    await as(MEMBER)
    await expect(q(`update test_sessions set notes='x' where id=$1`, [ids.session])).rejects.toThrow(/immutable/)
  })
})

describe('revoking', () => {
  it('deleting the membership row removes the member access at once; the owner and all rows (including the ones the member created) stay', async () => {
    await admin()
    await q(`delete from workspace_members where member_id=$1`, [MEMBER])
    await as(MEMBER)
    expect(await count('motors')).toBe(0)
    expect(await count('diagnostic_results')).toBe(0)
    await as(OWNER)
    expect(await count('motors')).toBe(2)
    expect(await count('diagnostic_results')).toBe(2)
  })

  it('the audit trail of the revoked member is kept and still readable by the owner, not by the member', async () => {
    await as(OWNER)
    expect(Number((await one(`select count(*)::int n from audit_events where actor_id='${MEMBER}'`)).n)).toBeGreaterThan(0)
    await as(MEMBER)
    expect(await count('audit_events')).toBe(0)
  })

  it('a revoked member cannot approve or retire anything (they see no profiles)', async () => {
    await as(MEMBER)
    expect((await q(`update reference_profiles set approval_status='retired' returning id`)).rows).toHaveLength(0)
  })
})
