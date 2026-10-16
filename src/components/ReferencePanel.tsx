import { Link } from 'react-router-dom'
import { CircleAlert, CircleHelp, CircleCheck } from 'lucide-react'
import { checkProfileCompatibility } from '../lib/profileMatch'
import type { Motor } from '../types/motor'
import type { ReferenceProfileWithCount } from '../types/reference'

interface Props {
  motor: Motor | undefined
  testTime: Date | null
  profiles: ReferenceProfileWithCount[] | undefined
  loading: boolean
  error?: string | null
}

/**
 * Shows which APPROVED reference profiles could apply to the selected motor. Information only:
 * the profile used for an assessment is chosen and recorded in a later phase.
 */
export default function ReferencePanel({ motor, testTime, profiles, loading, error }: Props) {
  let body
  if (!motor) {
    body = <p className="text-sm text-slate-500">Select a motor to see which approved reference profiles could apply.</p>
  } else if (loading) {
    body = <p className="text-sm text-slate-500">Loading reference profiles…</p>
  } else if (error) {
    body = <p role="alert" className="text-sm text-red-700">{error}</p>
  } else {
    const when = testTime ?? new Date()
    const approved = (profiles ?? []).filter((p) => p.approval_status === 'approved')
    const results = approved.map((p) => ({ p, m: checkProfileCompatibility(p, motor, when) }))
    const compatible = results.filter((r) => r.m.status === 'compatible')
    const unknown = results.filter((r) => r.m.status === 'unknown')
    const incompatible = results.filter((r) => r.m.status === 'incompatible')

    body = (
      <div className="space-y-3 text-sm">
        {compatible.length === 0 && unknown.length === 0 && (
          <p role="status" className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              <strong>No compatible approved reference profile is available for this motor.</strong> You can still record
              and submit measurements, but they cannot be assessed against reference limits until a suitable approved
              profile exists (the result would be “insufficient data”). Manage profiles under Reference Data.
            </span>
          </p>
        )}
        {compatible.map(({ p }) => (
          <ProfileLine key={p.id} icon="ok" id={p.id} name={p.name} version={p.version} source={p.source_name} limits={p.limit_count} />
        ))}
        {unknown.map(({ p, m }) => (
          <ProfileLine
            key={p.id}
            icon="unknown"
            id={p.id}
            name={p.name}
            version={p.version}
            source={p.source_name}
            limits={p.limit_count}
            note={`Applicability cannot be established: ${m.reasons.join(' ')}`}
          />
        ))}
        {incompatible.length > 0 && (
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer">{incompatible.length} approved profile(s) not applicable to this motor</summary>
            <ul className="mt-2 space-y-1">
              {incompatible.map(({ p, m }) => (
                <li key={p.id}>
                  <strong>{p.name} v{p.version}:</strong> {m.reasons.join(' ')}
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="text-xs text-slate-500">
          Compatibility uses only the profile’s recorded motor type, effective dates and applicable specifications.
          The profile used for an assessment is chosen and recorded when the test is assessed, not here.
        </p>
      </div>
    )
  }

  return (
    <section aria-labelledby="ref-panel" className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 id="ref-panel" className="mb-3 text-sm font-semibold text-slate-800">Applicable reference profiles</h2>
      {body}
    </section>
  )
}

function ProfileLine(props: {
  icon: 'ok' | 'unknown'
  id: string
  name: string
  version: number
  source: string
  limits: number
  note?: string
}) {
  const Icon = props.icon === 'ok' ? CircleCheck : CircleHelp
  return (
    <div className="flex gap-2">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${props.icon === 'ok' ? 'text-emerald-600' : 'text-amber-600'}`} aria-hidden />
      <div>
        <Link to={`/reference/${props.id}`} target="_blank" rel="noopener" className="font-medium text-slate-900 hover:text-amber-700 hover:underline">
          {props.name} v{props.version}
        </Link>{' '}
        <span className="text-slate-500">— {props.source}, {props.limits} limit(s)</span>
        {props.note && <p className="text-xs text-amber-800">{props.note}</p>}
      </div>
    </div>
  )
}
