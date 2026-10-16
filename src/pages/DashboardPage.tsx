import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, Plus, Settings2, History } from 'lucide-react'
import DiagnosticStatusBadge from '../components/DiagnosticStatusBadge'
import EmptyState from '../components/EmptyState'
import { OverviewStatus, TruncationWarning } from '../components/OverviewState'
import Notice from '../components/Notice'
import PageHeader from '../components/PageHeader'
import SessionStatusBadge from '../components/SessionStatusBadge'
import { useOverview } from '../hooks/useOverview'
import { buildDashboard, latestResultBySession } from '../lib/dashboard'
import { formatDateTime } from '../utils/format'
import type { AssessmentStatus } from '../types'

const action =
  'inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50'

function Stat({ label, value, hint, to }: { label: string; value: number; hint?: string; to?: string }) {
  const body = (
    <>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-3xl font-semibold text-slate-900">{value}</dd>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </>
  )
  const cls = 'block rounded-lg border border-slate-200 bg-white p-4'
  return to ? <Link to={to} className={`${cls} hover:border-amber-400`}>{body}</Link> : <div className={cls}>{body}</div>
}

const STATUS_ORDER: Exclude<AssessmentStatus, 'NOT_ASSESSED'>[] = ['NORMAL', 'WARNING', 'FAULT_SUSPECTED', 'INSUFFICIENT_DATA']

export default function DashboardPage() {
  const overview = useOverview()
  const data = overview.data
  const dash = useMemo(() => (data ? buildDashboard(data) : null), [data])
  const motorTag = useMemo(() => new Map((data?.motors ?? []).map((m) => [m.id, m.motor_tag])), [data])
  const latestBySession = useMemo(() => latestResultBySession(data?.results ?? []), [data])
  const sessionMotor = useMemo(() => new Map((data?.sessions ?? []).map((s) => [s.id, s.motor_id])), [data])

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Live summary of your motors, tests and stored assessments." />

      <div className="mb-6 flex flex-wrap gap-2">
        <Link to="/motors/new" className={action}><Plus className="h-4 w-4" aria-hidden /> Add motor</Link>
        <Link to="/motors" className={action}><Settings2 className="h-4 w-4" aria-hidden /> View motors</Link>
        <Link to="/tests/new" className={action}><ClipboardList className="h-4 w-4" aria-hidden /> Start new test</Link>
        <Link to="/history" className={action}><History className="h-4 w-4" aria-hidden /> View test history</Link>
      </div>

      <OverviewStatus isPending={overview.isPending} error={overview.error} onRetry={() => overview.refetch()} loadingLabel="Loading dashboard…" />

      {data && dash && (
        <>
          <TruncationWarning truncated={data.truncated} />
          {dash.assessedWithoutResult > 0 && (
            <Notice kind="error">
              {dash.assessedWithoutResult} test(s) are marked assessed but no stored assessment was found for them. Reload;
              if this persists, check the database.
            </Notice>
          )}

          {dash.motorCount === 0 ? (
            <EmptyState
              icon={Settings2}
              title="No motors registered"
              description="Register a motor, record a test and run an assessment. Nothing on this page is sample data; counts appear as you add records."
            />
          ) : (
            <div className="space-y-8">
              <section aria-labelledby="totals-h">
                <h2 id="totals-h" className="sr-only">Totals</h2>
                <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat label="Registered motors" value={dash.motorCount} to="/motors" />
                  <Stat label="Test sessions" value={dash.testCount} hint={`${dash.draftCount} draft`} to="/history" />
                  <Stat label="Awaiting assessment" value={dash.awaitingCount} hint="Submitted, no assessment yet" to="/history" />
                  <Stat label="Assessed tests" value={dash.assessedCount} />
                </dl>
              </section>

              <section aria-labelledby="status-h">
                <h2 id="status-h" className="mb-1 text-sm font-semibold text-slate-800">Motors by latest assessment</h2>
                <p className="mb-3 text-xs text-slate-500">
                  Each motor is counted once, by the stored status of its most recent assessed test. Motors without any
                  assessment are shown separately and are <strong>not</strong> considered healthy.
                </p>
                <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  {STATUS_ORDER.map((s) => (
                    <div key={s} className="rounded-lg border border-slate-200 bg-white p-4">
                      <dt><DiagnosticStatusBadge status={s} /></dt>
                      <dd className="mt-2 text-3xl font-semibold text-slate-900">{dash.motorStatusCounts[s]}</dd>
                      {s === 'NORMAL' && dash.normalPartialCount > 0 && (
                        <dd className="mt-1 text-xs text-amber-800">
                          {dash.normalPartialCount} of these cover only some parameters - not a full health check.
                        </dd>
                      )}
                    </div>
                  ))}
                  <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4">
                    <dt className="text-xs font-semibold text-slate-600">No assessment yet</dt>
                    <dd className="mt-2 text-3xl font-semibold text-slate-900">{dash.motorsWithoutAssessment}</dd>
                  </div>
                </dl>
              </section>

              <div className="grid gap-8 lg:grid-cols-2">
                <section aria-labelledby="rt-h">
                  <h2 id="rt-h" className="mb-3 text-sm font-semibold text-slate-800">Recent tests</h2>
                  {dash.recentTests.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
                      No tests yet. <Link to="/tests/new" className="font-medium text-amber-700 underline">Start a new test</Link>.
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
                      {dash.recentTests.map((s) => {
                        const r = latestBySession.get(s.id)
                        return (
                          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                            <span>
                              <Link to={`/tests/${s.id}`} className="font-medium hover:text-amber-700 hover:underline">{motorTag.get(s.motor_id) ?? '—'}</Link>
                              <span className="ml-2 text-xs text-slate-500">{formatDateTime(s.test_timestamp)}</span>
                            </span>
                            {r ? <DiagnosticStatusBadge status={r.overall_status} partial={data?.partialResultIds?.includes(r.id) ?? false} /> : <SessionStatusBadge status={s.status} />}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>

                <section aria-labelledby="ra-h">
                  <h2 id="ra-h" className="mb-3 text-sm font-semibold text-slate-800">Recent assessments</h2>
                  {dash.recentAssessments.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
                      No assessments yet. Submit a test and run an assessment from its page.
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
                      {dash.recentAssessments.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                          <span>
                            <Link to={`/tests/${r.test_session_id}/assessments/${r.revision}`} className="font-medium hover:text-amber-700 hover:underline">
                              {motorTag.get(sessionMotor.get(r.test_session_id) ?? '') ?? '—'} · revision {r.revision}
                            </Link>
                            <span className="ml-2 text-xs text-slate-500">{formatDateTime(r.assessed_at)}</span>
                          </span>
                          <DiagnosticStatusBadge status={r.overall_status} partial={data?.partialResultIds?.includes(r.id) ?? false} />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}
