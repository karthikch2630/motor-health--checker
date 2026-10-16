/**
 * Database tests: applies ALL migrations in database/migrations to an in-memory PostgreSQL (PGlite) and checks
 * lifecycle rules, immutability, row-level security and the atomic assessment function.
 *
 * What this is NOT: it is not Supabase. Supabase's `auth` schema and API roles are stood in for below.
 * It proves the SQL we ship behaves as designed on real PostgreSQL semantics; it does not prove anything about
 * a hosted Supabase project (PostgREST, JWT handling, dashboard settings). All values are SYNTHETIC test data.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'

let db: PGlite

async function as(role: 'authenticated' | 'anon', uid = '') {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role ${role}`)
}
const asUser = (uid: string) => as('authenticated', uid)

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0]
}
const q = (sql: string, params: unknown[] = []) => db.query(sql, params)

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
    insert into auth.users values ('${A}'), ('${B}');
  `)
  const dir = join(process.cwd(), 'database', 'migrations')
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'))
  }
}, 60_000)

afterAll(async () => {
  await db.close()
})

// ---------------------------------------------------------------- fixtures (created as the signed-in user)
let seq = 0
async function newMotor() {
  seq++
  return (await one<{ id: string }>(`insert into motors (motor_tag,name,motor_type) values ('M-${seq}','m','induction') returning id`)).id
}
async function newDraft(motorId?: string) {
  const m = motorId ?? (await newMotor())
  return { motor: m, session: (await one<{ id: string }>(`insert into test_sessions (motor_id) values ($1) returning id`, [m])).id }
}
async function addReading(session: string, code = 'voltage', v = 1) {
  await q(
    `insert into test_readings (test_session_id,parameter_code,measured_value,measured_unit,normalized_value,normalized_unit) values ($1,$2,$3,'u',$3,'u')`,
    [session, code, v],
  )
}
async function newSubmitted() {
  const d = await newDraft()
  await addReading(d.session)
  await q(`update test_sessions set status='submitted' where id=$1`, [d.session])
  return d
}
async function approvedProfile() {
  seq++
  const p = (await one<{ id: string }>(`insert into reference_profiles (name,motor_type,source_name,version) values ('SYNTHETIC ${seq}','induction','synthetic',1) returning id`)).id
  await q(`insert into reference_limits (reference_profile_id,parameter_code,parameter_name,unit,upper_limit,source_note) values ($1,'voltage','Voltage','V',1,'synthetic')`, [p])
  await q(`update reference_profiles set approval_status='approved' where id=$1`, [p])
  return p
}
const finding = (over: Record<string, unknown> = {}) => ({
  parameter_code: 'voltage', rule_code: 'LIMIT_ABOVE_UPPER', severity: 'CRITICAL', observed_value: 5, observed_unit: 'V',
  applicable_limit: 1, finding_description: 'synthetic finding', possible_causes: [], recommended_action: 'inspect', ...over,
})
const assess = (session: string, profile: string | null, version: number | null, status: string, findings: unknown[]) =>
  q(`select public.save_diagnostic_assessment($1,$2,$3,'t-1',$4,'summary',$5::jsonb) as r`, [session, profile, version, status, JSON.stringify(findings)])

// ---------------------------------------------------------------- tests

describe('ownership and row-level security', () => {
  it('hides another user\'s data and refuses cross-owner writes', async () => {
    await asUser(A)
    const mA = await newMotor()
    const { session } = await newDraft(mA)
    await asUser(B)
    expect((await q(`select * from motors where id=$1`, [mA])).rows).toHaveLength(0)
    expect((await q(`select * from test_sessions where id=$1`, [session])).rows).toHaveLength(0)
    expect((await q(`update motors set name='x' where id=$1 returning id`, [mA])).rows).toHaveLength(0)
    await expect(q(`insert into test_sessions (motor_id) values ($1)`, [mA])).rejects.toThrow(/foreign key/)
    await expect(addReading(session)).rejects.toThrow(/foreign key|row-level/)
  })

  it('reference profiles and limits are owner-scoped: another user cannot see, update or assess against them', async () => {
    await asUser(A)
    const profile = await approvedProfile()
    await asUser(B)
    expect((await q(`select * from reference_profiles where id=$1`, [profile])).rows).toHaveLength(0)
    expect((await q(`select * from reference_limits where reference_profile_id=$1`, [profile])).rows).toHaveLength(0)
    expect((await q(`update reference_profiles set description='x' where id=$1 returning id`, [profile])).rows).toHaveLength(0)
    const mine = await newSubmitted()
    await expect(assess(mine.session, profile, 1, 'FAULT_SUSPECTED', [finding()])).rejects.toThrow()
    await asUser(A)
    expect((await q(`select * from reference_profiles where id=$1`, [profile])).rows).toHaveLength(1)
  })

  it('gives the anon role no access to application tables or the assessment function', async () => {
    await as('anon')
    await expect(q(`select * from motors`)).rejects.toThrow(/permission denied/)
    await expect(q(`select * from diagnostic_results`)).rejects.toThrow(/permission denied/)
    await expect(assess(A, null, null, 'INSUFFICIENT_DATA', [])).rejects.toThrow(/permission denied/)
  })

  it('has RLS enabled on every public table and a policy on every table except the deliberately deny-all workspace_members', async () => {
    await db.exec('reset role')
    expect((await q(`select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`)).rows).toEqual([])
    // workspace_members (migration 014) has RLS on, NO policies and no API privileges on purpose: only an administrator can use it.
    expect((await q(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname <> 'workspace_members' and not exists (select 1 from pg_policies p where p.tablename=c.relname)`)).rows).toEqual([])
    expect((await q(`select count(*)::int n from pg_policies where tablename='workspace_members'`)).rows[0]).toEqual({ n: 0 })
  })
})

describe('migration 010 — draft / submitted immutability', () => {
  it('only allows sessions to be created as drafts', async () => {
    await asUser(A)
    const m = await newMotor()
    await expect(q(`insert into test_sessions (motor_id,status) values ($1,'submitted')`, [m])).rejects.toThrow(/must be created as a draft/)
    await expect(q(`insert into test_sessions (motor_id,status) values ($1,'assessed')`, [m])).rejects.toThrow(/must be created as a draft/)
  })

  it('lets a draft be edited, filled with readings, submitted and (while draft) deleted', async () => {
    await asUser(A)
    const { session } = await newDraft()
    await expect(q(`update test_sessions set notes='n', operating_conditions='{"operator":"x"}' where id=$1 returning id`, [session])).resolves.toBeTruthy()
    await addReading(session, 'voltage', 5)
    await expect(q(`update test_readings set measured_value=6 where test_session_id=$1`, [session])).resolves.toBeTruthy()
    await expect(q(`delete from test_readings where test_session_id=$1`, [session])).resolves.toBeTruthy()
    await expect(q(`delete from test_sessions where id=$1`, [session])).resolves.toBeTruthy()
  })

  it('refuses to submit a test that has no readings', async () => {
    await asUser(A)
    const { session } = await newDraft()
    await expect(q(`update test_sessions set status='submitted' where id=$1`, [session])).rejects.toThrow(/no readings/)
  })

  it('freezes readings of a submitted test: no insert, update or delete', async () => {
    await asUser(A)
    const { session } = await newSubmitted()
    await expect(addReading(session, 'current')).rejects.toThrow(/Readings of submitted test session .* cannot be changed/)
    await expect(q(`update test_readings set measured_value=99 where test_session_id=$1`, [session])).rejects.toThrow(/cannot be changed/)
    await expect(q(`delete from test_readings where test_session_id=$1`, [session])).rejects.toThrow(/cannot be changed/)
    expect(Number((await one<{ v: string }>(`select measured_value v from test_readings where test_session_id=$1`, [session])).v)).toBe(1)
  })

  it('freezes the submitted session itself: no edits, no revert to draft, no motor change, no delete', async () => {
    await asUser(A)
    const { session } = await newSubmitted()
    const other = await newMotor()
    await expect(q(`update test_sessions set notes='x' where id=$1`, [session])).rejects.toThrow(/Submitted test session .* is immutable/)
    await expect(q(`update test_sessions set status='draft' where id=$1`, [session])).rejects.toThrow(/immutable/)
    await expect(q(`update test_sessions set motor_id=$2 where id=$1`, [session, other])).rejects.toThrow(/immutable/)
    await expect(q(`update test_sessions set test_timestamp=now() where id=$1`, [session])).rejects.toThrow(/immutable/)
    await expect(q(`delete from test_sessions where id=$1`, [session])).rejects.toThrow(/Only draft/)
  })

  it('does not allow a draft to skip straight to assessed', async () => {
    await asUser(A)
    const { session } = await newDraft()
    await expect(q(`update test_sessions set status='assessed' where id=$1`, [session])).rejects.toThrow(/must be submitted/)
  })

  it('allows submitted -> assessed only with a stored result and no other change', async () => {
    await asUser(A)
    const { session } = await newSubmitted()
    await expect(q(`update test_sessions set status='assessed' where id=$1`, [session])).rejects.toThrow(/immutable/) // no result yet
    await q(`insert into diagnostic_results (test_session_id,diagnostic_engine_version,overall_status) values ($1,'t','INSUFFICIENT_DATA')`, [session])
    await expect(q(`update test_sessions set status='assessed', notes='sneaky' where id=$1`, [session])).rejects.toThrow(/immutable/)
    await expect(q(`update test_sessions set status='assessed' where id=$1 returning id`, [session])).resolves.toBeTruthy()
    await expect(q(`update test_sessions set status='submitted' where id=$1`, [session])).rejects.toThrow(/immutable/)
  })

  it('still lets a submitted test receive its assessment result', async () => {
    await asUser(A)
    const { session } = await newSubmitted()
    await expect(q(`insert into diagnostic_results (test_session_id,diagnostic_engine_version,overall_status) values ($1,'t','INSUFFICIENT_DATA')`, [session])).resolves.toBeTruthy()
  })

  it('refuses to assess a draft', async () => {
    await asUser(A)
    const { session } = await newDraft()
    await expect(q(`insert into diagnostic_results (test_session_id,diagnostic_engine_version,overall_status) values ($1,'t','INSUFFICIENT_DATA')`, [session])).rejects.toThrow(/Draft test session/)
  })
})

describe('migration 011 — save_diagnostic_assessment (atomic persistence)', () => {
  it('stores result + findings and marks the session assessed in one call, recording profile id/version and engine version', async () => {
    await asUser(A)
    const { session } = await newSubmitted()
    const profile = await approvedProfile()
    const out = (await assess(session, profile, 1, 'FAULT_SUSPECTED', [finding(), finding({ rule_code: 'DATA_MISSING_READING', severity: 'INFO', parameter_code: 'current', observed_value: null, observed_unit: null, applicable_limit: null })])).rows[0] as { r: { result_id: string; revision: number } }
    expect(out.r.revision).toBe(1)
    const res = await one<Record<string, unknown>>(`select * from diagnostic_results where id=$1`, [out.r.result_id])
    expect(res).toMatchObject({ test_session_id: session, reference_profile_id: profile, reference_profile_version: 1, diagnostic_engine_version: 't-1', overall_status: 'FAULT_SUSPECTED', revision: 1 })
    expect((await q(`select * from diagnostic_findings where diagnostic_result_id=$1`, [out.r.result_id])).rows).toHaveLength(2)
    expect((await one<{ status: string }>(`select status from test_sessions where id=$1`, [session])).status).toBe('assessed')
  })

  it('reassessment adds a new revision and leaves the previous one untouched', async () => {
    await asUser(A)
    const { session } = await newSubmitted()
    const profile = await approvedProfile()
    const first = (await assess(session, profile, 1, 'WARNING', [finding({ severity: 'WARNING', rule_code: 'WARNING_ABOVE_UPPER' })])).rows[0] as { r: { result_id: string } }
    const before = await one(`select * from diagnostic_results where id=$1`, [first.r.result_id])
    const second = (await assess(session, null, null, 'INSUFFICIENT_DATA', [finding({ rule_code: 'PROFILE_NOT_AVAILABLE', severity: 'INFO', parameter_code: null, observed_value: null, observed_unit: null, applicable_limit: null })])).rows[0] as { r: { revision: number } }
    expect(second.r.revision).toBe(2)
    expect(await one(`select * from diagnostic_results where id=$1`, [first.r.result_id])).toEqual(before)
    expect((await q(`select * from diagnostic_findings where diagnostic_result_id=$1`, [first.r.result_id])).rows).toHaveLength(1)
    expect((await one<{ n: number }>(`select count(*)::int n from diagnostic_results where test_session_id=$1`, [session])).n).toBe(2)
  })

  it('is atomic: an invalid finding rolls back the result, the other findings and the session status', async () => {
    await asUser(A)
    const { session } = await newSubmitted()
    const profile = await approvedProfile()
    await expect(assess(session, profile, 1, 'WARNING', [finding({ severity: 'WARNING' }), finding({ severity: 'BOGUS' })])).rejects.toThrow(/check constraint/)
    expect((await one<{ n: number }>(`select count(*)::int n from diagnostic_results where test_session_id=$1`, [session])).n).toBe(0)
    expect((await q(`select 1 from diagnostic_findings`)).rows).toBeTruthy()
    expect((await one<{ status: string }>(`select status from test_sessions where id=$1`, [session])).status).toBe('submitted')
  })

  it('rolls back everything when the profile is not approved or the version is wrong', async () => {
    await asUser(A)
    const { session } = await newSubmitted()
    const draft = (await one<{ id: string }>(`insert into reference_profiles (name,motor_type,source_name,version) values ('SYNTHETIC draft','induction','s',1) returning id`)).id
    await expect(assess(session, draft, 1, 'NORMAL', [])).rejects.toThrow(/not approved/)
    const approved = await approvedProfile()
    await expect(assess(session, approved, 9, 'NORMAL', [])).rejects.toThrow(/foreign key/)
    expect((await one<{ n: number }>(`select count(*)::int n from diagnostic_results where test_session_id=$1`, [session])).n).toBe(0)
    expect((await one<{ status: string }>(`select status from test_sessions where id=$1`, [session])).status).toBe('submitted')
  })

  it('refuses drafts, unknown sessions and malformed findings', async () => {
    await asUser(A)
    const { session } = await newDraft()
    await expect(assess(session, null, null, 'INSUFFICIENT_DATA', [])).rejects.toThrow(/still a draft/)
    await expect(assess('99999999-9999-9999-9999-999999999999', null, null, 'INSUFFICIENT_DATA', [])).rejects.toThrow(/not found/)
    const sub = await newSubmitted()
    await expect(q(`select public.save_diagnostic_assessment($1,null,null,'t','INSUFFICIENT_DATA','s','{"a":1}'::jsonb)`, [sub.session])).rejects.toThrow(/JSON array/)
    await expect(q(`select public.save_diagnostic_assessment($1,null,null,'t','NORMAL','s','[]'::jsonb)`, [sub.session])).rejects.toThrow(/check constraint/) // NORMAL needs a profile
  })

  it('runs with the caller\'s privileges: another user cannot assess a test they cannot see', async () => {
    await asUser(A)
    const { session } = await newSubmitted()
    await asUser(B)
    await expect(assess(session, null, null, 'INSUFFICIENT_DATA', [])).rejects.toThrow(/not found/)
    await asUser(A)
    expect((await one<{ n: number }>(`select count(*)::int n from diagnostic_results where test_session_id=$1`, [session])).n).toBe(0)
  })

  it('keeps issued results append-only for API users', async () => {
    await asUser(A)
    const { session } = await newSubmitted()
    const out = (await assess(session, null, null, 'INSUFFICIENT_DATA', [finding({ rule_code: 'PROFILE_NOT_AVAILABLE', severity: 'INFO', parameter_code: null, observed_value: null, observed_unit: null, applicable_limit: null })])).rows[0] as { r: { result_id: string } }
    await expect(q(`update diagnostic_results set overall_status='NORMAL' where id=$1`, [out.r.result_id])).rejects.toThrow(/permission denied/)
    await expect(q(`delete from diagnostic_results where id=$1`, [out.r.result_id])).rejects.toThrow(/permission denied/)
    await expect(q(`update diagnostic_findings set severity='INFO'`)).rejects.toThrow(/permission denied/)
  })

  it('keeps a stored result traceable after the profile is retired and a new version is created', async () => {
    await asUser(A)
    const { session } = await newSubmitted()
    const profile = await approvedProfile()
    const out = (await assess(session, profile, 1, 'WARNING', [finding({ severity: 'WARNING', rule_code: 'WARNING_ABOVE_UPPER' })])).rows[0] as { r: { result_id: string } }
    const before = await one(`select * from diagnostic_results where id=$1`, [out.r.result_id])

    await q(`update reference_profiles set approval_status='retired', effective_to=now() where id=$1`, [profile])
    const name = (await one<{ name: string }>(`select name from reference_profiles where id=$1`, [profile])).name
    await q(`insert into reference_profiles (name,motor_type,source_name,version) values ($1,'induction','synthetic',2)`, [name])

    expect(await one(`select * from diagnostic_results where id=$1`, [out.r.result_id])).toEqual(before)
    expect((await one<{ v: number }>(`select version v from reference_profiles where id=$1`, [profile])).v).toBe(1)
    // a retired profile cannot back a new NORMAL/WARNING/FAULT assessment
    await expect(assess(session, profile, 1, 'WARNING', [])).rejects.toThrow(/not approved/)
  })
})

// ---------------------------------------------------------------- engine output -> database round trip
import { assessMotor, type EngineProfile, type EngineReading } from '../../src/lib/diagnostics'
import { toSaveArgs } from '../../src/lib/assessments'

describe('engine output is accepted by the database function exactly as the app serialises it', () => {
  const motor = { motor_type: 'induction', phase_count: null, rated_frequency: null, rated_voltage: null }
  const rd = (code: string, v: number, unit: string): EngineReading => ({
    parameter_code: code, measured_value: v, measured_unit: unit, normalized_value: v, normalized_unit: unit,
  })

  async function save(sessionId: string, r: ReturnType<typeof assessMotor>) {
    const a = toSaveArgs(sessionId, r)
    const out = await q(`select public.save_diagnostic_assessment($1,$2,$3,$4,$5,$6,$7::jsonb) as r`, [
      a.p_session_id, a.p_profile_id, a.p_profile_version, a.p_engine_version, a.p_status, a.p_summary, JSON.stringify(a.p_findings),
    ])
    return (out.rows[0] as { r: { result_id: string; revision: number } }).r
  }

  it('stores a FAULT_SUSPECTED result that also carries missing-data findings', async () => {
    await asUser(A)
    const { session } = await newSubmitted()
    const id = await approvedProfile()
    // synthetic two-parameter profile mirroring what is stored (voltage limit exists in DB; current is added in memory only)
    const profile: EngineProfile = {
      id, name: 'SYNTHETIC', version: 1, approval_status: 'approved', motor_type: 'induction', applicable_specs: {},
      effective_from: null, effective_to: null,
      limits: [
        { parameter_code: 'voltage', parameter_name: 'Voltage', unit: 'V', lower_limit: null, upper_limit: 1, warning_lower: null, warning_upper: null },
        { parameter_code: 'current', parameter_name: 'Current', unit: 'A', lower_limit: null, upper_limit: 5, warning_lower: null, warning_upper: null },
      ],
    }
    const r = assessMotor({ sessionStatus: 'submitted', testTime: new Date(), motor, readings: [rd('voltage', 5, 'V'), rd('speed', 1, 'RPM')], profile })
    expect(r.overallStatus).toBe('FAULT_SUSPECTED')
    const saved = await save(session, r)
    const stored = await one<Record<string, unknown>>(`select * from diagnostic_results where id=$1`, [saved.result_id])
    expect(stored).toMatchObject({ overall_status: 'FAULT_SUSPECTED', reference_profile_id: id, reference_profile_version: 1, diagnostic_engine_version: '1.2.0' })
    const rows = (await q(`select rule_code, severity, parameter_code, observed_value, applicable_limit from diagnostic_findings where diagnostic_result_id=$1 order by rule_code`, [saved.result_id])).rows as Record<string, unknown>[]
    expect(rows.map((x) => x.rule_code)).toEqual(['DATA_MISSING_READING', 'DATA_NO_LIMIT_FOR_READING', 'LIMIT_ABOVE_UPPER'])
    expect(rows.find((x) => x.rule_code === 'LIMIT_ABOVE_UPPER')).toMatchObject({ severity: 'CRITICAL', parameter_code: 'voltage' })
    expect(Number(rows.find((x) => x.rule_code === 'LIMIT_ABOVE_UPPER')?.applicable_limit)).toBe(1)
  })

  it('stores NORMAL, WARNING and INSUFFICIENT_DATA (no profile) results', async () => {
    await asUser(A)
    const id = await approvedProfile()
    const profile = (lim: { upper_limit: number | null; warning_upper: number | null }): EngineProfile => ({
      id, name: 'SYNTHETIC', version: 1, approval_status: 'approved', motor_type: 'induction', applicable_specs: {},
      effective_from: null, effective_to: null,
      limits: [{ parameter_code: 'voltage', parameter_name: 'Voltage', unit: 'V', lower_limit: null, warning_lower: null, ...lim }],
    })
    const cases = [
      { p: profile({ upper_limit: 10, warning_upper: null }), v: 5, expect: 'NORMAL' },
      { p: profile({ upper_limit: 10, warning_upper: 4 }), v: 5, expect: 'WARNING' },
      { p: null, v: 5, expect: 'INSUFFICIENT_DATA' },
    ] as const
    for (const c of cases) {
      const { session } = await newSubmitted()
      const r = assessMotor({ sessionStatus: 'submitted', testTime: new Date(), motor, readings: [rd('voltage', c.v, 'V')], profile: c.p })
      expect(r.overallStatus).toBe(c.expect)
      const saved = await save(session, r)
      expect((await one<{ overall_status: string }>(`select overall_status from diagnostic_results where id=$1`, [saved.result_id])).overall_status).toBe(c.expect)
      expect((await one<{ n: number }>(`select count(*)::int n from diagnostic_findings where diagnostic_result_id=$1`, [saved.result_id])).n).toBe(r.findings.length)
    }
  })
})

// ---------------------------------------------------------------- dashboard / history queries
import { OVERVIEW_COLUMNS } from '../../src/lib/overview'
import { buildDashboard, latestResultBySession } from '../../src/lib/dashboard'

describe('dashboard and history queries run against the real schema and RLS', () => {
  it('the exact column lists the app selects exist and are readable by signed-in users', async () => {
    await asUser(A)
    for (const [table, cols] of Object.entries(OVERVIEW_COLUMNS)) {
      await expect(q(`select ${cols} from ${table} order by 1 limit 1000`)).resolves.toBeTruthy()
    }
  })

  it('shows each user only their own rows, and reassessment keeps earlier revisions readable', async () => {
    await asUser(A)
    const { session } = await newSubmitted()
    await assess(session, null, null, 'INSUFFICIENT_DATA', [])
    const profile = await approvedProfile()
    await assess(session, profile, 1, 'WARNING', [finding({ severity: 'WARNING', rule_code: 'WARNING_ABOVE_UPPER' })])

    const rows = (await q(`select ${OVERVIEW_COLUMNS.diagnostic_results} from diagnostic_results where test_session_id=$1 order by assessed_at desc`, [session])).rows as never[]
    const latest = latestResultBySession(rows).get(session)
    expect(latest).toMatchObject({ revision: 2, overall_status: 'WARNING', reference_profile_version: 1 })
    expect((rows as { revision: number }[]).map((r) => r.revision).sort()).toEqual([1, 2])

    await asUser(B)
    expect((await q(`select ${OVERVIEW_COLUMNS.diagnostic_results} from diagnostic_results where test_session_id=$1`, [session])).rows).toHaveLength(0)
  })

  it('a dashboard built from stored rows counts a submitted, unassessed test as awaiting — never as normal', async () => {
    await asUser(A)
    const { session } = await newSubmitted()
    const sessions = (await q(`select ${OVERVIEW_COLUMNS.test_sessions} from test_sessions where id=$1`, [session])).rows as never[]
    const motors = (await q(`select ${OVERVIEW_COLUMNS.motors} from motors`)).rows as never[]
    const d = buildDashboard({ motors, sessions, results: [], truncated: { motors: false, sessions: false, results: false } })
    expect(d.awaitingCount).toBe(1)
    expect(d.motorStatusCounts.NORMAL).toBe(0)
  })
})

// ---------------------------------------------------------------- migration 012 — function hardening
describe('migration 012 — function hardening', () => {
  it('every application function has a fixed, empty search_path', async () => {
    await db.exec('reset role')
    const rows = (await q(`
      select p.proname, p.proconfig
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'`)).rows as { proname: string; proconfig: string[] | null }[]
    expect(rows.length).toBeGreaterThanOrEqual(9)
    for (const r of rows) expect(r.proconfig, r.proname).toContain('search_path=""')
  })

  it('API roles cannot call trigger functions directly, but triggers still fire for them', async () => {
    await asUser(A)
    await expect(q(`select public.reject_modification()`)).rejects.toThrow(/permission denied/)
    await expect(q(`select public.set_updated_at()`)).rejects.toThrow(/permission denied/)
    await as('anon')
    await expect(q(`select public.enforce_test_session_lifecycle()`)).rejects.toThrow(/permission denied/)
    // still enforced when a signed-in user triggers them
    await asUser(A)
    const { session } = await newSubmitted()
    await expect(q(`update test_sessions set notes='x' where id=$1`, [session])).rejects.toThrow(/immutable/)
    const m = await newMotor()
    const before = await one<{ u: string }>(`select updated_at::text u from motors where id=$1`, [m])
    await new Promise((r) => setTimeout(r, 15))
    await q(`update motors set name='renamed' where id=$1`, [m])
    expect((await one<{ u: string }>(`select updated_at::text u from motors where id=$1`, [m])).u).not.toBe(before.u)
  })

  it('save_diagnostic_assessment is still callable by signed-in users only', async () => {
    await asUser(A)
    const { session } = await newSubmitted()
    await expect(assess(session, null, null, 'INSUFFICIENT_DATA', [])).resolves.toBeTruthy()
    await as('anon')
    await expect(assess(session, null, null, 'INSUFFICIENT_DATA', [])).rejects.toThrow(/permission denied/)
  })
})
