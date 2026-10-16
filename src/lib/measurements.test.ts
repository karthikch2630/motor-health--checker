import { describe, expect, it } from 'vitest'
import {
  normalizeMeasurement,
  parseMeasurement,
  unitOptionsFor,
  validateReadings,
  type ReadingFormValues,
} from './measurements'
import type { ParameterDefinition } from '../types/reference'

// Catalog stand-in mirroring migration 002 (units are definitions, not thresholds).
const def = (code: string, name: string, unit: string): ParameterDefinition => ({
  code, display_name: name, description: null, canonical_unit: unit,
})
const defs = [
  def('voltage', 'Voltage', 'V'),
  def('current', 'Current', 'A'),
  def('temperature', 'Temperature', '°C'),
  def('vibration', 'Vibration', 'mm/s'),
  def('speed', 'Speed', 'RPM'),
  def('frequency', 'Frequency', 'Hz'),
  def('power_factor', 'Power factor', 'ratio'),
]
const byCode = (c: string) => defs.find((d) => d.code === c) as ParameterDefinition
const blank = Object.fromEntries(defs.map((d) => [d.code, { value: '', unit: d.canonical_unit, location: '' }])) as ReadingFormValues

describe('parseMeasurement', () => {
  it.each([['0', 0], ['12.5', 12.5], ['-3', -3], ['+4', 4], ['.5', 0.5], ['5.', 5], ['1e3', 1000], [' 7 ', 7], ['-1.5E-2', -0.015]])(
    'accepts %j', (raw, expected) => {
      const r = parseMeasurement(raw)
      expect(r).toEqual({ ok: true, value: expected })
    },
  )

  it.each([['abc'], ['1.2.3'], ['0x10'], ['Infinity'], ['-Infinity'], ['NaN'], ['1e999'], ['1,5'], ['1 000'], ['--1'], ['1e'], [''], ['  '], ['1e20']])(
    'rejects %j', (raw) => {
      expect(parseMeasurement(raw).ok).toBe(false)
    },
  )

  it('keeps a measured zero distinct from missing', () => {
    expect(parseMeasurement('0')).toEqual({ ok: true, value: 0 })
    expect(parseMeasurement('').ok).toBe(false)
  })
})

describe('unitOptionsFor', () => {
  it('offers the catalog canonical unit first, then exact conversions into it', () => {
    expect(unitOptionsFor(byCode('temperature')).map((o) => o.unit)).toEqual(['°C', '°F', 'K'])
    expect(unitOptionsFor(byCode('voltage')).map((o) => o.unit)).toEqual(['V', 'kV'])
    expect(unitOptionsFor(byCode('power_factor')).map((o) => o.unit)).toEqual(['ratio'])
  })

  it('never offers a conversion whose target is not the catalog canonical unit', () => {
    // If the catalog said voltage is in kV, the V->... conversions defined into "V" must not be offered.
    expect(unitOptionsFor(def('voltage', 'Voltage', 'kV')).map((o) => o.unit)).toEqual(['kV'])
  })
})

describe('normalizeMeasurement', () => {
  it('passes canonical values through unchanged', () => {
    expect(normalizeMeasurement(byCode('voltage'), 400, 'V')).toEqual({ ok: true, value: 400, unit: 'V' })
  })

  it.each([
    ['voltage', 1.2, 'kV', 1200, 'V'],
    ['current', 250, 'mA', 0.25, 'A'],
    ['temperature', 212, '°F', 100, '°C'],
    ['temperature', 32, '°F', 0, '°C'],
    ['temperature', -40, '°F', -40, '°C'],
    ['temperature', 300, 'K', 26.85, '°C'],
    ['vibration', 1, 'in/s', 25.4, 'mm/s'],
    ['speed', 25, 'rev/s', 1500, 'RPM'],
    ['frequency', 0.05, 'kHz', 50, 'Hz'],
  ])('converts %s %f %s -> %f %s', (code, value, unit, expected, target) => {
    const r = normalizeMeasurement(byCode(code), value, unit)
    expect(r).toEqual({ ok: true, value: expected, unit: target })
  })

  it('removes floating-point noise (0.1 kV is exactly 100 V)', () => {
    expect(normalizeMeasurement(byCode('voltage'), 0.1, 'kV')).toEqual({ ok: true, value: 100, unit: 'V' })
  })

  it('rejects unsupported units and wrong-parameter units', () => {
    expect(normalizeMeasurement(byCode('voltage'), 1, 'psi').ok).toBe(false)
    expect(normalizeMeasurement(byCode('voltage'), 1, '°F').ok).toBe(false)
    expect(normalizeMeasurement(byCode('power_factor'), 50, '%').ok).toBe(false)
  })

  it('rejects physically impossible values but accepts zero', () => {
    expect(normalizeMeasurement(byCode('current'), -1, 'A').ok).toBe(false)
    expect(normalizeMeasurement(byCode('current'), 0, 'A').ok).toBe(true)
    expect(normalizeMeasurement(byCode('temperature'), -300, '°C').ok).toBe(false)
    expect(normalizeMeasurement(byCode('temperature'), -273.15, '°C').ok).toBe(true)
    expect(normalizeMeasurement(byCode('temperature'), -1, 'K').ok).toBe(false) // below absolute zero
    expect(normalizeMeasurement(byCode('power_factor'), 1.2, 'ratio').ok).toBe(false)
    expect(normalizeMeasurement(byCode('power_factor'), -0.5, 'ratio').ok).toBe(true)
  })
})

describe('validateReadings', () => {
  it('treats blank readings as not measured: omitted, never zero', () => {
    const r = validateReadings({ ...blank, voltage: { value: '400', unit: 'V', location: '' } }, defs)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.readings).toHaveLength(1)
    expect(r.readings.map((x) => x.parameter_code)).toEqual(['voltage'])
  })

  it('returns an empty list when nothing was entered', () => {
    expect(validateReadings(blank, defs)).toEqual({ ok: true, readings: [] })
  })

  it('preserves the original value and unit and adds the normalized pair', () => {
    const r = validateReadings({ ...blank, temperature: { value: '212', unit: '°F', location: ' bearing DE ' } }, defs)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.readings[0]).toEqual({
      parameter_code: 'temperature', measured_value: 212, measured_unit: '°F',
      normalized_value: 100, normalized_unit: '°C', measurement_location: 'bearing DE',
    })
  })

  it('keeps an explicit zero reading', () => {
    const r = validateReadings({ ...blank, current: { value: '0', unit: 'A', location: '' } }, defs)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.readings[0].measured_value).toBe(0)
  })

  it('reports each invalid field and does not return partial readings', () => {
    const r = validateReadings(
      {
        ...blank,
        voltage: { value: 'abc', unit: 'V', location: '' },
        current: { value: '5', unit: 'kA', location: '' },
        speed: { value: '', unit: 'RPM', location: 'shaft' },
        frequency: { value: '50', unit: 'Hz', location: '' },
      },
      defs,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(Object.keys(r.errors).sort()).toEqual(['current', 'speed', 'voltage'])
    expect(r.errors.current).toMatch(/not supported/)
  })

  it('falls back to the canonical unit when none is set', () => {
    const r = validateReadings({ ...blank, voltage: { value: '5', unit: '', location: '' } }, defs)
    expect(r.ok && r.readings[0].measured_unit).toBe('V')
  })
})
