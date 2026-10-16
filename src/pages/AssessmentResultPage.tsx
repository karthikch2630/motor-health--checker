import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import AssessmentResultView from '../components/AssessmentResultView'
import DiagnosticStatusBadge from '../components/DiagnosticStatusBadge'
import LoadingState from '../components/LoadingState'
import Notice from '../components/Notice'
import PageHeader from '../components/PageHeader'
import ReviewPanel from '../components/ReviewPanel'
import { useAssessments } from '../hooks/useAssessments'
import { useMotors } from '../hooks/useMotors'
import { useParameterDefinitions, useProfiles } from '../hooks/useReference'
import { useTest } from '../hooks/useTests'
import { dataOriginOf } from '../lib/dataOrigin'
import { notCheckedParameters } from '../lib/partialCoverage'
import { formatDateTime } from '../utils/format'

/** /tests/:id/assessments/:revision — one stored revision, shown exactly as saved. */
export default function AssessmentResultPage() {
  const { id, revision } = useParams()
  const rev = Number(revision)
  const test = useTest(id)
  const assessments = useAssessments(id)
  const motors = useMotors()
  const defs = useParameterDefinitions()
  const profiles = useProfiles()

  const parameterNames = useMemo(() => Object.fromEntries((defs.data ?? []).map((d) => [d.code, d.display_name])), [defs.data])
  const profileNames = useMemo(() => Object.fromEntries((profiles.data ?? []).map((p) => [p.id, p.name])), [profiles.data])

  const profileDetails = useMemo(
    () => Object.fromEntries((profiles.data ?? []).map((p) => [p.id, { approval_status: p.approval_status, source_name: p.source_name }])),
    [profiles.data],
  )

  const back = (
    <Link to={id ? `/tests/${id}` : '/history'} className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-amber-700">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Back to the test
    </Link>
  )

  if (test.isPending || assessments.isPending || motors.isPending || defs.isPending) return <LoadingState label="Loading assessment…" />
  const error = test.error ?? assessments.error ?? motors.error ?? defs.error
  if (error) {
    return (
      <>
        {back}
        <Notice kind="error">{error.message}</Notice>
        <button
          onClick={() => {
            void test.refetch()
            void assessments.refetch()
          }}
          className="text-sm font-medium text-amber-700 hover:underline"
        >
          Try again
        </button>
      </>
    )
  }

  const all = assessments.data ?? []
  const selected = all.find((r) => r.revision === rev)
  if (!test.data || !selected) {
    return (
      <>
        {back}
        <Notice kind="error">This assessment revision was not found.</Notice>
      </>
    )
  }

  const latestRevision = Math.max(...all.map((r) => r.revision))
  const isLatest = selected.revision === latestRevision
  const session = test.data.session
  const motor = motors.data?.find((m) => m.id === session.motor_id)
  const c = session.operating_conditions ?? {}

  return (
    <>
      {back}
      <PageHeader
        title={`Assessment — ${motor?.motor_tag ?? 'motor'} · revision ${selected.revision}`}
        subtitle={`Test of ${formatDateTime(session.test_timestamp)}. Shown exactly as saved; nothing is recalculated.`}
      />

      {!isLatest && (
        <Notice kind="error">
          This is an earlier revision. The latest is{' '}
          <Link className="font-medium underline" to={`/tests/${session.id}/assessments/${latestRevision}`}>
            revision {latestRevision}
          </Link>
          . Earlier revisions are kept for traceability.
        </Notice>
      )}

      <div className="space-y-6">
        <AssessmentResultView
          result={selected}
          heading="Assessment"
          isLatest={isLatest}
          parameterNames={parameterNames}
          profileNames={profileNames}
          profileDetails={profileDetails}
        />

        <section aria-labelledby="revisions-h">
          <h2 id="revisions-h" className="mb-3 text-sm font-semibold text-slate-800">All revisions of this test</h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Assessment revisions</caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3">Revision</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Assessed</th>
                  <th scope="col" className="px-4 py-3">Profile</th>
                  <th scope="col" className="px-4 py-3">Rule version</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {all.map((r) => (
                  <tr key={r.id} className={r.revision === selected.revision ? 'bg-amber-50' : undefined}>
                    <th scope="row" className="px-4 py-3 font-medium">
                      <Link to={`/tests/${session.id}/assessments/${r.revision}`} className="hover:text-amber-700 hover:underline">
                        Revision {r.revision}
                      </Link>
                      {r.revision === latestRevision && <span className="ml-2 text-xs text-sky-700">Latest</span>}
                    </th>
                    <td className="px-4 py-3"><DiagnosticStatusBadge status={r.overall_status} partial={r.overall_status === 'NORMAL' && notCheckedParameters(r.findings, Object.keys(parameterNames), r.reference_profile_id !== null).length > 0} /></td>
                    <td className="px-4 py-3">{formatDateTime(r.assessed_at)}</td>
                    <td className="px-4 py-3">
                      {r.reference_profile_id ? `${profileNames[r.reference_profile_id] ?? 'Profile'} v${r.reference_profile_version}` : 'None applied'}
                    </td>
                    <td className="px-4 py-3">{r.diagnostic_engine_version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="snapshot-h">
          <h2 id="snapshot-h" className="mb-3 text-sm font-semibold text-slate-800">Readings these revisions were based on</h2>
          <ReviewPanel
            motor={motor}
            testTimestamp={session.test_timestamp}
            method={session.measurement_method}
            operator={typeof c.operator === 'string' ? c.operator : null}
            conditions={typeof c.description === 'string' ? c.description : null}
            loadCondition={typeof c.load_condition === 'string' ? c.load_condition : null}
            dataOrigin={dataOriginOf(c)}
            notes={session.notes}
            definitions={defs.data ?? []}
            readings={test.data.readings}
          />
          <p className="mt-2 text-xs text-slate-500">
            Submitted readings cannot be changed, so these are the values every revision of this test was computed from.
            Motor: {motor ? <Link className="underline" to={`/motors/${motor.id}`}>{motor.motor_tag} — {motor.name}</Link> : 'not available'}.
          </p>
        </section>
      </div>
    </>
  )
}
