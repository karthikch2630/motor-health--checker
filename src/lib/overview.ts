/**
 * Read-only queries for the dashboard, history and motor pages. Runs as the signed-in user (RLS applies).
 *
 * Supabase APIs return at most 1000 rows per request. Each query asks for the exact total and reports
 * `truncated` when the total exceeds what was returned, so the UI can warn instead of showing silently
 * wrong counts. A failed query throws; it is never turned into an empty list or a zero count.
 */
import { supabase } from './supabase'
import { DataError, describeDbError } from './motors'
import type { MotorRow, Overview, ResultRow, SessionRow } from '../types/overview'
import type { TestReading } from '../types/test'

export const PAGE_LIMIT = 1000

/** Column lists used by getOverview (exported so the database tests can run them against the real schema). */
export const OVERVIEW_COLUMNS = {
  motors: 'id,motor_tag,name,motor_type',
  test_sessions: 'id,motor_id,test_timestamp,measurement_method,status,created_at',
  diagnostic_results:
    'id,test_session_id,revision,overall_status,assessed_at,reference_profile_id,reference_profile_version,diagnostic_engine_version',
} as const

function client() {
  if (!supabase) throw new DataError('Supabase is not configured.')
  return supabase
}

async function fetchRows<T>(table: string, columns: string, orderBy: string): Promise<{ rows: T[]; truncated: boolean }> {
  const { data, error, count } = await client()
    .from(table)
    .select(columns, { count: 'exact' })
    .order(orderBy, { ascending: false })
    .range(0, PAGE_LIMIT - 1)
  if (error) throw error
  const rows = (data ?? []) as T[]
  const truncated = count === null || count === undefined ? rows.length >= PAGE_LIMIT : count > rows.length
  return { rows, truncated }
}

/** Three requests in parallel; any failure rejects the whole overview. */
export async function getOverview(): Promise<Overview> {
  try {
    const [motors, sessions, results, partial] = await Promise.all([
      fetchRows<MotorRow>('motors', OVERVIEW_COLUMNS.motors, 'motor_tag'),
      fetchRows<SessionRow>('test_sessions', OVERVIEW_COLUMNS.test_sessions, 'test_timestamp'),
      fetchRows<ResultRow>(
        'diagnostic_results',
        OVERVIEW_COLUMNS.diagnostic_results,
        'assessed_at',
      ),
      client().from('diagnostic_findings').select('diagnostic_result_id').eq('rule_code', 'COVERAGE_PARTIAL').range(0, PAGE_LIMIT - 1),
    ])
    if (partial.error) throw partial.error
    return {
      motors: motors.rows,
      sessions: sessions.rows,
      results: results.rows,
      partialResultIds: (partial.data ?? []).map((r) => r.diagnostic_result_id as string),
      truncated: { motors: motors.truncated, sessions: sessions.truncated, results: results.truncated },
    }
  } catch (error) {
    throw error instanceof DataError ? error : new DataError(describeDbError(error))
  }
}

/** Readings of the given (non-draft) tests, for trend charts. */
export async function listReadingsForSessions(sessionIds: string[]): Promise<TestReading[]> {
  if (sessionIds.length === 0) return []
  try {
    const { data, error } = await client().from('test_readings').select('*').in('test_session_id', sessionIds)
    if (error) throw error
    return (data ?? []) as TestReading[]
  } catch (error) {
    throw error instanceof DataError ? error : new DataError(describeDbError(error))
  }
}
