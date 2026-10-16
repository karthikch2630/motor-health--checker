import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Motor } from '../types/motor'
import type { ParameterDefinition } from '../types/reference'
import type { TestReading, TestSession } from '../types/test'

// Mocked Supabase client: tests OUR argument mapping, sequencing and error handling. The database function
// itself is exercised against real PostgreSQL semantics in database/tests/schema.test.ts.
const h = vi.hoisted(() => {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = []
  let rpcResult: { data: unknown; error: unknown } = { data: null, error: null }
  const queries: { table: string; ops: unknown[][] }[] = []
  let tableResults: { data: unknown; error: unknown }[] = []
  const client = {
    rpc: (fn: string, args: Record<string, unknown>) => (rpcCalls.push({ fn, args }), Promise.resolve(rpcResult)),
    from: (table: string) => {
      const entry = { table, ops: [] as unknown[][] }
      queries.push(entry)
      const b: Record<string, unknown> = {}
      for (const op of ['select', 'eq', 'in', 'order']) b[op] = (...a: unknown[]) => (entry.ops.push([op, ...a]), b)
      b.then = (resolve: (v: unknown) => unknown) => resolve(tableResults.shift() ?? { data: [], error: null })
      return b
    },
  }
  return {
    client, rpcCalls, queries,
    setRpc: (r: { data: unknown; error: unknown }) => (rpcResult = r),
    setTables: (...r: { data: unknown; error: unknown }[]) => (tableResults = r),
    getProfile: vi.fn(),
  }
})
vi.mock('./supabase', () => ({ supabase: h.client }))
vi.mock('./reference', () => ({ getProfile: h.getProfile }))

import { describeAssessmentError, listAssessments, runAssessment, saveAssessment, toSaveArgs } from './assessments'
import { assessMotor } from './diagnostics'

const motor = { motor_type: 'induction', phase_count: 3, rated_frequency: 50, rated_voltage: 400 } as unknown as Motor
const defs: ParameterDefinition[] = [{ code: 'voltage', display_name: 'Voltage', description: null, canonical_unit: 'V' }]
const session = (status: string) => ({ id: 's1', status, test_timestamp: '2026-06-01T00:00:00Z' }) as unknown as TestSession
const readings = (v: number) =>
  [{ parameter_code: 'voltage', measured_value: v, measured_unit: 'V', normalized_value: v, normalized_unit: 'V' }] as unknown as TestReading[]
// SYNTHETIC profile
const profile = {
  id: 'p1', name: 'SYNTHETIC', version: 7, approval_status: 'approved', motor_type: 'induction', applicable_specs: {},
  effective_from: null, effective_to: null,
  limits: [{ parameter_code: 'voltage', parameter_name: 'Voltage', unit: 'V', lower_limit: null, upper_limit: 10, warning_lower: null, warning_upper: null }],
}

beforeEach(() => {
  h.rpcCalls.length = 0
  h.queries.length = 0
  h.setRpc({ data: { result_id: 'r1', revision: 1 }, error: null })
  h.setTables()
  h.getProfile.mockReset()
})

describe('toSaveArgs', () => {
  it('maps the engine result to the database function arguments, including profile id/version and engine version', () => {
    const r = assessMotor({ sessionStatus: 'submitted', testTime: new Date('2026-06-01T00:00:00Z'), motor, readings: readings(50), profile: profile as never })
    const a = toSaveArgs('s1', r)
    expect(a).toMatchObject({
      p_session_id: 's1', p_profile_id: 'p1', p_profile_version: 7, p_engine_version: '1.2.0', p_status: 'FAULT_SUSPECTED',
    })
    expect(a.p_findings[0]).toMatchObject({
      parameter_code: 'voltage', rule_code: 'LIMIT_ABOVE_UPPER', severity: 'CRITICAL', observed_value: 50, observed_unit: 'V',
      applicable_limit: 10, possible_causes: [],
    })
  })
})

describe('saveAssessment', () => {
  const ok = assessMotor({ sessionStatus: 'submitted', testTime: new Date(), motor, readings: [], profile: null })

  it('calls the atomic database function once and returns the stored revision', async () => {
    await expect(saveAssessment('s1', ok)).resolves.toEqual({ result_id: 'r1', revision: 1 })
    expect(h.rpcCalls).toHaveLength(1)
    expect(h.rpcCalls[0].fn).toBe('save_diagnostic_assessment')
    expect(h.queries).toHaveLength(0) // no separate table writes: nothing can be half-saved
  })

  it('rejects (no false success) when the database call fails', async () => {
    h.setRpc({ data: null, error: { code: '23514', message: 'Draft test session x cannot be assessed' } })
    await expect(saveAssessment('s1', ok)).rejects.toThrow(/still a draft/)
  })

  it('rejects when the database does not confirm the save', async () => {
    h.setRpc({ data: null, error: null })
    await expect(saveAssessment('s1', ok)).rejects.toThrow(/did not confirm/)
    h.setRpc({ data: { revision: 'x' }, error: null })
    await expect(saveAssessment('s1', ok)).rejects.toThrow(/did not confirm/)
  })

  it('never persists NOT_ASSESSED', async () => {
    const draft = assessMotor({ sessionStatus: 'draft', testTime: new Date(), motor, readings: [], profile: null })
    await expect(saveAssessment('s1', draft)).rejects.toThrow(/not assessed/i)
    expect(h.rpcCalls).toHaveLength(0)
  })
})

describe('describeAssessmentError', () => {
  it.each([
    [{ message: 'Could not find the function public.save_diagnostic_assessment', code: 'PGRST202' }, /Apply migrations 010 and 011/],
    [{ message: 'Reference profile 1 is not approved and cannot support a NORMAL assessment' }, /no longer approved/],
    [{ message: 'duplicate key value violates unique constraint "diagnostic_results_session_revision_key"' }, /same time/],
    [{ message: 'violates foreign key constraint "diagnostic_results_profile_fk"' }, /could not be verified/],
    [{ code: '42501', message: 'x' }, /permission/],
  ])('maps %j', (err, re) => {
    expect(describeAssessmentError(err)).toMatch(re)
  })
  it('hides unknown details', () => {
    expect(describeAssessmentError({ code: 'XX000', message: 'secret-123' })).not.toMatch(/secret/)
  })
})

describe('runAssessment', () => {
  it('refuses a draft without calling the database', async () => {
    await expect(runAssessment({ session: session('draft'), readings: readings(1), motor, definitions: defs, profileId: 'p1' })).rejects.toThrow(/draft/)
    expect(h.rpcCalls).toHaveLength(0)
    expect(h.getProfile).not.toHaveBeenCalled()
  })

  it('loads the selected profile, evaluates, and stores result with profile id and version', async () => {
    h.getProfile.mockResolvedValue(profile)
    const { result, saved } = await runAssessment({ session: session('submitted'), readings: readings(5), motor, definitions: defs, profileId: 'p1' })
    expect(result.overallStatus).toBe('NORMAL')
    expect(saved.revision).toBe(1)
    expect(h.rpcCalls[0].args).toMatchObject({ p_profile_id: 'p1', p_profile_version: 7, p_status: 'NORMAL' })
  })

  it('records INSUFFICIENT_DATA with no profile when none is selected (nothing is compared)', async () => {
    const { result } = await runAssessment({ session: session('submitted'), readings: readings(999), motor, definitions: defs, profileId: null })
    expect(result.overallStatus).toBe('INSUFFICIENT_DATA')
    expect(h.getProfile).not.toHaveBeenCalled()
    expect(h.rpcCalls[0].args).toMatchObject({ p_profile_id: null, p_profile_version: null, p_status: 'INSUFFICIENT_DATA' })
  })

  it('does not assess against a profile that was retired in the meantime', async () => {
    h.getProfile.mockResolvedValue({ ...profile, approval_status: 'retired' })
    const { result } = await runAssessment({ session: session('submitted'), readings: readings(999), motor, definitions: defs, profileId: 'p1' })
    expect(result.overallStatus).toBe('INSUFFICIENT_DATA')
    expect(h.rpcCalls[0].args.p_profile_id).toBeNull()
  })

  it('fails clearly if the selected profile no longer exists, without saving', async () => {
    h.getProfile.mockResolvedValue(null)
    await expect(runAssessment({ session: session('submitted'), readings: readings(1), motor, definitions: defs, profileId: 'zzz' })).rejects.toThrow(/not found/)
    expect(h.rpcCalls).toHaveLength(0)
  })

  it('propagates a persistence failure instead of returning a result', async () => {
    h.getProfile.mockResolvedValue(profile)
    h.setRpc({ data: null, error: { code: '08006', message: 'connection lost' } })
    await expect(runAssessment({ session: session('submitted'), readings: readings(1), motor, definitions: defs, profileId: 'p1' })).rejects.toThrow(/database request failed/)
  })
})

describe('listAssessments', () => {
  it('returns revisions newest first, each with only its own findings', async () => {
    h.setTables(
      { data: [{ id: 'r2', revision: 2 }, { id: 'r1', revision: 1 }], error: null },
      { data: [{ id: 'f1', diagnostic_result_id: 'r1' }, { id: 'f2', diagnostic_result_id: 'r2' }, { id: 'f3', diagnostic_result_id: 'r2' }], error: null },
    )
    const list = await listAssessments('s1')
    expect(list.map((r) => [r.revision, r.findings.length])).toEqual([[2, 2], [1, 1]])
    expect(h.queries[0].ops).toContainEqual(['order', 'revision', { ascending: false }])
  })

  it('returns an empty list without a second query when nothing is stored', async () => {
    h.setTables({ data: [], error: null })
    expect(await listAssessments('s1')).toEqual([])
    expect(h.queries).toHaveLength(1)
  })

  it('surfaces load errors', async () => {
    h.setTables({ data: null, error: { code: '42501', message: 'x' } })
    await expect(listAssessments('s1')).rejects.toThrow(/permission/)
  })
})
