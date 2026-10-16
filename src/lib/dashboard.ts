/**
 * Pure summaries over stored rows. Nothing here recomputes a diagnosis: every status shown comes from a stored
 * diagnostic_results row. Absence of an assessment is reported as "no assessment", never as healthy.
 */
import type { AssessmentStatus } from '../types'
import type { MotorRow, Overview, ResultRow, SessionRow } from '../types/overview'

export type TestState = 'draft' | 'awaiting' | 'assessed'

/** Highest revision per session (revisions are 1, 2, 3… and only ever added). */
export function latestResultBySession(results: ResultRow[]): Map<string, ResultRow> {
  const latest = new Map<string, ResultRow>()
  for (const r of results) {
    const cur = latest.get(r.test_session_id)
    if (!cur || r.revision > cur.revision) latest.set(r.test_session_id, r)
  }
  return latest
}

/** All revisions of one session, newest first. */
export function revisionsOf(results: ResultRow[], sessionId: string): ResultRow[] {
  return results.filter((r) => r.test_session_id === sessionId).sort((a, b) => b.revision - a.revision)
}

export function testState(session: Pick<SessionRow, 'status'>, hasResult: boolean): TestState {
  if (session.status === 'draft') return 'draft'
  return hasResult ? 'assessed' : 'awaiting'
}

export interface MotorAssessment {
  sessionId: string
  testTimestamp: string
  result: ResultRow
}

/**
 * A motor's current assessment = the latest revision of its most recent test (by test date) that has any
 * stored result. Ties on test date are broken by assessment time.
 */
export function latestAssessmentByMotor(sessions: SessionRow[], results: ResultRow[]): Map<string, MotorAssessment> {
  const latest = latestResultBySession(results)
  const out = new Map<string, MotorAssessment>()
  for (const s of sessions) {
    const result = latest.get(s.id)
    if (!result) continue
    const cur = out.get(s.motor_id)
    const newer =
      !cur ||
      new Date(s.test_timestamp).getTime() > new Date(cur.testTimestamp).getTime() ||
      (s.test_timestamp === cur.testTimestamp && result.assessed_at > cur.result.assessed_at)
    if (newer) out.set(s.motor_id, { sessionId: s.id, testTimestamp: s.test_timestamp, result })
  }
  return out
}

export interface Dashboard {
  motorCount: number
  testCount: number
  draftCount: number
  /** Submitted tests with no stored assessment. */
  awaitingCount: number
  assessedCount: number
  /** Motors by the status of their current assessment. */
  motorStatusCounts: Record<Exclude<AssessmentStatus, 'NOT_ASSESSED'>, number>
  /** Motors counted as NORMAL whose current assessment covered only some supported parameters. */
  normalPartialCount: number
  /** Motors with no stored assessment at all. This is NOT a healthy state. */
  motorsWithoutAssessment: number
  /** Sessions marked assessed whose result rows were not found (should be 0; shown as a data warning). */
  assessedWithoutResult: number
  recentTests: SessionRow[]
  recentAssessments: ResultRow[]
}

const RECENT = 8

export function buildDashboard(o: Overview): Dashboard {
  const latestBySession = latestResultBySession(o.results)
  const byMotor = latestAssessmentByMotor(o.sessions, o.results)

  const motorStatusCounts = { NORMAL: 0, WARNING: 0, FAULT_SUSPECTED: 0, INSUFFICIENT_DATA: 0 }
  const partialIds = new Set(o.partialResultIds ?? [])
  let normalPartialCount = 0
  for (const m of o.motors) {
    const a = byMotor.get(m.id)
    if (a && a.result.overall_status !== 'NOT_ASSESSED') {
      motorStatusCounts[a.result.overall_status]++
      if (a.result.overall_status === 'NORMAL' && partialIds.has(a.result.id)) normalPartialCount++
    }
  }

  let draft = 0
  let awaiting = 0
  let assessed = 0
  let assessedWithoutResult = 0
  for (const s of o.sessions) {
    const state = testState(s, latestBySession.has(s.id))
    if (state === 'draft') draft++
    else if (state === 'awaiting') awaiting++
    else assessed++
    if (s.status === 'assessed' && !latestBySession.has(s.id)) assessedWithoutResult++
  }

  return {
    motorCount: o.motors.length,
    testCount: o.sessions.length,
    draftCount: draft,
    awaitingCount: awaiting,
    assessedCount: assessed,
    motorStatusCounts,
    normalPartialCount,
    motorsWithoutAssessment: o.motors.filter((m: MotorRow) => !byMotor.has(m.id)).length,
    assessedWithoutResult,
    recentTests: [...o.sessions]
      .sort((a, b) => new Date(b.test_timestamp).getTime() - new Date(a.test_timestamp).getTime())
      .slice(0, RECENT),
    recentAssessments: [...o.results]
      .sort((a, b) => new Date(b.assessed_at).getTime() - new Date(a.assessed_at).getTime())
      .slice(0, RECENT),
  }
}
