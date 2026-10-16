import { lazy, Suspense, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { History } from 'lucide-react'
import DiagnosticStatusBadge from './DiagnosticStatusBadge'
import EmptyState from './EmptyState'
import LoadingState from './LoadingState'
import Notice from './Notice'
import { TruncationWarning } from './OverviewState'
import SessionStatusBadge from './SessionStatusBadge'

// The chart library is large and only needed here, so it is loaded on demand.
const TrendChart = lazy(() => import('./TrendChart'))
import { useOverview, useReadingsFor } from '../hooks/useOverview'
import { useParameterDefinitions } from '../hooks/useReference'
import { latestAssessmentByMotor, latestResultBySession, revisionsOf } from '../lib/dashboard'
import { buildTrendSeries } from '../lib/trends'
import { formatDateTime } from '../utils/format'

const RECENT_TESTS = 10
const TREND_TESTS = 100

/** Latest stored assessment, recent tests and comparable trends for one motor. Statuses are read from stored results. */
export default function MotorHistory({ motorId }: { motorId: string }) {
  const overview = useOverview()
  const defs = useParameterDefinitions()
  const data = overview.data
  const isPartial = (resultId: string) => data?.partialResultIds?.includes(resultId) ?? false

  const sessions = useMemo(
    () =>
      (data?.sessions ?? [])
        .filter((s) => s.motor_id === motorId)
        .sort((a, b) => new Date(b.test_timestamp).getTime() - new Date(a.test_timestamp).getTime()),
    [data, motorId],
  )
  const latestBySession = useMemo(() => latestResultBySession(data?.results ?? []), [data])
  const current = useMemo(() => latestAssessmentByMotor(sessions, data?.results ?? []).get(motorId), [sessions, data, motorId])

  const trendSessions = useMemo(() => sessions.filter((s) => s.status !== 'draft').slice(0, TREND_TESTS), [sessions])
  const readings = useReadingsFor(motorId, trendSessions.map((s) => s.id))
  const series = useMemo(
    () =>
      readings.data
        ? buildTrendSeries(trendSessions, Object.fromEntries(trendSessions.map((s) => [s.id, s.measurement_method])), readings.data, defs.data ?? [])
        : [],
    [readings.data, trendSessions, defs.data],
  )

  if (overview.isPending) return <LoadingState label="Loading test history…" />
  if (overview.error) {
    return (
      <>
        <Notice kind="error">{overview.error.message}</Notice>
        <button onClick={() => overview.refetch()} className="text-sm font-medium text-amber-700 hover:underline">
          Try again
        </button>
      </>
    )
  }

  return (
    <div className="space-y-6">
      {data && <TruncationWarning truncated={data.truncated} />}

      <section aria-labelledby="latest-h">
        <h2 id="latest-h" className="mb-3 text-sm font-semibold text-slate-800">Latest assessment</h2>
        {current ? (
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <DiagnosticStatusBadge status={current.result.overall_status} partial={isPartial(current.result.id)} />
              <Link
                to={`/tests/${current.sessionId}/assessments/${current.result.revision}`}
                className="text-sm font-medium text-amber-700 hover:underline"
              >
                Open result (revision {current.result.revision})
              </Link>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              From the test of {formatDateTime(current.testTimestamp)}, assessed {formatDateTime(current.result.assessed_at)}.
              This is the stored result of that test, not a statement about today’s condition.
            </p>
          </div>
        ) : (
          <EmptyState
            icon={History}
            title="No assessment recorded"
            description="This motor has no stored assessment. That does not mean it is healthy — it has simply not been assessed."
          />
        )}
      </section>

      <section aria-labelledby="tests-h">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="tests-h" className="text-sm font-semibold text-slate-800">Recent tests</h2>
          <Link to={`/tests/new?motor=${motorId}`} className="text-sm font-medium text-amber-700 hover:underline">
            New test
          </Link>
        </div>
        {sessions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
            No tests have been recorded for this motor.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Recent tests of this motor</caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3">Test date</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sessions.slice(0, RECENT_TESTS).map((s) => {
                  const r = latestBySession.get(s.id)
                  return (
                    <tr key={s.id} className="align-top">
                      <th scope="row" className="px-4 py-3 font-medium">{formatDateTime(s.test_timestamp)}</th>
                      <td className="px-4 py-3">
                        {r ? (
                          <div className="space-y-1">
                            <DiagnosticStatusBadge status={r.overall_status} partial={isPartial(r.id)} />
                            <p className="text-xs text-slate-500">
                              Revision {r.revision} of {revisionsOf(data?.results ?? [], s.id).length}
                            </p>
                            <Link to={`/tests/${s.id}/assessments/${r.revision}`} className="text-xs font-medium text-amber-700 hover:underline">
                              Open result
                            </Link>
                          </div>
                        ) : (
                          // No stored assessment: show the test's own state (draft / submitted — awaiting assessment).
                          <SessionStatusBadge status={s.status} />
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link to={`/tests/${s.id}`} className="text-slate-600 hover:text-amber-700 hover:underline">
                          {s.status === 'draft' ? 'Continue' : 'View'}
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {sessions.length > RECENT_TESTS && (
          <p className="mt-2 text-xs text-slate-500">
            Showing the {RECENT_TESTS} most recent of {sessions.length} tests. <Link to="/history" className="underline">All tests</Link>
          </p>
        )}
      </section>

      <section aria-labelledby="trend-h">
        <h2 id="trend-h" className="mb-3 text-sm font-semibold text-slate-800">Measurement trends</h2>
        {trendSessions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
            Trends use submitted tests. None have been recorded for this motor yet.
          </p>
        ) : readings.isPending ? (
          <LoadingState label="Loading readings…" />
        ) : readings.error ? (
          <>
            <Notice kind="error">{readings.error.message}</Notice>
            <button onClick={() => readings.refetch()} className="text-sm font-medium text-amber-700 hover:underline">
              Try again
            </button>
          </>
        ) : series.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
            No readings with a comparable unit are available yet.
          </p>
        ) : (
          <Suspense fallback={<LoadingState label="Loading chart…" />}>
            <TrendChart series={series} />
          </Suspense>
        )}
        {trendSessions.length === TREND_TESTS && (
          <p className="mt-2 text-xs text-slate-500">Trends use the {TREND_TESTS} most recent submitted tests.</p>
        )}
      </section>
    </div>
  )
}
