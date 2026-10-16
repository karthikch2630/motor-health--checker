/**
 * Tests database/clear_test_history.sql and database/set_baldor_supply_type.sql on PGlite (migrations 001-014). Not Supabase.
 * All data is SYNTHETIC.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'

const OWNER = '11111111-1111-1111-1111-111111111111'
const OTHER = '44444444-4444-4444-4444-444444444444'
const root = process.cwd()
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const clearScript = (owner = OWNER, confirm = 'DELETE ALL TEST HISTORY') =>
  read('database/clear_test_history.sql')
    .replace('PUT-OWNER-AUTH-USER-UUID-HERE', owner)
    .replace("v_confirm    text := 'NOT CONFIRMED';", `v_confirm    text := '${confirm}';`)

let db: PGlite
const as = async (uid: string) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated`)
}
// The Supabase SQL Editor is an administrator session with no signed-in user, so auth.uid() is null there.
const admin = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`)
const q = (sql: string, p: unknown[] = []) => db.query<Record<string, unknown>>(sql, p)
const n = async (table: string, where = 'true') => Number((await q(`select count(*)::int n from ${table} where ${where}`)).rows[0].n)
const finding = [{ parameter_code: 'voltage', rule_code: 'LIMIT_ABOVE_UPPER', severity: 'CRITICAL', observed_value: 5, observed_unit: 'V', applicable_limit: 1, finding_description: 'synthetic', possible_causes: [], recommended_action: 'inspect' }]

async function makeData(uid: string, tag: string) {
  await as(uid)
  const motor = (await q(`insert into motors (motor_tag,name,motor_type) values ($1,'m','induction') returning id`, [tag])).rows[0].id as string
  const profile = (await q(`insert into reference_profiles (name,motor_type,source_name,version) values ($1,'induction','synthetic',1) returning id`, [`P-${tag}`])).rows[0].id as string
  await q(`insert into reference_limits (reference_profile_id,parameter_code,parameter_name,unit,upper_limit,source_note) values ($1,'voltage','Voltage','V',1,'synthetic')`, [profile])
  await q(`update reference_profiles set approval_status='approved' where id=$1`, [profile])
  for (let i = 0; i < 2; i++) {
    const s = (await q(`insert into test_sessions (motor_id) values ($1) returning id`, [motor])).rows[0].id as string
    await q(`insert into test_readings (test_session_id,parameter_code,measured_value,measured_unit,normalized_value,normalized_unit) values ($1,'voltage',5,'V',5,'V')`, [s])
    await q(`update test_sessions set status='submitted' where id=$1`, [s])
    await q(`select public.save_diagnostic_assessment($1,$2,1,'t','FAULT_SUSPECTED','s',$3::jsonb)`, [s, profile, JSON.stringify(finding)])
  }
  await q(`insert into test_sessions (motor_id) values ($1)`, [motor]) // a draft
  await admin()
  return { motor, profile }
}

beforeEach(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    insert into auth.users values ('${OWNER}'), ('${OTHER}');
  `)
  const dir = join(root, 'database', 'migrations')
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await db.exec(readFileSync(join(dir, f), 'utf8'))
}, 60_000)

describe('clear_test_history.sql', () => {
  it('refuses without the exact confirmation, with the placeholder, and for an unknown user; nothing is deleted', async () => {
    await makeData(OWNER, 'A')
    await expect(db.exec(clearScript(OWNER, 'NOT CONFIRMED'))).rejects.toThrow(/Not confirmed/)
    await expect(db.exec(clearScript(OWNER, 'delete all test history'))).rejects.toThrow(/Not confirmed/)
    await expect(db.exec(read('database/clear_test_history.sql').replace("'NOT CONFIRMED'", "'DELETE ALL TEST HISTORY'"))).rejects.toThrow(/Edit the script first/)
    await expect(db.exec(clearScript('99999999-9999-9999-9999-999999999999'))).rejects.toThrow(/No Auth user/)
    expect(await n('test_sessions')).toBe(3)
    expect(await n('diagnostic_results')).toBe(2)
  })

  it('removes every test, reading, assessment and finding of the owner, and nothing else', async () => {
    const mine = await makeData(OWNER, 'A')
    await makeData(OTHER, 'B')
    expect(await n('test_sessions', `owner_id='${OWNER}'`)).toBe(3)
    const eventsBefore = await n('audit_events')
    await db.exec(clearScript())
    for (const t of ['test_sessions', 'test_readings', 'diagnostic_results', 'diagnostic_findings']) expect(await n(t, `owner_id='${OWNER}'`), t).toBe(0)
    // kept: motor, approved profile (status and version), limits
    expect(await n('motors', `id='${mine.motor}'`)).toBe(1)
    expect((await q(`select approval_status, version from reference_profiles where id=$1`, [mine.profile])).rows[0]).toEqual({ approval_status: 'approved', version: 1 })
    expect(await n('reference_limits', `reference_profile_id='${mine.profile}'`)).toBe(1)
    // another owner's history is untouched
    expect(await n('test_sessions', `owner_id='${OTHER}'`)).toBe(3)
    expect(await n('diagnostic_results', `owner_id='${OTHER}'`)).toBe(2)
    // the deletion is traceable and the earlier events remain
    expect(await n('audit_events', `action='test.deleted' and owner_id='${OWNER}' and actor_id is null`)).toBe(3)
    expect(await n('audit_events', `action='assessment.saved' and owner_id='${OWNER}'`)).toBe(2)
    expect(await n('audit_events')).toBeGreaterThan(eventsBefore)
  })

  it('turns every protection back on: afterwards stored history is immutable again', async () => {
    await makeData(OWNER, 'A')
    await db.exec(clearScript())
    const enabled = await q(`select tgname from pg_trigger where tgname in ('diagnostic_findings_append_only','diagnostic_results_append_only','test_readings_draft_only','test_sessions_lifecycle') and tgenabled='O' order by 1`)
    expect(enabled.rows).toHaveLength(4)
    const fresh = await makeData(OWNER, 'C')
    await as(OWNER)
    const sub = (await q(`select id from test_sessions where motor_id=$1 and status='assessed' limit 1`, [fresh.motor])).rows[0].id as string
    await expect(q(`delete from test_sessions where id=$1`, [sub])).rejects.toThrow(/Only draft/)
    await admin()
    await expect(q(`delete from diagnostic_findings`)).rejects.toThrow(/append-only/)
    await expect(q(`update diagnostic_results set overall_status='NORMAL'`)).rejects.toThrow(/append-only/)
  })

  it('running it again on an empty history is harmless, and fresh tests can be created afterwards', async () => {
    await makeData(OWNER, 'A')
    await db.exec(clearScript())
    await db.exec(clearScript())
    expect(await n('test_sessions', `owner_id='${OWNER}'`)).toBe(0)
    await as(OWNER)
    const m = (await q(`select id from motors limit 1`)).rows[0].id as string
    await q(`insert into test_sessions (motor_id) values ($1)`, [m])
    expect(await n('test_sessions')).toBe(1)
  })
})

describe('set_baldor_supply_type.sql', () => {
  const tags = Array.from({ length: 15 }, (_, i) => `MTR-BAL-${String(i + 1).padStart(3, '0')}`).concat('MTR-001')
  const sql = () => read('database/set_baldor_supply_type.sql')
  const statement = () => sql().split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join(' ').split(';')[0] + ';'

  it('sets only the 13 listed Baldor motors, leaves MTR-001 and the two inverter-looking models blank, and is repeatable', async () => {
    await admin()
    for (const t of tags) await q(`insert into motors (owner_id,motor_tag,name,motor_type,rated_voltage) values ($1,$2,$2,'induction',460)`, [OWNER, t])
    const before = JSON.stringify((await q(`select motor_tag, name, motor_type, rated_voltage from motors order by motor_tag`)).rows)
    const run1 = await db.query(statement())
    expect(run1.rows).toHaveLength(13)
    const set = (await q(`select motor_tag from motors where supply_type='line' order by 1`)).rows.map((r) => r.motor_tag)
    expect(set).not.toContain('MTR-BAL-009')
    expect(set).not.toContain('MTR-BAL-012')
    expect(set).not.toContain('MTR-001')
    expect(set).toHaveLength(13)
    expect(JSON.stringify((await q(`select motor_tag, name, motor_type, rated_voltage from motors order by motor_tag`)).rows)).toBe(before)
    expect((await db.query(statement())).rows).toHaveLength(0) // second run: nothing left to change
  })

  it('the optional statement is commented out in the file', () => {
    const active = sql().split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    expect(active.includes('MTR-BAL-009')).toBe(false)
    expect(active.includes('MTR-BAL-012')).toBe(false)
  })
})
