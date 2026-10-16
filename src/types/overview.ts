/** Light-weight row shapes used for lists, the dashboard and history (no findings, no readings). */
import type { AssessmentStatus } from './index'
import type { SessionStatus } from './test'

export interface MotorRow {
  id: string
  motor_tag: string
  name: string
  motor_type: string
}

export interface SessionRow {
  id: string
  motor_id: string
  test_timestamp: string
  measurement_method: string | null
  status: SessionStatus
  created_at: string
}

export interface ResultRow {
  id: string
  test_session_id: string
  revision: number
  overall_status: AssessmentStatus
  assessed_at: string
  reference_profile_id: string | null
  reference_profile_version: number | null
  diagnostic_engine_version: string
}

/** Everything the dashboard, history and motor pages need, fetched once and cached. */
export interface Overview {
  motors: MotorRow[]
  sessions: SessionRow[]
  results: ResultRow[]
  /** Ids of results that carry a COVERAGE_PARTIAL finding (their profile left supported parameters unchecked). */
  partialResultIds?: string[]
  /** True per table when the database holds more rows than were fetched, so figures may be incomplete. */
  truncated: { motors: boolean; sessions: boolean; results: boolean }
}
