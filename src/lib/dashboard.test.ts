import { describe, expect, it } from 'vitest'
import { buildDashboard, latestAssessmentByMotor, latestResultBySession, revisionsOf, testState } from './dashboard'
import type { AssessmentStatus } from '../types'
import type { MotorRow, Overview, ResultRow, SessionRow } from '../types/overview'

// SYNTHETIC rows.
const motor = (id: string): MotorRow => ({ id, motor_tag: id.toUpperCase(), name: id, motor_type: 'induction' })
const session = (id: string, motor_id: string, test_timestamp: string, status: SessionRow['status'] = 'submitted'): SessionRow => ({
  id, motor_id, test_timestamp, measurement_method: null, status, created_at: test_timestamp,
})
const result = (id: string, test_session_id: string, revision: number, overall_status: AssessmentStatus, assessed_at = '2026-07-01T00:00:00Z'): ResultRow => ({
  id, test_session_id, revision, overall_status, assessed_at, reference_profile_id: null, reference_profile_version: null, diagnostic_engine_version: '1.0.0',
})
const overview = (over: Partial<Overview> = {}): Overview => ({
  motors: [], sessions: [], results: [], truncated: { motors: false, sessions: false, results: false }, ...over,
})

describe('revision ordering', () => {
  it('picks the highest revision per session regardless of row order', () => {
    const rs = [result('a', 's1', 2, 'NORMAL'), result('b', 's1', 3, 'WARNING'), result('c', 's1', 1, 'FAULT_SUSPECTED'), result('d', 's2', 1, 'NORMAL')]
    const latest = latestResultBySession(rs)
    expect(latest.get('s1')?.revision).toBe(3)
    expect(latest.get('s1')?.overall_status).toBe('WARNING')
    expect(latest.get('s2')?.revision).toBe(1)
    expect(latestResultBySession([...rs].reverse()).get('s1')?.id).toBe('b')
  })

  it('lists all revisions of one session newest first and keeps the earlier ones', () => {
    const rs = [result('a', 's1', 1, 'WARNING'), result('b', 's1', 3, 'NORMAL'), result('c', 's1', 2, 'FAULT_SUSPECTED'), result('d', 's2', 1, 'NORMAL')]
    expect(revisionsOf(rs, 's1').map((r) => r.revision)).toEqual([3, 2, 1])
    expect(revisionsOf(rs, 'none')).toEqual([])
  })
})

describe('testState distinguishes draft, awaiting and assessed', () => {
  it('maps status + presence of a stored result', () => {
    expect(testState({ status: 'draft' }, false)).toBe('draft')
    expect(testState({ status: 'submitted' }, false)).toBe('awaiting')
    expect(testState({ status: 'submitted' }, true)).toBe('assessed')
    expect(testState({ status: 'assessed' }, true)).toBe('assessed')
  })
})

describe('latestAssessmentByMotor', () => {
  it('uses the most recent TEST that has a result, with that test\'s latest revision', () => {
    const sessions = [session('old', 'm1', '2026-01-01T00:00:00Z'), session('new', 'm1', '2026-03-01T00:00:00Z')]
    const results = [
      result('r1', 'old', 1, 'FAULT_SUSPECTED', '2026-09-01T00:00:00Z'), // old test, reassessed very recently
      result('r2', 'new', 1, 'WARNING', '2026-03-02T00:00:00Z'),
      result('r3', 'new', 2, 'NORMAL', '2026-03-03T00:00:00Z'),
    ]
    const a = latestAssessmentByMotor(sessions, results).get('m1')
    expect(a?.sessionId).toBe('new')
    expect(a?.result.revision).toBe(2)
    expect(a?.result.overall_status).toBe('NORMAL')
  })

  it('ignores newer tests that have no result and gives nothing for motors never assessed', () => {
    const sessions = [session('a', 'm1', '2026-01-01T00:00:00Z'), session('b', 'm1', '2026-05-01T00:00:00Z'), session('c', 'm2', '2026-05-01T00:00:00Z', 'draft')]
    const m = latestAssessmentByMotor(sessions, [result('r', 'a', 1, 'WARNING')])
    expect(m.get('m1')?.sessionId).toBe('a')
    expect(m.has('m2')).toBe(false)
  })

  it('breaks a test-date tie by assessment time', () => {
    const sessions = [session('a', 'm1', '2026-01-01T00:00:00Z'), session('b', 'm1', '2026-01-01T00:00:00Z')]
    const m = latestAssessmentByMotor(sessions, [result('r1', 'a', 1, 'WARNING', '2026-02-01T00:00:00Z'), result('r2', 'b', 1, 'NORMAL', '2026-03-01T00:00:00Z')])
    expect(m.get('m1')?.sessionId).toBe('b')
  })
})

describe('buildDashboard', () => {
  it('returns real zeros for an empty database, with nothing counted as healthy', () => {
    const d = buildDashboard(overview())
    expect(d).toMatchObject({
      motorCount: 0, testCount: 0, draftCount: 0, awaitingCount: 0, assessedCount: 0, motorsWithoutAssessment: 0,
      motorStatusCounts: { NORMAL: 0, WARNING: 0, FAULT_SUSPECTED: 0, INSUFFICIENT_DATA: 0 },
      recentTests: [], recentAssessments: [],
    })
  })

  it('counts tests by state and motors by the status of their current assessment', () => {
    const d = buildDashboard(overview({
      motors: [motor('m1'), motor('m2'), motor('m3'), motor('m4')],
      sessions: [
        session('s1', 'm1', '2026-05-01T00:00:00Z'), session('s2', 'm1', '2026-06-01T00:00:00Z'), session('s3', 'm1', '2026-06-10T00:00:00Z', 'draft'),
        session('s4', 'm2', '2026-04-01T00:00:00Z'), session('s5', 'm3', '2026-04-02T00:00:00Z'),
      ],
      results: [result('r1', 's1', 1, 'WARNING'), result('r2', 's1', 2, 'NORMAL'), result('r4', 's4', 1, 'INSUFFICIENT_DATA')],
    }))
    expect(d).toMatchObject({ motorCount: 4, testCount: 5, draftCount: 1, awaitingCount: 2, assessedCount: 2 })
    // m1: its only assessed test (s1) is at revision 2 = NORMAL; the WARNING revision is history, not current
    expect(d.motorStatusCounts).toEqual({ NORMAL: 1, WARNING: 0, FAULT_SUSPECTED: 0, INSUFFICIENT_DATA: 1 })
    // m3 has a submitted test but no assessment; m4 has no tests: neither is counted as healthy
    expect(d.motorsWithoutAssessment).toBe(2)
    expect(d.motorStatusCounts.NORMAL).toBeLessThan(d.motorCount)
  })

  it('reports tests marked assessed whose results are missing instead of hiding them', () => {
    const d = buildDashboard(overview({ motors: [motor('m1')], sessions: [session('s1', 'm1', '2026-05-01T00:00:00Z', 'assessed')], results: [] }))
    expect(d.assessedWithoutResult).toBe(1)
    expect(d.awaitingCount).toBe(1) // no stored result -> shown as awaiting, never as assessed/normal
    expect(d.motorsWithoutAssessment).toBe(1)
  })

  it('lists the most recent tests and assessments first and limits them', () => {
    const sessions = Array.from({ length: 12 }, (_, i) => session(`s${i}`, 'm1', `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`))
    const results = sessions.map((s, i) => result(`r${i}`, s.id, 1, 'NORMAL', `2026-02-${String(i + 1).padStart(2, '0')}T00:00:00Z`))
    const d = buildDashboard(overview({ motors: [motor('m1')], sessions, results }))
    expect(d.recentTests).toHaveLength(8)
    expect(d.recentTests[0].id).toBe('s11')
    expect(d.recentAssessments[0].id).toBe('r11')
    expect(d.recentAssessments).toHaveLength(8)
  })

  it('does not mutate its input', () => {
    const o = overview({ motors: [motor('m1')], sessions: [session('b', 'm1', '2026-02-01T00:00:00Z'), session('a', 'm1', '2026-03-01T00:00:00Z')] })
    const copy = structuredClone(o)
    buildDashboard(o)
    expect(o).toEqual(copy)
  })
})

describe('buildDashboard — partial coverage', () => {
  it('counts NORMAL motors whose current assessment carries a COVERAGE_PARTIAL finding', () => {
    const sessions = [session('s1', 'm1', '2026-05-01T00:00:00Z', 'assessed'), session('s2', 'm2', '2026-05-01T00:00:00Z', 'assessed')]
    const results = [result('r1', 's1', 1, 'NORMAL'), result('r2', 's2', 1, 'NORMAL')]
    const d = buildDashboard(overview({ motors: [motor('m1'), motor('m2')], sessions, results, partialResultIds: ['r1'] }))
    expect(d.motorStatusCounts.NORMAL).toBe(2)
    expect(d.normalPartialCount).toBe(1)
  })
})
