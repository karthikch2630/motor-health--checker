import { describe, expect, it } from 'vitest'
import { buildTrendSeries, MIN_POINTS_FOR_TREND } from './trends'

// SYNTHETIC rows.
const defs = [{ code: 'voltage', display_name: 'Voltage' }, { code: 'vibration', display_name: 'Vibration' }]
const s = (id: string, day: number, status: 'draft' | 'submitted' | 'assessed' = 'assessed') => ({
  id, test_timestamp: `2026-03-${String(day).padStart(2, '0')}T00:00:00Z`, status,
})
const r = (sid: string, code: string, v: number | null, unit: string | null = 'V', loc: string | null = null) => ({
  test_session_id: sid, parameter_code: code, normalized_value: v, normalized_unit: unit, measurement_location: loc,
})
const noMethods = {}

describe('buildTrendSeries', () => {
  it('builds one ascending series per comparable group and marks it plottable from 3 points', () => {
    const sessions = [s('a', 3), s('b', 1), s('c', 2)]
    const out = buildTrendSeries(sessions, noMethods, [r('a', 'voltage', 3), r('b', 'voltage', 1), r('c', 'voltage', 2)], defs)
    expect(out).toHaveLength(1)
    expect(out[0].points.map((p) => p.value)).toEqual([1, 2, 3])
    expect(out[0].plottable).toBe(true)
    expect(MIN_POINTS_FOR_TREND).toBe(3)
    expect(out[0].parameterName).toBe('Voltage')
  })

  it('does not draw a trend from fewer than 3 readings', () => {
    const out = buildTrendSeries([s('a', 1), s('b', 2)], noMethods, [r('a', 'voltage', 1), r('b', 'voltage', 2)], defs)
    expect(out[0].plottable).toBe(false)
  })

  it('never mixes different units', () => {
    const out = buildTrendSeries([s('a', 1), s('b', 2)], noMethods, [r('a', 'voltage', 1, 'V'), r('b', 'voltage', 1, 'kV')], defs)
    expect(out).toHaveLength(2)
    expect(out.every((x) => x.points.length === 1)).toBe(true)
  })

  it('never mixes different measurement methods or locations; text is compared case-insensitively', () => {
    const sessions = [s('a', 1), s('b', 2), s('c', 3), s('d', 4)]
    const methods = { a: 'Probe A', b: 'probe a ', c: 'Probe B', d: null }
    const out = buildTrendSeries(sessions, methods, ['a', 'b', 'c', 'd'].map((id) => r(id, 'voltage', 1)), defs)
    expect(out.map((x) => x.points.length).sort()).toEqual([1, 1, 2]) // A+a merged; B alone; "not recorded" alone
    const loc = buildTrendSeries([s('a', 1), s('b', 2)], noMethods, [r('a', 'vibration', 1, 'mm/s', 'DE'), r('b', 'vibration', 1, 'mm/s', 'NDE')], defs)
    expect(loc).toHaveLength(2)
  })

  it('labels missing method/location as "not recorded" rather than assuming they match something', () => {
    const out = buildTrendSeries([s('a', 1)], noMethods, [r('a', 'voltage', 1)], defs)
    expect(out[0].label).toBe('Voltage (V) · method: not recorded · location: not recorded')
    expect(out[0].method).toBeNull()
  })

  it('excludes draft tests and readings without a usable normalized value', () => {
    const out = buildTrendSeries(
      [s('a', 1, 'draft'), s('b', 2), s('c', 3)],
      noMethods,
      [r('a', 'voltage', 9), r('b', 'voltage', null), r('c', 'voltage', Infinity), r('c', 'voltage', 5, null)],
      defs,
    )
    expect(out).toEqual([])
  })

  it('treats a stored zero as a real point', () => {
    const out = buildTrendSeries([s('a', 1)], noMethods, [r('a', 'voltage', 0)], defs)
    expect(out[0].points).toEqual([{ t: Date.parse('2026-03-01T00:00:00Z'), value: 0, sessionId: 'a' }])
  })

  it('ignores readings of unknown sessions and falls back to the code when the name is unknown', () => {
    const out = buildTrendSeries([s('a', 1)], noMethods, [r('zzz', 'voltage', 1), r('a', 'speed', 1450, 'RPM')], defs)
    expect(out).toHaveLength(1)
    expect(out[0].parameterName).toBe('speed')
  })

  it('orders series by number of points', () => {
    const sessions = [s('a', 1), s('b', 2), s('c', 3)]
    const out = buildTrendSeries(sessions, noMethods, [r('a', 'voltage', 1), r('b', 'voltage', 1), r('c', 'voltage', 1), r('a', 'vibration', 1, 'mm/s')], defs)
    expect(out.map((x) => x.parameterCode)).toEqual(['voltage', 'vibration'])
  })
})
