/** Display helpers. Missing values are shown as an em dash, never as zero. */
export const DASH = '—'

export function formatPower(value: number | null, unit: string | null): string {
  return value === null ? DASH : `${value} ${unit ?? ''}`.trim()
}

export function formatWithUnit(value: number | null, unit: string): string {
  return value === null ? DASH : `${value} ${unit}`
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? DASH : d.toLocaleString()
}
