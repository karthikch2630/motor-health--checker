import { useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { History, Plus } from 'lucide-react'
import DiagnosticStatusBadge from '../components/DiagnosticStatusBadge'
import EmptyState from '../components/EmptyState'
import Notice from '../components/Notice'
import { OverviewStatus, TruncationWarning } from '../components/OverviewState'
import PageHeader from '../components/PageHeader'
import SessionStatusBadge from '../components/SessionStatusBadge'
import { useOverview } from '../hooks/useOverview'
import { latestResultBySession, revisionsOf, testState } from '../lib/dashboard'
import { formatDateTime } from '../utils/format'

/** All tests with their stored assessment state. Statuses come from saved results; nothing is recalculated. */
export default function TestHistoryPage() {
  const overview = useOverview()
  const flash = (useLocation().state as { flash?: string } | null)?.flash
  const data = overview.data
  const tagOf = useMemo(() => new Map((data?.motors ?? []).map((m) => [m.id, m.motor_tag])), [data])
  const latest = useMemo(() => latestResultBySession(data?.results ?? []), [data])
  const sessions = useMemo(
    () => [...(data?.sessions ?? [])].sort((a, b) => new Date(b.test_timestamp).getTime() - new Date(a.test_timestamp).getTime()),
    [data],
  )

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Test History" subtitle="Every test and its stored assessment, newest first." />
        <Link
          to="/tests/new"
          className="inline-flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-400"
        >
          <Plus className="h-4 w-4" aria-hidden /> New test
        </Link>
      </div>
      {flash && <Notice kind="success">{flash}</Notice>}

      <OverviewStatus isPending={overview.isPending} error={overview.error} onRetry={() => overview.refetch()} loadingLabel="Loading tests…" />

      {data && <TruncationWarning truncated={data.truncated} />}

      {data && sessions.length === 0 && (
        <EmptyState
          icon={History}
          title="No tests recorded"
          description="Start a new test to record measurements for a registered motor. Drafts are saved here and can be continued later."
        />
      )}

      {data && sessions.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Test sessions</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3">Test date</th>
                <th scope="col" className="px-4 py-3">Motor</th>
                <th scope="col" className="px-4 py-3">Test status</th>
                <th scope="col" className="px-4 py-3">Latest assessment</th>
                <th scope="col" className="px-4 py-3"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sessions.map((s) => {
                const r = latest.get(s.id)
                const state = testState(s, !!r)
                const revisions = revisionsOf(data.results, s.id).length
                return (
                  <tr key={s.id} className="align-top hover:bg-slate-50">
                    <th scope="row" className="px-4 py-3 font-medium">{formatDateTime(s.test_timestamp)}</th>
                    <td className="px-4 py-3">
                      <Link to={`/motors/${s.motor_id}`} className="hover:text-amber-700 hover:underline">{tagOf.get(s.motor_id) ?? '—'}</Link>
                    </td>
                    <td className="px-4 py-3"><SessionStatusBadge status={s.status} /></td>
                    <td className="px-4 py-3">
                      {r ? (
                        <div className="space-y-1">
                          <DiagnosticStatusBadge status={r.overall_status} partial={data?.partialResultIds?.includes(r.id) ?? false} />
                          <p className="text-xs text-slate-500">
                            Revision {r.revision} of {revisions} · {formatDateTime(r.assessed_at)}
                          </p>
                          <Link to={`/tests/${s.id}/assessments/${r.revision}`} className="text-xs font-medium text-amber-700 hover:underline">
                            Open result
                          </Link>
                        </div>
                      ) : state === 'draft' ? (
                        <span className="text-slate-500">Draft — cannot be assessed yet</span>
                      ) : (
                        <span className="text-slate-700">Not assessed — awaiting assessment</span>
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
    </>
  )
}
