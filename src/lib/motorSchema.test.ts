import { describe, expect, it } from 'vitest'
import { EMPTY_MOTOR_FORM, motorToFormValues, validateMotorForm, type MotorFormValues } from './motorSchema'
import type { Motor } from '../types/motor'

// Example values only (not engineering references).
const valid: MotorFormValues = { ...EMPTY_MOTOR_FORM, motor_tag: ' M-001 ', name: 'Pump motor', motor_type: 'induction' }

describe('validateMotorForm', () => {
  it('accepts the minimal required fields and stores blanks as null (never 0)', () => {
    const r = validateMotorForm(valid)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.motor_tag).toBe('M-001') // trimmed
    expect(r.data.rated_voltage).toBeNull()
    expect(r.data.rated_rpm).toBeNull()
    expect(r.data.power_unit).toBeNull()
    expect(r.data.notes).toBeNull()
  })

  it('requires tag, name and motor type', () => {
    const r = validateMotorForm(EMPTY_MOTOR_FORM)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(Object.keys(r.errors).sort()).toEqual(['motor_tag', 'motor_type', 'name'])
  })

  it('rejects whitespace-only required fields', () => {
    const r = validateMotorForm({ ...valid, name: '   ' })
    expect(r.ok).toBe(false)
  })

  it('parses numeric fields', () => {
    const r = validateMotorForm({
      ...valid,
      rated_voltage: '400',
      rated_current: '12.5',
      rated_power: '5.5',
      power_unit: 'kW',
      rated_frequency: '50',
      rated_rpm: '1450',
      phase_count: '3',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data).toMatchObject({
      rated_voltage: 400,
      rated_current: 12.5,
      rated_power: 5.5,
      power_unit: 'kW',
      rated_frequency: 50,
      rated_rpm: 1450,
      phase_count: 3,
    })
  })

  it.each([
    ['rated_voltage', 'abc'],
    ['rated_voltage', '0'],
    ['rated_current', '-1'],
    ['rated_frequency', 'Infinity'],
    ['rated_rpm', '1450.5'],
    ['phase_count', '2.5'],
    ['phase_count', '99999999'],
  ] as const)('rejects invalid %s = %s', (field, value) => {
    const r = validateMotorForm({ ...valid, [field]: value })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors[field]).toBeTruthy()
  })

  it('requires a power unit when rated power is given (matches the DB constraint)', () => {
    const r = validateMotorForm({ ...valid, rated_power: '5' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.power_unit).toBeTruthy()
  })

  it('allows a power unit without a rated power', () => {
    expect(validateMotorForm({ ...valid, power_unit: 'W' }).ok).toBe(true)
  })
})

describe('motorToFormValues', () => {
  it('maps nulls to empty strings and round-trips through validation', () => {
    const motor: Motor = {
      id: 'x', owner_id: 'o', motor_tag: 'T1', name: 'N', motor_type: 'type',
      manufacturer: null, model: null, serial_number: null,
      rated_voltage: 230, rated_current: null, rated_power: 750, power_unit: 'W',
      rated_frequency: null, rated_rpm: 1500, phase_count: 1, supply_type: null, location: null, notes: null,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    }
    const form = motorToFormValues(motor)
    expect(form.manufacturer).toBe('')
    expect(form.rated_current).toBe('')
    expect(form.rated_voltage).toBe('230')
    const r = validateMotorForm(form)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.rated_power).toBe(750)
  })
})
