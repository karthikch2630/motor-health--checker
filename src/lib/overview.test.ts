import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mocked Supabase client: tests OUR queries and error handling, not the hosted API.
const h = vi.hoisted(() => {
  const calls: { table: string; ops: unknown[][] }[] = []
  const byTable: Record<string, { data: unknown; error: unknown; count: number | null }> = {}
  const client = {
    from: (table: string) => {
      const entry = { table, ops: [] as unknown[][] }
      calls.push(entry)
      const b: Record<string, unknown> = {}
      for (const op of ['select', 'order', 'range', 'in', 'eq']) b[op] = (...a: unknown[]) => (entry.ops.push([op, ...a]), b)
      b.then = (resolve: (v: unknown) => unknown) => resolve(byTable[table] ?? { data: [], error: null, count: 0 })
      return b
    },
  }
  return { client, calls, byTable }
})
vi.mock('./supabase', () => ({ supabase: h.client }))

import { getOverview, listReadingsForSessions, PAGE_LIMIT } from './overview'

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i) }))

beforeEach(() => {
  h.calls.length = 0
  for (const k of Object.keys(h.byTable)) delete h.byTable[k]
})

describe('getOverview', () => {
  it('makes exactly four requests (no per-row queries)', async () => {
    await getOverview()
    expect(h.calls.map((c) => c.table).sort()).toEqual(['diagnostic_findings', 'diagnostic_results', 'motors', 'test_sessions'])
  })

  it('asks for exact counts, newest first, within the API page size', async () => {
    await getOverview()
    const sessions = h.calls.find((c) => c.table === 'test_sessions')?.ops ?? []
    expect(sessions).toContainEqual(['order', 'test_timestamp', { ascending: false }])
    expect(sessions).toContainEqual(['range', 0, PAGE_LIMIT - 1])
    expect(sessions[0]).toEqual(['select', expect.stringContaining('measurement_method'), { count: 'exact' }])
  })

  it('does not select findings or other heavy columns', async () => {
    await getOverview()
    const results = h.calls.find((c) => c.table === 'diagnostic_results')?.ops[0] as [string, string]
    expect(results[1]).not.toContain('*')
    expect(results[1]).not.toContain('finding')
  })

  it('reads only the ids of results with a COVERAGE_PARTIAL finding, not the findings themselves', async () => {
    h.byTable.diagnostic_findings = { data: [{ diagnostic_result_id: 'r1' }], error: null, count: null }
    const o = await getOverview()
    expect(o.partialResultIds).toEqual(['r1'])
    const ops = h.calls.find((c) => c.table === 'diagnostic_findings')?.ops ?? []
    expect(ops).toContainEqual(['select', 'diagnostic_result_id'])
    expect(ops).toContainEqual(['eq', 'rule_code', 'COVERAGE_PARTIAL'])
  })

  it('flags truncation when the database holds more rows than were returned', async () => {
    h.byTable.motors = { data: rows(3), error: null, count: 3 }
    h.byTable.test_sessions = { data: rows(PAGE_LIMIT), error: null, count: PAGE_LIMIT + 50 }
    h.byTable.diagnostic_results = { data: rows(2), error: null, count: null }
    const o = await getOverview()
    expect(o.truncated).toEqual({ motors: false, sessions: true, results: false })
  })

  it('treats an unknown total at the page limit as possibly truncated', async () => {
    h.byTable.diagnostic_results = { data: rows(PAGE_LIMIT), error: null, count: null }
    expect((await getOverview()).truncated.results).toBe(true)
  })

  it('rejects when any query fails — a failure is never turned into zero counts', async () => {
    h.byTable.motors = { data: rows(5), error: null, count: 5 }
    h.byTable.test_sessions = { data: null, error: { code: '42501', message: 'denied' }, count: null }
    await expect(getOverview()).rejects.toThrow(/permission/)
  })

  it('rejects on network errors with a clear message', async () => {
    h.byTable.motors = { data: null, error: new TypeError('Failed to fetch'), count: null }
    await expect(getOverview()).rejects.toThrow(/Could not reach/)
  })
})

describe('listReadingsForSessions', () => {
  it('skips the request when there are no sessions', async () => {
    expect(await listReadingsForSessions([])).toEqual([])
    expect(h.calls).toHaveLength(0)
  })

  it('queries by the given session ids and surfaces errors', async () => {
    h.byTable.test_readings = { data: [{ id: 'x' }], error: null, count: null }
    expect(await listReadingsForSessions(['a', 'b'])).toEqual([{ id: 'x' }])
    expect(h.calls[0].ops).toContainEqual(['in', 'test_session_id', ['a', 'b']])
    h.byTable.test_readings = { data: null, error: { code: '42501', message: 'x' }, count: null }
    await expect(listReadingsForSessions(['a'])).rejects.toThrow(/permission/)
  })
})
