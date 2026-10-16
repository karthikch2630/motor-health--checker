import { describe, expect, it } from 'vitest'
import { checkProfileCompatibility } from './profileMatch'

// SYNTHETIC metadata for tests only.
const motor = { motor_type: 'Induction', phase_count: 3, rated_frequency: 50, rated_voltage: 400 }
const profile = {
  approval_status: 'approved' as const,
  motor_type: 'induction',
  applicable_specs: {} as Record<string, unknown>,
  effective_from: null as string | null,
  effective_to: null as string | null,
}
const t = new Date('2026-06-01T00:00:00Z')

describe('checkProfileCompatibility', () => {
  it('is compatible when the motor type matches (case-insensitive) and no other restriction is defined', () => {
    expect(checkProfileCompatibility(profile, motor, t)).toEqual({ status: 'compatible', reasons: [] })
  })

  it('is incompatible for a different motor type or an unapproved profile', () => {
    expect(checkProfileCompatibility({ ...profile, motor_type: 'synchronous' }, motor, t).status).toBe('incompatible')
    expect(checkProfileCompatibility({ ...profile, approval_status: 'draft' as never }, motor, t).status).toBe('incompatible')
    expect(checkProfileCompatibility({ ...profile, approval_status: 'retired' as never }, motor, t).status).toBe('incompatible')
  })

  it('applies defined specs: phases, frequency, voltage range', () => {
    const p = { ...profile, applicable_specs: { phase_count: 3, rated_frequency_hz: 50, rated_voltage_min_v: 380, rated_voltage_max_v: 420 } }
    expect(checkProfileCompatibility(p, motor, t).status).toBe('compatible')
    expect(checkProfileCompatibility(p, { ...motor, phase_count: 1 }, t).status).toBe('incompatible')
    expect(checkProfileCompatibility(p, { ...motor, rated_frequency: 60 }, t).status).toBe('incompatible')
    expect(checkProfileCompatibility(p, { ...motor, rated_voltage: 690 }, t).status).toBe('incompatible')
    expect(checkProfileCompatibility(p, { ...motor, rated_voltage: 380 }, t).status).toBe('compatible') // boundary is inclusive
  })

  it('does not guess when the motor lacks a spec the profile restricts: applicability is unknown', () => {
    const p = { ...profile, applicable_specs: { phase_count: 3 } }
    const r = checkProfileCompatibility(p, { ...motor, phase_count: null }, t)
    expect(r.status).toBe('unknown')
    expect(r.reasons[0]).toMatch(/no number of phases/)
  })

  it('incompatible outranks unknown', () => {
    const p = { ...profile, applicable_specs: { phase_count: 3, rated_frequency_hz: 60 } }
    expect(checkProfileCompatibility(p, { ...motor, phase_count: null }, t).status).toBe('incompatible')
  })

  it('ignores unrestricted fields even if the motor lacks them', () => {
    expect(checkProfileCompatibility(profile, { ...motor, phase_count: null, rated_voltage: null }, t).status).toBe('compatible')
  })

  it('respects effective dates relative to the test time', () => {
    expect(checkProfileCompatibility({ ...profile, effective_from: '2026-07-01T00:00:00Z' }, motor, t).status).toBe('incompatible')
    expect(checkProfileCompatibility({ ...profile, effective_to: '2026-05-01T00:00:00Z' }, motor, t).status).toBe('incompatible')
    expect(checkProfileCompatibility({ ...profile, effective_from: '2026-01-01T00:00:00Z', effective_to: '2026-12-01T00:00:00Z' }, motor, t).status).toBe('compatible')
  })

  it('ignores malformed spec values rather than crashing', () => {
    const p = { ...profile, applicable_specs: { phase_count: 'three', rated_voltage_min_v: null } }
    expect(checkProfileCompatibility(p, motor, t).status).toBe('compatible')
  })
})

describe('supply_type (migration 013): line-supply profiles are never assumed to apply', () => {
  const p = { ...profile, applicable_specs: { supply_type: 'line' } }
  it('compatible only when the motor is recorded as line-supplied', () => {
    expect(checkProfileCompatibility(p, { ...motor, supply_type: 'line' }, t).status).toBe('compatible')
  })
  it('unknown when the supply is not recorded (or the field is absent)', () => {
    for (const m of [{ ...motor, supply_type: null }, motor]) {
      const r = checkProfileCompatibility(p, m, t)
      expect(r.status).toBe('unknown')
      expect(r.reasons[0]).toMatch(/Supply type not verified/)
    }
  })
  it('incompatible for an inverter-fed motor', () => {
    expect(checkProfileCompatibility(p, { ...motor, supply_type: 'inverter' }, t).status).toBe('incompatible')
  })
  it('profiles without a supply requirement are unaffected', () => {
    expect(checkProfileCompatibility(profile, { ...motor, supply_type: null }, t).status).toBe('compatible')
  })
})
