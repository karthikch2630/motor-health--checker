import { describe, expect, it } from 'vitest'
import { newTestForm, testToFormValues, toDateTimeLocal, validateSessionMeta } from './testForm'
import type { ParameterDefinition } from '../types/reference'
import type { TestReading, TestSession } from '../types/test'

const defs: ParameterDefinition[] = [
  { code: 'voltage', display_name: 'Voltage', description: null, canonical_unit: 'V' },
  { code: 'temperature', display_name: 'Temperature', description: null, canonical_unit: '°C' },
]
const now = new Date(2026, 9, 15, 12, 0) // local time
const base = { ...newTestForm(defs, 'm1', now) }

describe('newTestForm', () => {
  it('starts with blank readings in canonical units and a local timestamp', () => {
    expect(base.timestamp).toBe('2026-10-15T12:00')
    expect(base.readings.voltage).toEqual({ value: '', unit: 'V', location: '' })
    expect(base.readings.temperature.unit).toBe('°C')
  })
})

describe('validateSessionMeta', () => {
  it('requires a motor and a timestamp', () => {
    const r = validateSessionMeta({ ...base, motor_id: '', timestamp: '' }, {}, now)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['motor_id', 'timestamp'])
  })

  it('rejects an invalid or future date', () => {
    expect(validateSessionMeta({ ...base, timestamp: 'garbage' }, {}, now).ok).toBe(false)
    const future = validateSessionMeta({ ...base, timestamp: '2026-10-16T12:00' }, {}, now)
    expect(future.ok).toBe(false)
    expect(validateSessionMeta({ ...base, timestamp: '2026-10-15T12:03' }, {}, now).ok).toBe(true) // within clock allowance
  })

  it('maps blanks to null and stores operator / conditions in operating_conditions', () => {
    const r = validateSessionMeta({ ...base, operator: ' Sam ', conditions: 'running', notes: '  ' }, { custom: 1 }, now)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data).toMatchObject({
      motor_id: 'm1', measurement_method: null, notes: null,
      operating_conditions: { custom: 1, operator: 'Sam', description: 'running' },
    })
    expect(new Date(r.data.test_timestamp).getTime()).toBe(now.getTime())
  })

  it('clears operator/description when emptied but keeps unrelated keys', () => {
    const r = validateSessionMeta(base, { operator: 'old', description: 'old', other: true }, now)
    expect(r.ok && r.data.operating_conditions).toEqual({ other: true })
  })

  it('enforces length limits', () => {
    expect(validateSessionMeta({ ...base, notes: 'x'.repeat(4001) }, {}, now).ok).toBe(false)
  })
})

describe('testToFormValues', () => {
  it('restores a saved draft, leaving unmeasured parameters blank (not 0)', () => {
    const session = {
      motor_id: 'm1', test_timestamp: now.toISOString(), measurement_method: 'clamp meter', notes: 'n',
      operating_conditions: { operator: 'Sam', description: 'idle' },
    } as unknown as TestSession
    const readings = [
      { parameter_code: 'voltage', measured_value: 0, measured_unit: 'V', measurement_location: null },
    ] as unknown as TestReading[]
    const f = testToFormValues(session, readings, defs)
    expect(f).toMatchObject({ motor_id: 'm1', timestamp: toDateTimeLocal(now), operator: 'Sam', conditions: 'idle', notes: 'n' })
    expect(f.readings.voltage.value).toBe('0')
    expect(f.readings.temperature.value).toBe('')
  })
})
