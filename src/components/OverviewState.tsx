import { TriangleAlert } from 'lucide-react'
import type { Overview } from '../types/overview'
import LoadingState from './LoadingState'
import Notice from './Notice'

interface Props {
  isPending: boolean
  error: Error | null
  onRetry: () => void
  loadingLabel: string
}

/** Standard loading / error-with-retry block for pages built on the shared overview query. */
export function OverviewStatus({ isPending, error, onRetry, loadingLabel }: Props) {
  if (isPending) return <LoadingState label={loadingLabel} />
  if (error) {
    return (
      <>
        <Notice kind="error">{error.message}</Notice>
        <button onClick={onRetry} className="text-sm font-medium text-amber-700 hover:underline">
          Try again
        </button>
      </>
    )
  }
  return null
}

/** Shown when the database holds more rows than one request returns, so totals could be understated. */
export function TruncationWarning({ truncated }: { truncated: Overview['truncated'] }) {
  const parts = [truncated.motors && 'motors', truncated.sessions && 'tests', truncated.results && 'assessments'].filter(Boolean)
  if (parts.length === 0) return null
  return (
    <p role="alert" className="mb-4 flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>
        <strong>Partial data.</strong> There are more {parts.join(', ')} than can be loaded at once, so the figures on this
        page may be incomplete. Only the most recent records are included.
      </span>
    </p>
  )
}
