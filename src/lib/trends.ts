/**
 * Trend series from stored readings. A series only ever contains readings that can honestly be compared:
 *   - same parameter,
 *   - same normalized (canonical) unit,
 *   - same measurement method text (as recorded on the test; blank = "not recorded"),
 *   - same measurement location text (as recorded on the reading; blank = "not recorded"),
 *   - from submitted/assessed tests only (drafts can still change).
 * Readings that differ in any of these are never mixed. Nothing is inferred about phases or measuring points:
 * the schema stores one reading per parameter per test.
 */
import type { SessionRow } from '../types/overview'
import type { ParameterDefinition } from '../types/reference'
import type { TestReading } from '../types/test'

export const MIN_POINTS_FOR_TREND = 3

export interface TrendPoint {
  t: number
  value: number
  sessionId: string
}

export interface TrendSeries {
  key: string
  parameterCode: string
  parameterName: string
  unit: string
  method: string | null
  location: string | null
  points: TrendPoint[]
  /** True when there are enough points to draw a line (>= MIN_POINTS_FOR_TREND). */
  plottable: boolean
  label: string
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
const shown = (s: string | null | undefined) => (s && s.trim() !== '' ? s.trim() : null)

export function buildTrendSeries(
  sessions: Pick<SessionRow, 'id' | 'test_timestamp' | 'status'>[],
  methods: Record<string, string | null>,
  readings: Pick<
    TestReading,
    'test_session_id' | 'parameter_code' | 'normalized_value' | 'normalized_unit' | 'measurement_location'
  >[],
  definitions: Pick<ParameterDefinition, 'code' | 'display_name'>[],
): TrendSeries[] {
  const sessionById = new Map(sessions.filter((s) => s.status !== 'draft').map((s) => [s.id, s]))
  const names = new Map(definitions.map((d) => [d.code, d.display_name]))
  const groups = new Map<string, TrendSeries>()

  for (const r of readings) {
    const s = sessionById.get(r.test_session_id)
    if (!s) continue
    if (typeof r.normalized_value !== 'number' || !Number.isFinite(r.normalized_value) || !r.normalized_unit) continue
    const t = new Date(s.test_timestamp).getTime()
    if (Number.isNaN(t)) continue

    const method = methods[s.id] ?? null
    const key = [r.parameter_code, r.normalized_unit, norm(method), norm(r.measurement_location)].join('|')
    let series = groups.get(key)
    if (!series) {
      const name = names.get(r.parameter_code) ?? r.parameter_code
      const parts = [`${name} (${r.normalized_unit})`]
      parts.push(`method: ${shown(method) ?? 'not recorded'}`)
      parts.push(`location: ${shown(r.measurement_location) ?? 'not recorded'}`)
      series = {
        key,
        parameterCode: r.parameter_code,
        parameterName: name,
        unit: r.normalized_unit,
        method: shown(method),
        location: shown(r.measurement_location),
        points: [],
        plottable: false,
        label: parts.join(' · '),
      }
      groups.set(key, series)
    }
    series.points.push({ t, value: r.normalized_value, sessionId: s.id })
  }

  const out = [...groups.values()]
  for (const s of out) {
    s.points.sort((a, b) => a.t - b.t)
    s.plottable = s.points.length >= MIN_POINTS_FOR_TREND
  }
  return out.sort((a, b) => b.points.length - a.points.length || a.label.localeCompare(b.label))
}
