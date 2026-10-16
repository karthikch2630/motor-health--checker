import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

interface Props {
  title: string
  confirmLabel: string
  /** Optional acknowledgement the user must tick before confirming. */
  acknowledgement?: string
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
  children: ReactNode
}

/** Modal confirmation. Escape cancels; focus starts on Cancel so Enter never confirms by accident. */
export default function ConfirmDialog({
  title,
  confirmLabel,
  acknowledgement,
  busy = false,
  error,
  onConfirm,
  onCancel,
  children,
}: Props) {
  const [acknowledged, setAcknowledged] = useState(!acknowledgement)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
      >
        <h2 id="confirm-title" className="text-lg font-semibold text-slate-900">
          {title}
        </h2>
        <div className="mt-3 space-y-3 text-sm text-slate-700">{children}</div>
        {acknowledgement && (
          <label className="mt-4 flex items-start gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-1"
            />
            {acknowledgement}
          </label>
        )}
        {error && (
          <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            className="rounded-md px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy || !acknowledged}
            className="flex items-center gap-2 rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
