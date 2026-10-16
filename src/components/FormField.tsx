import type { ReactNode } from 'react'

export const inputClass =
  'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200 aria-[invalid=true]:border-red-500'

interface Props {
  id: string
  label: string
  required?: boolean
  error?: string
  hint?: string
  className?: string
  children: ReactNode
}

/** Label + control + hint/error. The control must use `id` and `aria-describedby={id + '-msg'}`. */
export default function FormField({ id, label, required, error, hint, className, children }: Props) {
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
        {required && (
          <span className="text-red-600" aria-hidden>
            {' '}
            *
          </span>
        )}
      </label>
      {children}
      {(error || hint) && (
        <p id={`${id}-msg`} className={`mt-1 text-xs ${error ? 'text-red-600' : 'text-slate-500'}`}>
          {error ?? hint}
        </p>
      )}
    </div>
  )
}
