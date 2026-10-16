import { CircleAlert, CircleCheck } from 'lucide-react'
import type { ReactNode } from 'react'

interface Props {
  kind: 'error' | 'success'
  children: ReactNode
}

/** Inline feedback banner. Errors are announced assertively, successes politely. */
export default function Notice({ kind, children }: Props) {
  const isError = kind === 'error'
  const Icon = isError ? CircleAlert : CircleCheck
  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={`mb-4 flex items-start gap-2 rounded-md border px-4 py-3 text-sm ${
        isError ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'
      }`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  )
}
