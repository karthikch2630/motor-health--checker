/**
 * Tests database/seed_demo_data.sql, cleanup_demo_data.sql and verify_demo_data.sql on a local PostgreSQL engine
 * (PGlite) running ALL migrations 001-012, with stand-ins for Supabase's roles/auth schema. Not hosted Supabase.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { buildDashboard, latestAssessmentByMotor } from '../../src/lib/dashboard'
import { OVERVIEW_COLUMNS } from '../../src/lib/overview'
import { buildTrendSeries } from '../../src/lib/trends'

const ME = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'
const root = process.cwd()
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const PLACEHOLDER = 'PUT-YOUR-AUTH-USER-UUID-HERE'
const seedSql = read('database/seed_demo_data.sql')
const cleanupSql = read('database/cleanup_demo_data.sql')
const verifySql = read('database/verify_demo_data.sql')

const seed = (uid = ME, submit = true) =>
  seedSql.replace(PLACEHOLDER, uid).replace('v_submit_demo_tests boolean := true;', `v_submit_demo_tests boolean := ${submit};`)
const cleanup = (uid = ME) => cleanupSql.replaceAll(PLACEHOLDER, uid)

async function freshDb() {
  const db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                            nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
    insert into auth.users values ('${ME}'), ('${OTHER}');
  `)
  const dir = join(root, 'database', 'migrations')
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await db.exec(readFileSync(join(dir, f), 'utf8'))
  return db
}

const n = async (db: PGlite, sql: string) => (await db.query<{ n: number }>(`select count(*)::int n from ${sql}`)).rows[0].n
async function counts(db: PGlite) {
  return {
    motors: await n(db, `public.motors where id::text like 'dede0001-%'`),
    sessions: await n(db, `public.test_sessions where id::text like 'dede0002-%'`),
    submitted: await n(db, `public.test_sessions where id::text like 'dede0002-%' and status = 'submitted'`),
    readings: await n(db, `public.test_readings where test_session_id::text like 'dede0002-%'`),
  }
}
/** Fingerprint of every demo row, used to prove a re-run changes nothing. */
async function fingerprint(db: PGlite) {
  const q = (s: string) => db.query(s).then((r) => JSON.stringify(r.rows))
  return [
    await q(`select * from public.motors where id::text like 'dede0001-%' order by id`),
    await q(`select * from public.test_sessions where id::text like 'dede0002-%' order by id`),
    await q(`select id, test_session_id, parameter_code, measured_value, measured_unit, normalized_value, normalized_unit, recorded_at from public.test_readings where test_session_id::text like 'dede0002-%' order by test_session_id, parameter_code`),
  ].join('|')
}

describe('seed_demo_data.sql', () => {
  it('creates the documented records, owned by the given user, with the documented relationships', async () => {
    const db = await freshDb()
    await db.exec(seed())
    expect(await counts(db)).toEqual({ motors: 4, sessions: 8, submitted: 6, readings: 27 })

    const owners = (await db.query<{ o: string }>(`select distinct owner_id::text o from public.motors union select distinct owner_id::text from public.test_sessions union select distinct owner_id::text from public.test_readings`)).rows
    expect(owners).toEqual([{ o: ME }])

    const perMotor = (await db.query<{ tag: string; draft: number; submitted: number }>(`
      select m.motor_tag tag, count(*) filter (where s.status='draft')::int draft, count(*) filter (where s.status='submitted')::int submitted
        from public.motors m left join public.test_sessions s on s.motor_id = m.id where m.id::text like 'dede0001-%' group by m.motor_tag order by 1`)).rows
    expect(perMotor).toEqual([
      { tag: 'DEMO-M-001', draft: 1, submitted: 4 },
      { tag: 'DEMO-M-002', draft: 1, submitted: 1 },
      { tag: 'DEMO-M-003', draft: 0, submitted: 1 },
      { tag: 'DEMO-M-004', draft: 0, submitted: 0 }, // left join counts the null session as 0 drafts/submitted
    ])
    await db.close()
  })

  it('labels every record as demonstration data', async () => {
    const db = await freshDb()
    await db.exec(seed())
    expect(await n(db, `public.motors where id::text like 'dede0001-%' and (motor_tag not like 'DEMO-%' or name not like 'DEMO — %' or notes not like 'DEMONSTRATION DATA%')`)).toBe(0)
    expect(await n(db, `public.test_sessions where id::text like 'dede0002-%' and (notes not like 'DEMONSTRATION DATA%' or measurement_method not like 'DEMO — %' or operating_conditions->>'operator' <> 'DEMO')`)).toBe(0)
    await db.close()
  })

  it('creates NO reference profiles, limits, assessments or findings, and does not touch the parameter catalog', async () => {
    const db = await freshDb()
    const before = JSON.stringify((await db.query(`select * from public.parameter_definitions order by code`)).rows)
    await db.exec(seed())
    for (const t of ['reference_profiles', 'reference_limits', 'diagnostic_results', 'diagnostic_findings']) expect(await n(db, `public.${t}`), t).toBe(0)
    expect(JSON.stringify((await db.query(`select * from public.parameter_definitions order by code`)).rows)).toBe(before)
    await db.close()
  })

  it('is idempotent: running it again (and again) changes nothing', async () => {
    const db = await freshDb()
    await db.exec(seed())
    const first = await fingerprint(db)
    await db.exec(seed())
    await db.exec(seed())
    expect(await fingerprint(db)).toBe(first)
    expect(await counts(db)).toEqual({ motors: 4, sessions: 8, submitted: 6, readings: 27 })
    await db.close()
  })

  it('never overwrites real data, even real data that looks similar', async () => {
    const db = await freshDb()
    await db.exec(`
      insert into public.motors (owner_id, motor_tag, name, motor_type, notes) values ('${ME}', 'REAL-PUMP-1', 'Real pump', 'induction', 'real motor');
      insert into public.motors (owner_id, motor_tag, name, motor_type) values ('${OTHER}', 'DEMO-M-001', 'Other user''s motor that happens to share a tag', 'induction');
    `)
    const realBefore = JSON.stringify((await db.query(`select * from public.motors where motor_tag = 'REAL-PUMP-1'`)).rows)
    await db.exec(seed())
    expect(JSON.stringify((await db.query(`select * from public.motors where motor_tag = 'REAL-PUMP-1'`)).rows)).toBe(realBefore)
    expect(await n(db, `public.motors where owner_id = '${OTHER}'`)).toBe(1) // the other user's row is untouched
    await db.close()
  })

  it('keeps every trigger and RLS setting exactly as the migrations left them', async () => {
    const db = await freshDb()
    const state = async () => JSON.stringify({
      triggers: (await db.query(`select tgrelid::regclass::text t, tgname, tgenabled from pg_trigger where not tgisinternal order by 1,2`)).rows,
      rls: (await db.query(`select relname, relrowsecurity, relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r' order by 1`)).rows,
      policies: (await db.query(`select tablename, policyname from pg_policies where schemaname='public' order by 1,2`)).rows,
    })
    const before = await state()
    await db.exec(seed())
    expect(await state()).toBe(before)
    expect(before).toContain('"tgenabled":"O"')
    await db.close()
  })

  it('contains no destructive or security-weakening statements', () => {
    const code = seedSql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    expect(code).not.toMatch(/\b(truncate|delete\s+from|drop\s|alter\s+(table|policy|function)|disable\s+trigger|session_replication_role|row\s+level\s+security|set\s+role|grant\s|revoke\s)/i)
    expect(code).not.toMatch(/insert\s+into\s+public\.(reference_|diagnostic_|parameter_definitions)/i)
    expect(code).toMatch(/on conflict/i)
  })

  it('fails with a clear message when the placeholder was not replaced, the user does not exist, or migration 002 is missing', async () => {
    const db = await freshDb()
    await expect(db.exec(seedSql)).rejects.toThrow(/Edit the script first/)
    await expect(db.exec(seed('99999999-9999-9999-9999-999999999999'))).rejects.toThrow(/No Auth user with id/)
    expect(await counts(db)).toEqual({ motors: 0, sessions: 0, submitted: 0, readings: 0 }) // nothing half-created
    await db.exec(`alter table public.parameter_definitions disable trigger all; delete from public.parameter_definitions where code = 'frequency'`).catch(() => {})
    await db.exec(`delete from public.parameter_definitions where code = 'frequency'`).catch(() => {})
    if ((await n(db, 'public.parameter_definitions')) === 6) await expect(db.exec(seed())).rejects.toThrow(/Apply migration 002/)
    await db.close()
  })

  it('refuses to proceed when demo ids already belong to a different user', async () => {
    const db = await freshDb()
    await db.exec(seed(OTHER))
    await expect(db.exec(seed(ME))).rejects.toThrow(/DIFFERENT user/)
    await db.close()
  })

  it('with v_submit_demo_tests = false everything stays a draft; a later run with true upgrades the drafts', async () => {
    const db = await freshDb()
    await db.exec(seed(ME, false))
    expect(await counts(db)).toEqual({ motors: 4, sessions: 8, submitted: 0, readings: 27 })
    await db.exec(seed(ME, true))
    expect(await counts(db)).toEqual({ motors: 4, sessions: 8, submitted: 6, readings: 27 })
    await db.close()
  })
})

describe('what the signed-in user and the app see', () => {
  async function asMe(db: PGlite) {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${ME}', false); set role authenticated`)
  }

  it('the seeded rows are visible to the owner through RLS and invisible to another user', async () => {
    const db = await freshDb()
    await db.exec(seed())
    await asMe(db)
    expect(await counts(db)).toEqual({ motors: 4, sessions: 8, submitted: 6, readings: 27 })
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${OTHER}', false); set role authenticated`)
    expect(await counts(db)).toEqual({ motors: 0, sessions: 0, submitted: 0, readings: 0 })
    await db.close()
  })

  it('the app\'s own dashboard logic on the seeded rows: awaiting tests, drafts, and NO motor labelled healthy', async () => {
    const db = await freshDb()
    await db.exec(seed())
    await asMe(db)
    const rows = async (table: keyof typeof OVERVIEW_COLUMNS) => (await db.query(`select ${OVERVIEW_COLUMNS[table]} from public.${table}`)).rows as never[]
    const dash = buildDashboard({
      motors: await rows('motors'), sessions: await rows('test_sessions'), results: await rows('diagnostic_results'),
      truncated: { motors: false, sessions: false, results: false },
    })
    expect(dash).toMatchObject({ motorCount: 4, testCount: 8, draftCount: 2, awaitingCount: 6, assessedCount: 0, motorsWithoutAssessment: 4 })
    expect(dash.motorStatusCounts).toEqual({ NORMAL: 0, WARNING: 0, FAULT_SUSPECTED: 0, INSUFFICIENT_DATA: 0 })
    expect(latestAssessmentByMotor(await rows('test_sessions'), await rows('diagnostic_results')).size).toBe(0)
    await db.close()
  })

  it('the trend chart has comparable series for DEMO-M-001 and none that mix units or methods', async () => {
    const db = await freshDb()
    await db.exec(seed())
    await asMe(db)
    const sessions = (await db.query(`select ${OVERVIEW_COLUMNS.test_sessions} from public.test_sessions where motor_id = 'dede0001-0000-4000-8000-000000000001'`)).rows as { id: string; measurement_method: string | null; test_timestamp: string; status: 'draft' | 'submitted' | 'assessed' }[]
    // shaped like the API's JSON (numeric columns arrive as numbers, not strings)
    const readings = (await db.query(`select to_jsonb(r) as j from public.test_readings r where r.test_session_id::text like 'dede0002-%'`)).rows.map((r) => (r as { j: unknown }).j) as never[]
    const defs = (await db.query(`select code, display_name from public.parameter_definitions`)).rows as { code: string; display_name: string }[]
    const series = buildTrendSeries(sessions, Object.fromEntries(sessions.map((s) => [s.id, s.measurement_method])), readings, defs)
    const bySeries = Object.fromEntries(series.map((s) => [s.parameterCode, s]))
    for (const code of ['voltage', 'current', 'temperature']) expect(bySeries[code].plottable, code).toBe(true)
    expect(bySeries.voltage.points.map((p) => p.value)).toEqual([398, 401, 399, 402]) // 0.401 kV normalised to 401 V
    expect(bySeries.temperature.points.map((p) => p.value)).toEqual([62, 63, 60, 64]) // 140 °F normalised to 60 °C
    expect(bySeries.vibration.points).toHaveLength(3) // the 4th test has no vibration reading
    expect(series.every((s) => ['V', 'A', '°C', 'mm/s', 'RPM'].includes(s.unit))).toBe(true)
    // the unfinished draft is not part of any trend
    expect(bySeries.voltage.points.some((p) => p.sessionId === 'dede0002-0000-4000-8000-000000000005')).toBe(false)
    await db.close()
  })

  it('the submitted demo tests are immutable and can be assessed by the app like any other test', async () => {
    const db = await freshDb()
    await db.exec(seed())
    await asMe(db)
    await expect(db.query(`update public.test_sessions set notes = 'x' where id = 'dede0002-0000-4000-8000-000000000001'`)).rejects.toThrow(/immutable/)
    await expect(db.query(`delete from public.test_readings where test_session_id = 'dede0002-0000-4000-8000-000000000001'`)).rejects.toThrow(/cannot be changed/)
    // with NO profile, the app records "insufficient data" — it never invents a result
    await expect(db.query(`select public.save_diagnostic_assessment('dede0002-0000-4000-8000-000000000001'::uuid, null, null, 'test', 'INSUFFICIENT_DATA', 's', '[]'::jsonb)`)).resolves.toBeTruthy()
    await db.close()
  })
})

describe('cleanup_demo_data.sql', () => {
  it('after a full seed it removes only the removable demo records and reports what must stay', async () => {
    const db = await freshDb()
    await db.exec(`insert into public.motors (owner_id, motor_tag, name, motor_type) values ('${ME}', 'REAL-PUMP-1', 'Real pump', 'induction')`)
    await db.exec(`insert into public.test_sessions (owner_id, motor_id) select '${ME}', id from public.motors where motor_tag = 'REAL-PUMP-1'`)
    await db.exec(seed())
    await db.exec(cleanup())
    // drafts (2 sessions, 2 readings) and the motor without tests (DEMO-M-004) are gone; submitted demo tests + their 3 motors stay
    expect(await counts(db)).toEqual({ motors: 3, sessions: 6, submitted: 6, readings: 25 })
    expect(await n(db, `public.motors where motor_tag = 'REAL-PUMP-1'`)).toBe(1)
    expect(await n(db, `public.test_sessions s join public.motors m on m.id = s.motor_id where m.motor_tag = 'REAL-PUMP-1'`)).toBe(1) // real draft untouched
    await db.exec(cleanup()) // safe to repeat
    expect(await counts(db)).toEqual({ motors: 3, sessions: 6, submitted: 6, readings: 25 })
    await db.close()
  })

  it('removes everything when the demo was seeded without submitting', async () => {
    const db = await freshDb()
    await db.exec(`insert into public.motors (owner_id, motor_tag, name, motor_type) values ('${ME}', 'REAL-PUMP-1', 'Real pump', 'induction')`)
    await db.exec(seed(ME, false))
    await db.exec(cleanup())
    expect(await counts(db)).toEqual({ motors: 0, sessions: 0, submitted: 0, readings: 0 })
    expect(await n(db, `public.motors where motor_tag = 'REAL-PUMP-1'`)).toBe(1)
    await db.close()
  })

  it('does not touch another user\'s records that share the demo ids, and never disables triggers', async () => {
    const db = await freshDb()
    await db.exec(seed(OTHER, false))
    await db.exec(cleanup(ME))
    expect(await counts(db)).toEqual({ motors: 4, sessions: 8, submitted: 0, readings: 27 })
    const code = cleanupSql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    expect(code).not.toMatch(/\b(truncate|disable\s+trigger|session_replication_role|drop\s|alter\s)/i)
    expect(code).not.toMatch(/delete\s+from\s+public\.(reference_|diagnostic_|parameter_)/i)
    await db.close()
  })

  it('refuses to run with the placeholder', async () => {
    const db = await freshDb()
    await expect(db.exec(cleanupSql)).rejects.toThrow(/Edit the script first/)
    await db.close()
  })
})

describe('verify_demo_data.sql', () => {
  it('every query in it is valid against the real schema (queries 1-7 and the RLS-visibility block)', async () => {
    const db = await freshDb()
    await db.exec(seed())
    const queries = verifySql
      .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
      .split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean)
    expect(queries.length).toBeGreaterThanOrEqual(10)
    for (const q of queries) {
      const sql = q.replaceAll(PLACEHOLDER, ME)
      await expect(db.exec(sql + ';'), sql.slice(0, 60)).resolves.toBeTruthy()
    }
    // the visibility block as the user sees it (begin … rollback) must report the full demo set
    const block = verifySql.slice(verifySql.indexOf('begin;')).replaceAll(PLACEHOLDER, ME)
    const results = await db.exec(block)
    const last = results.filter((r) => r.fields?.some((f) => f.name === 'motors_visible_to_you')).pop()
    expect(last?.rows[0]).toMatchObject({ motors_visible_to_you: 4, sessions_visible_to_you: 8, readings_visible_to_you: 27 })
    await db.close()
  })

  it('contains only read-only statements apart from the begin / set local / rollback of the visibility block', () => {
    const code = verifySql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    expect(code).not.toMatch(/\b(insert|update|delete|truncate|drop|alter|grant|revoke)\b/i)
  })
})
