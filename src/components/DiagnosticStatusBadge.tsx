import type { AssessmentStatus } from '../types'

const styles: Record<AssessmentStatus, { cls: string; label: string }> = {
  NORMAL: { cls: 'bg-emerald-100 text-emerald-800 ring-emerald-300', label: 'Normal' },
  WARNING: { cls: 'bg-amber-100 text-amber-900 ring-amber-300', label: 'Warning' },
  FAULT_SUSPECTED: { cls: 'bg-red-100 text-red-800 ring-red-300', label: 'Fault suspected' },
  INSUFFICIENT_DATA: { cls: 'bg-slate-200 text-slate-800 ring-slate-400', label: 'Insufficient data' },
  NOT_ASSESSED: { cls: 'bg-slate-100 text-slate-600 ring-slate-300', label: 'Not assessed' },
}

/** Diagnostic assessment status. Text always accompanies colour. */
export default function DiagnosticStatusBadge({ status, partial = false }: { status: AssessmentStatus; partial?: boolean }) {
  // A NORMAL that covers only some supported parameters is never shown as a plain, healthy-looking "Normal".
  if (status === 'NORMAL' && partial) {
    return (
      <span
        title="Normal for the parameters the profile covers; other parameters were not checked. Not a statement that the motor is healthy."
        className="inline-block whitespace-nowrap rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-900 ring-1 ring-inset ring-amber-300"
      >
        Normal (partial)
      </span>
    )
  }
  const s = styles[status]
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${s.cls}`}>
      {s.label}
    </span>
  )
}
