import { useMemo, useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import AssessmentResultView from './AssessmentResultView'
import EmptyState from './EmptyState'
import LoadingState from './LoadingState'
import Notice from './Notice'
import { useAssessments, useRunAssessment } from '../hooks/useAssessments'
import { useSingleFlight } from '../hooks/useSingleFlight'
import { checkProfileCompatibility } from '../lib/profileMatch'
import { motorCoverage } from '../lib/profileCoverage'
import { DATA_ORIGIN_LABELS, dataOriginOf } from '../lib/dataOrigin'
import type { Motor } from '../types/motor'
import type { ParameterDefinition, ReferenceProfileWithCount } from '../types/reference'
import type { TestReading, TestSession } from '../types/test'

interface Props {
  session: TestSession
  readings: TestReading[]
  motor: Motor | undefined
  definitions: ParameterDefinition[]
  profiles: ReferenceProfileWithCount[] | undefined
  profileNames: Record<string, string>
}

/** Runs an assessment of a submitted test and shows every stored revision. */
export default function AssessmentPanel({ session, readings, motor, definitions, profiles, profileNames }: Props) {
  const assessments = useAssessments(session.id)
  const run = useRunAssessment()
  const flight = useSingleFlight()
  const [chosen, setChosen] = useState('')
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const parameterNames = useMemo(() => Object.fromEntries(definitions.map((d) => [d.code, d.display_name])), [definitions])

  const compatible = useMemo(() => {
    if (!motor) return []
    const when = new Date(session.test_timestamp)
    return (profiles ?? []).filter(
      (p) => p.approval_status === 'approved' && checkProfileCompatibility(p, motor, when).status === 'compatible',
    )
  }, [motor, profiles, session.test_timestamp])

  const profileDetails = useMemo(
    () => Object.fromEntries((profiles ?? []).map((p) => [p.id, { approval_status: p.approval_status, source_name: p.source_name }])),
    [profiles],
  )
  const whyNot = useMemo(
    () => (motor && compatible.length === 0 ? motorCoverage(motor, profiles ?? [], new Date(session.test_timestamp)).unusable : []),
    [motor, compatible.length, profiles, session.test_timestamp],
  )
  const origin = dataOriginOf(session.operating_conditions)
  const profileId = compatible.length === 1 ? compatible[0].id : chosen || null
  const needsChoice = compatible.length > 1 && chosen === ''
  const hasResults = (assessments.data?.length ?? 0) > 0

  function handleRun() {
    if (!motor || run.isPending || needsChoice || !flight.start()) return
    setSavedMessage(null)
    run.mutate(
      { session, readings, motor, definitions, profileId },
      { onSettled: flight.done, onSuccess: ({ saved }) => setSavedMessage(`Assessment saved as revision ${saved.revision}.`) },
    )
  }

  const [latest, ...older] = assessments.data ?? []
  const href = (revision: number) => `/tests/${session.id}/assessments/${revision}`

  return (
    <section aria-labelledby="assessment-h" className="space-y-4">
      <h2 id="assessment-h" className="text-sm font-semibold text-slate-800">Diagnostic assessment</h2>

      {savedMessage && <Notice kind="success">{savedMessage}</Notice>}
      {run.error && <Notice kind="error">{run.error.message}</Notice>}

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        {compatible.length > 1 && (
          <fieldset className="mb-4">
            <legend className="text-sm font-medium text-slate-800">Several approved profiles apply — choose one</legend>
            <div className="mt-2 space-y-1">
              {compatible.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="profile" value={p.id} checked={chosen === p.id} onChange={() => setChosen(p.id)} />
                  {p.name} v{p.version} <span className="text-slate-500">— {p.source_name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {compatible.length === 1 && (
          <p className="mb-3 text-sm text-slate-700">
            Will compare against <strong>{compatible[0].name} v{compatible[0].version}</strong> ({compatible[0].source_name}).
          </p>
        )}
        {compatible.length === 0 && (
          <p className="mb-3 text-sm text-amber-900">
            No compatible approved reference profile exists for this motor and test date. Running the assessment will
            record an <strong>Insufficient data</strong> result with the reason; nothing is compared.
          </p>
        )}
        {compatible.length === 0 && (
          <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
            <p className="font-medium">Why no profile applies</p>
            {whyNot.length === 0 ? (
              <p className="mt-1 text-slate-600">No reference profile exists yet. Create and approve one in Reference Data, from a documented source.</p>
            ) : (
              <ul className="mt-1 list-disc pl-5 text-slate-600">
                {whyNot.map(({ profile, match }) => (
                  <li key={profile.id}><strong>{profile.name} v{profile.version}:</strong> {match.reasons.join(' ')}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <p className={`mb-3 rounded-md px-3 py-2 text-xs ${origin === 'synthetic' ? 'border border-amber-300 bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-600'}`}>
          Readings: <strong>{origin ? DATA_ORIGIN_LABELS[origin] : 'origin not stated'}</strong>.
          {origin === 'synthetic' && ' This result demonstrates the application and is not engineering evidence about any motor.'}
        </p>
        <button
          onClick={handleRun}
          disabled={run.isPending || needsChoice || !motor}
          className="inline-flex items-center gap-2 rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
          {run.isPending ? 'Assessing…' : hasResults ? 'Run reassessment (new revision)' : 'Run assessment'}
        </button>
        {hasResults && (
          <p className="mt-2 text-xs text-slate-500">A reassessment adds a new revision. Earlier results are kept unchanged.</p>
        )}
      </div>

      {assessments.isPending ? (
        <LoadingState label="Loading assessments…" />
      ) : assessments.error ? (
        <Notice kind="error">{assessments.error.message}</Notice>
      ) : !latest ? (
        <EmptyState icon={Play} title="Not assessed" description="No assessment has been run for this test yet." />
      ) : (
        <>
          <AssessmentResultView
            result={latest}
            heading="Current assessment"
            isLatest
            parameterNames={parameterNames}
            profileNames={profileNames}
            profileDetails={profileDetails}
            openHref={href(latest.revision)}
          />
          {older.length > 0 && (
            <details className="rounded-lg border border-slate-200 bg-white p-4">
              <summary className="cursor-pointer text-sm font-medium text-slate-700">Earlier revisions ({older.length})</summary>
              <div className="mt-4 space-y-4">
                {older.map((r) => (
                  <AssessmentResultView
                    key={r.id}
                    result={r}
                    heading={`Revision ${r.revision}`}
                    isLatest={false}
                    parameterNames={parameterNames}
                    profileNames={profileNames}
                    profileDetails={profileDetails}
                    openHref={href(r.revision)}
                  />
                ))}
              </div>
            </details>
          )}
        </>
      )}

      <p className="text-xs text-slate-500">
        This is decision support. It compares readings with the approved limits of one reference profile and does not
        replace qualified inspection or electrical safety procedures. A “fault suspected” status is never a confirmed diagnosis.
      </p>
    </section>
  )
}
