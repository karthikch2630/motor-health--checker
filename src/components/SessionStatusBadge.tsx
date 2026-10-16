import type { SessionStatus } from '../types/test'

const styles: Record<SessionStatus, { cls: string; label: string }> = {
  draft: { cls: 'bg-amber-100 text-amber-800 ring-amber-300', label: 'Draft' },
  submitted: { cls: 'bg-sky-100 text-sky-800 ring-sky-300', label: 'Submitted — awaiting assessment' },
  assessed: { cls: 'bg-slate-200 text-slate-700 ring-slate-300', label: 'Assessed' },
}

/** Test workflow status. This is NOT a diagnostic result; it says nothing about the motor's condition. */
export default function SessionStatusBadge({ status }: { status: SessionStatus }) {
  const s = styles[status]
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}`}>
      {s.label}
    </span>
  )
}
