import { Link } from 'react-router-dom'
import DiagnosticStatusBadge from './DiagnosticStatusBadge'
import { isAssessmentComplete } from '../lib/diagnostics'
import { notCheckedParameters } from '../lib/partialCoverage'
import { DASH, formatDateTime } from '../utils/format'
import type { StoredAssessment, StoredFinding } from '../types/assessment'

interface Props {
  result: StoredAssessment
  heading: string
  /** True for the highest revision of the test. */
  isLatest: boolean
  /** parameter_code -> display name (falls back to the code). */
  parameterNames?: Record<string, string>
  /** profile id -> name for the link text. */
  profileNames?: Record<string, string>
  /** Optional link to the dedicated page for this revision. */
  openHref?: string
}

const sevLabel = { CRITICAL: 'Critical', WARNING: 'Warning', INFO: 'Info' } as const
const sevClass = { CRITICAL: 'text-red-700', WARNING: 'text-amber-800', INFO: 'text-slate-500' } as const
const order = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const

/** Rule-code prefixes that mean a check could not be performed (see diagnostics.ts isAssessmentComplete). */
const isUnevaluated = (f: StoredFinding) => /^(DATA_|CONFIG_|PROFILE_)/.test(f.rule_code)

/**
 * Renders exactly what was stored: status, summary, profile id/version, rule version and every finding.
 * Nothing here is recalculated, so old revisions look the same whatever has changed since.
 */
export default function AssessmentResultView({ result, heading, isLatest, parameterNames = {}, profileNames = {}, openHref }: Props) {
  const complete = isAssessmentComplete(result.findings.map((f) => ({ ruleCode: f.rule_code })))
  const unevaluated = result.findings.filter(isUnevaluated)
  const findings = [...result.findings].sort(
    (a, b) => order[a.severity] - order[b.severity] || (a.parameter_code ?? '').localeCompare(b.parameter_code ?? ''),
  )
  const nameOf = (code: string | null) => (code ? (parameterNames[code] ?? code) : DASH)
  // Catalog parameters the applied profile has no finding for. Display only; the stored status is not recomputed.
  const notChecked = notCheckedParameters(result.findings, Object.keys(parameterNames), result.reference_profile_id !== null)
  // A NORMAL that does not cover every supported parameter is partial (also true for revisions saved before engine 1.1.0).
  const partialNormal = result.overall_status === 'NORMAL' && notChecked.length > 0

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
          {heading} · revision {result.revision}
          {isLatest ? (
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800 ring-1 ring-inset ring-sky-300">Latest</span>
          ) : (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-300">Earlier revision</span>
          )}
        </h3>
        <div className="flex items-center gap-3">
          {openHref && (
            <Link to={openHref} className="text-xs font-medium text-amber-700 hover:underline">
              Open this revision
            </Link>
          )}
          <DiagnosticStatusBadge status={result.overall_status} partial={partialNormal} />
          {partialNormal && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-inset ring-amber-300">Partial coverage</span>
          )}
        </div>
      </div>

      <p className="mt-3 text-sm text-slate-800">{result.summary}</p>

      {result.overall_status === 'FAULT_SUSPECTED' && (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          Fault suspected means an approved limit was crossed and the situation needs verification and qualified
          inspection. It is not a confirmed diagnosis.
        </p>
      )}

      {!complete && (
        <div role="note" className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">Incomplete assessment: some required checks could not be performed.</p>
          <p className="mt-1">
            This result must not be read as proof that the motor is healthy. Warnings and suspected faults found
            above are still valid; the parameters below were not checked:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {unevaluated.map((f) => (
              <li key={f.id}>
                {f.parameter_code ? <strong>{nameOf(f.parameter_code)}: </strong> : null}
                {f.finding_description}
              </li>
            ))}
          </ul>
        </div>
      )}

      {notChecked.length > 0 && (
        <p
          role="note"
          className={
            partialNormal
              ? 'mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900'
              : 'mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700'
          }
        >
          {partialNormal && <strong>Partial assessment - not a statement that the motor is healthy. </strong>}
          Not covered by this profile (not checked): {notChecked.map(nameOf).join(', ')}.
        </p>
      )}

      <dl className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
        <div>
          <dt className="uppercase tracking-wide text-slate-500">Reference profile</dt>
          <dd>
            {result.reference_profile_id ? (
              <Link to={`/reference/${result.reference_profile_id}`} className="hover:underline">
                {profileNames[result.reference_profile_id] ?? 'Profile'} v{result.reference_profile_version}
              </Link>
            ) : (
              'None applied'
            )}
          </dd>
        </div>
        <div>
          <dt className="uppercase tracking-wide text-slate-500">Rule version</dt>
          <dd>{result.diagnostic_engine_version}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-wide text-slate-500">Assessed</dt>
          <dd>{formatDateTime(result.assessed_at)}</dd>
        </div>
      </dl>

      {findings.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Findings of revision {result.revision}</caption>
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="py-2 pr-3">Severity</th>
                <th scope="col" className="py-2 pr-3">Parameter</th>
                <th scope="col" className="min-w-56 py-2 pr-3">Explanation</th>
                <th scope="col" className="py-2 pr-3">Measured</th>
                <th scope="col" className="py-2">Boundary used</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {findings.map((f) => (
                <tr key={f.id} className="align-top">
                  <td className={`py-2 pr-3 font-medium ${sevClass[f.severity]}`}>{sevLabel[f.severity]}</td>
                  <td className="py-2 pr-3">{nameOf(f.parameter_code)}</td>
                  <td className="min-w-56 py-2 pr-3">
                    {f.finding_description}
                    {f.recommended_action && <p className="mt-1 text-xs text-slate-500">Suggested: {f.recommended_action}</p>}
                    <p className="mt-0.5 font-mono text-[10px] text-slate-400">{f.rule_code}</p>
                  </td>
                  <td className="py-2 pr-3">{f.observed_value === null ? DASH : `${f.observed_value} ${f.observed_unit ?? ''}`}</td>
                  <td className="py-2">{f.applicable_limit === null ? DASH : `${f.applicable_limit} ${f.observed_unit ?? ''}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
