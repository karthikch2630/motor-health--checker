import type { ApprovalStatus } from '../types/reference'

const styles: Record<ApprovalStatus, { cls: string; label: string }> = {
  draft: { cls: 'bg-amber-100 text-amber-800 ring-amber-300', label: 'Draft — not usable' },
  approved: { cls: 'bg-emerald-100 text-emerald-800 ring-emerald-300', label: 'Approved' },
  retired: { cls: 'bg-slate-200 text-slate-700 ring-slate-300', label: 'Retired' },
}

/** Reference profile lifecycle status (not a motor assessment status). */
export default function ApprovalBadge({ status }: { status: ApprovalStatus }) {
  const s = styles[status]
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}`}>
      {s.label}
    </span>
  )
}
