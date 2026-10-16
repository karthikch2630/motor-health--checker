/**
 * Tests database/seed_baldor_reference_drafts.sql on PGlite with migrations 001-013 (not hosted Supabase).
 * Also tests replace_baldor_reference_draft.sql and verify/baldor_reference_check.sql.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { assessMotor } from '../../src/lib/diagnostics'
import { motorCoverage } from '../../src/lib/profileCoverage'

const ME = '11111111-1111-1111-1111-111111111111'
const root = process.cwd()
const PLACEHOLDER = 'PUT-YOUR-AUTH-USER-UUID-HERE'
const seed = readFileSync(join(root, 'database/seed_baldor_reference_drafts.sql'), 'utf8').replaceAll(PLACEHOLDER, ME)

async function freshDb(types: string[] = Array(15).fill('induction'), supply: (string | null)[] = Array(15).fill('line')) {
  const db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    insert into auth.users values ('${ME}');
  `)
  const dir = join(root, 'database', 'migrations')
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await db.exec(readFileSync(join(dir, f), 'utf8'))
  for (let i = 0; i < types.length; i++) {
    const tag = `MTR-BAL-${String(i + 1).padStart(3, '0')}`
    await db.query(
      `insert into public.motors (owner_id, motor_tag, name, motor_type, rated_voltage, rated_frequency, phase_count, supply_type) values ($1,$2,$2,$3,460,60,3,$4)`,
      [ME, tag, types[i], supply[i] ?? null],
    )
  }
  return db
}

describe('seed_baldor_reference_drafts.sql', () => {
  it('creates one DRAFT profile with voltage and frequency warning thresholds only, and is idempotent', async () => {
    const db = await freshDb()
    await db.exec(seed)
    await db.exec(seed)
    const p = (await db.query<{ approval_status: string; n: number }>(
      `select approval_status, (select count(*)::int from public.reference_profiles) n from public.reference_profiles`)).rows
    expect(p).toEqual([{ approval_status: 'draft', n: 1 }])
    const l = (await db.query(
      `select parameter_code, lower_limit, upper_limit, warning_lower::float w1, warning_upper::float w2 from public.reference_limits order by parameter_code`)).rows
    expect(l).toEqual([
      { parameter_code: 'frequency', lower_limit: null, upper_limit: null, w1: 57, w2: 63 },
      { parameter_code: 'voltage', lower_limit: null, upper_limit: null, w1: 414, w2: 506 },
    ])
  })

  it('is not usable until approved; once approved it covers all 15 motors and stays untouched by a re-run', async () => {
    const db = await freshDb()
    await db.exec(seed)
    const row = async () => (await db.query<never>(`select * from public.reference_profiles`)).rows[0] as Record<string, unknown>
    const toProfile = async () => {
      const r = await row()
      return { ...(r as object), limit_count: 2, effective_from: null, effective_to: null } as never
    }
    const motors = (await db.query<{ id: string }>(`select id, motor_type, phase_count, rated_frequency::float rated_frequency, rated_voltage::float rated_voltage, supply_type from public.motors`)).rows as never[]
    expect(motors).toHaveLength(15)
    const at = new Date()
    for (const m of motors) expect(motorCoverage(m, [await toProfile()], at).usable).toHaveLength(0)
    await db.exec(`update public.reference_profiles set approval_status = 'approved'`)
    for (const m of motors) expect(motorCoverage(m, [await toProfile()], at).usable).toHaveLength(1)
    const before = JSON.stringify(await row())
    await db.exec(seed) // must neither fail on the immutable approved profile nor change it
    expect(JSON.stringify(await row())).toBe(before)
    expect((await db.query<{ n: number }>(`select count(*)::int n from public.reference_limits`)).rows[0].n).toBe(2)
  })

  it('inverter-fed and unverified motors are never treated as compatible (unknown stays unresolved)', async () => {
    const supplies = ['line', null, 'inverter', ...Array(12).fill('line')]
    const db = await freshDb(undefined, supplies)
    await db.exec(seed)
    await db.exec(`update public.reference_profiles set approval_status = 'approved'`)
    const profile = { ...((await db.query(`select * from public.reference_profiles`)).rows[0] as object), limit_count: 2, effective_from: null, effective_to: null } as never
    const motors = (await db.query<{ motor_tag: string }>(`select motor_tag, id, motor_type, phase_count, rated_frequency::float rated_frequency, rated_voltage::float rated_voltage, supply_type from public.motors order by motor_tag`)).rows as never[]
    const cov = (i: number) => motorCoverage(motors[i], [profile], new Date())
    expect(cov(0).usable).toHaveLength(1)
    expect(cov(1).usable).toHaveLength(0)
    expect(cov(1).unusable[0].match.status).toBe('unknown')
    expect(cov(1).unusable[0].match.reasons.join(' ')).toMatch(/supply/)
    expect(cov(2).usable).toHaveLength(0)
    expect(cov(2).unusable[0].match.status).toBe('incompatible')
    // The engine refuses to apply it as well, with a PROFILE_* finding and INSUFFICIENT_DATA.
    const r = assessMotor({ sessionStatus: 'submitted', testTime: new Date(), parameterNames: {}, motor: motors[1] as never, profile: { ...(profile as object), approval_status: 'approved', limits: [] } as never, readings: [] })
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
    expect(r.findings[0].ruleCode).toBe('PROFILE_APPLICABILITY_UNKNOWN')
  })

  it('refuses to run when motor types differ or the motors are missing', async () => {
    await expect((await freshDb(['induction', 'Induction ', 'synchronous'])).exec(seed)).rejects.toThrow(/different motor types/)
    await expect((await freshDb([])).exec(seed)).rejects.toThrow(/None of the motors/)
  })
})

describe('the seeded draft enforces the combined rule from stored data', () => {
  async function seededProfile() {
    const db = await freshDb()
    await db.exec(seed)
    const p = (await db.query<Record<string, unknown>>(`select * from public.reference_profiles`)).rows[0]
    const limits = (await db.query<Record<string, unknown>>(
      `select parameter_code, parameter_name, unit, lower_limit::float lower_limit, upper_limit::float upper_limit,
              warning_lower::float warning_lower, warning_upper::float warning_upper, applicable_conditions from public.reference_limits`)).rows
    return { ...p, approval_status: 'approved', limits } as never
  }
  const rd = (parameter_code: string, v: number, unit: string) =>
    ({ parameter_code, measured_value: v, measured_unit: unit, normalized_value: v, normalized_unit: unit })
  const names = { voltage: 'Voltage', frequency: 'Frequency' }
  const base = { sessionStatus: 'submitted' as const, testTime: new Date(), parameterNames: names,
    motor: { motor_type: 'induction', phase_count: 3, rated_frequency: 60, rated_voltage: 460, supply_type: 'line' as const } }

  it('414 V with 58.8 Hz at rated load: both ranges pass, the combined rule gives WARNING (the earlier false assurance is gone)', async () => {
    const profile = await seededProfile()
    const r = assessMotor({ ...base, profile, operatingConditions: { load_condition: 'rated' }, readings: [rd('voltage', 414, 'V'), rd('frequency', 58.8, 'Hz')] })
    expect(r.overallStatus).toBe('WARNING')
    expect(r.findings.map((f) => f.ruleCode)).toContain('COMBINED_VF_SUM_EXCEEDED')
  })

  it('the same readings without a recorded load condition are not passed', async () => {
    const profile = await seededProfile()
    const r = assessMotor({ ...base, profile, operatingConditions: {}, readings: [rd('voltage', 460, 'V'), rd('frequency', 60, 'Hz')] })
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
    expect(r.complete).toBe(false)
  })

  it('rated voltage and frequency at rated load: NORMAL for the covered checks only (coverage finding present)', async () => {
    const profile = await seededProfile()
    const r = assessMotor({ ...base, parameterNames: { ...names, current: 'Current' }, profile, operatingConditions: { load_condition: 'rated' }, readings: [rd('voltage', 460, 'V'), rd('frequency', 60, 'Hz')] })
    expect(r.overallStatus).toBe('NORMAL')
    expect(r.summary).toMatch(/^PARTIAL ASSESSMENT/)
  })
})

describe('verify/baldor_reference_check.sql', () => {
  const sql = readFileSync(join(root, 'database/verify/baldor_reference_check.sql'), 'utf8')
  const statements = sql.split(/;\s*$/m).map((x) => x.replace(/^--.*$/gm, '').trim()).filter(Boolean)

  it('contains only SELECT statements', () => {
    expect(statements).toHaveLength(7)
    for (const st of statements) expect(st).toMatch(/^select\b/i)
    expect(statements.join('\n')).not.toMatch(/\b(insert|update|delete|truncate|alter|drop|create|grant)\b/i)
  })

  it('reports all 15 tags, ownership, motor types, supply, profiles, limits, per-pair verdicts and stored revisions', async () => {
    const db = await freshDb(undefined, ['line', null, 'inverter', ...Array(12).fill('line')])
    await db.exec(seed)
    const rows: Record<string, unknown>[][] = []
    for (const st of statements) rows.push((await db.query<Record<string, unknown>>(st)).rows)
    expect(rows[0]).toHaveLength(15)
    expect(rows[0].every((r) => r.present === true && r.owner_id === ME)).toBe(true)
    expect(rows[1][0]).toMatchObject({ motors: 15, owners: 1, motor_types: 1, phase_counts: 1, voltages: 1, frequencies: 1 })
    expect(rows[2]).toHaveLength(15)
    expect(rows[2].filter((r) => r.supply_type === null)).toHaveLength(1)
    expect(rows[3]).toHaveLength(1)
    expect(rows[3][0]).toMatchObject({ approval_status: 'draft', required_supply_type: 'line', has_combined_rule: true })
    expect(Number(rows[3][0].limits)).toBe(2)
    expect(rows[4]).toHaveLength(2)
    expect(rows[4].every((r) => r.required_load_condition === 'rated')).toBe(true)
    const verdict = Object.fromEntries(rows[5].map((r) => [r.motor_tag, r.verdict]))
    expect(verdict['MTR-BAL-001']).toBe('usable')
    expect(verdict['MTR-BAL-002']).toBe('unknown') // supply not recorded
    expect(verdict['MTR-BAL-003']).toBe('incompatible') // inverter-fed
    expect(rows[6]).toEqual([])
  })

  it('shows MISSING tags instead of silently omitting them', async () => {
    const db = await freshDb(Array(14).fill('induction'), Array(14).fill('line'))
    const rows = (await db.query<{ tag: string; present: boolean }>(statements[0])).rows
    expect(rows).toHaveLength(15)
    expect(rows.filter((r) => !r.present).map((r) => r.tag)).toEqual(['MTR-BAL-015'])
  })
})

describe('replace_baldor_reference_draft.sql', () => {
  const replace = readFileSync(join(root, 'database/replace_baldor_reference_draft.sql'), 'utf8').replaceAll(PLACEHOLDER, ME)
  const OLD_ID = 'bab00003-0000-4000-8000-000000000001'

  async function withOldDraft() {
    const db = await freshDb()
    // An "older draft": same id, older content, one old-style limit.
    await db.exec(`insert into public.reference_profiles (id, owner_id, name, motor_type, applicable_specs, source_name, version, approval_status)
      values ('${OLD_ID}', '${ME}', 'OLD draft', 'induction', '{"phase_count": 3}', 'old', 1, 'draft')`)
    await db.exec(`insert into public.reference_limits (owner_id, reference_profile_id, parameter_code, parameter_name, unit, upper_limit, source_note)
      values ('${ME}', '${OLD_ID}', 'voltage', 'Voltage', 'V', 506, 'old')`)
    // Unrelated profile that must survive.
    await db.exec(`insert into public.reference_profiles (owner_id, name, motor_type, source_name, version) values ('${ME}', 'UNRELATED', 'induction', 's', 1)`)
    return db
  }
  const names = async (db: PGlite) => (await db.query<{ name: string }>(`select name from public.reference_profiles order by name`)).rows.map((r) => r.name)

  it('the seed alone leaves an older draft in place (it never modifies an existing profile)', async () => {
    const db = await withOldDraft()
    await db.exec(seed)
    expect(await names(db)).toEqual(['OLD draft', 'UNRELATED'])
  })

  it('removes only the old draft and its limits, then the seed creates the current draft; unrelated profiles are untouched', async () => {
    const db = await withOldDraft()
    await db.exec(replace)
    expect(await names(db)).toEqual(['UNRELATED'])
    expect((await db.query<{ n: number }>(`select count(*)::int n from public.reference_limits`)).rows[0].n).toBe(0)
    await db.exec(seed)
    expect(await names(db)).toEqual(['NEMA MG 1 12.44 supply tolerance - 460 V / 60 Hz three-phase', 'UNRELATED'])
    await db.exec(replace) // running it again removes the new draft; running the seed restores it - both are repeatable
    await db.exec(seed)
    expect((await names(db)).length).toBe(2)
  })

  it('does nothing when there is no old draft', async () => {
    const db = await freshDb()
    await db.exec(replace)
    expect(await names(db)).toEqual([])
  })

  it('refuses to remove an APPROVED profile', async () => {
    const db = await freshDb()
    await db.exec(seed)
    await db.exec(`update public.reference_profiles set approval_status = 'approved'`)
    await expect(db.exec(replace)).rejects.toThrow(/immutable/)
    expect((await db.query<{ n: number }>(`select count(*)::int n from public.reference_profiles`)).rows[0].n).toBe(1)
    expect((await db.query<{ n: number }>(`select count(*)::int n from public.reference_limits`)).rows[0].n).toBe(2)
  })

  it('refuses when the placeholder was not replaced', async () => {
    const db = await freshDb()
    await expect(db.exec(readFileSync(join(root, 'database/replace_baldor_reference_draft.sql'), 'utf8'))).rejects.toThrow(/Edit the script first/)
  })
})
