import { describe, expect, it } from 'vitest'
import { motorCoverage } from './profileCoverage'
import type { ReferenceProfileWithCount } from '../types/reference'

// SYNTHETIC metadata for tests only; no engineering limits.
const motor = { id: 'm1', motor_type: 'induction', phase_count: 3, rated_frequency: 60, rated_voltage: 460 }
const base: ReferenceProfileWithCount = {
  id: 'p1', owner_id: 'u', name: 'P', motor_type: 'Induction', description: null,
  applicable_specs: { phase_count: 3, rated_frequency_hz: 60, rated_voltage_min_v: 460, rated_voltage_max_v: 460 },
  source_name: 's', source_reference: null, version: 1, approval_status: 'approved',
  effective_from: null, effective_to: null, created_at: '2026-01-01T00:00:00Z', limit_count: 2,
}
const at = new Date('2026-06-01T00:00:00Z')

describe('motorCoverage', () => {
  it('lists an approved, compatible profile with limits as usable', () => {
    expect(motorCoverage(motor, [base], at).usable).toHaveLength(1)
  })

  it('never offers draft, retired, expired or not-yet-effective profiles', () => {
    for (const p of [
      { ...base, approval_status: 'draft' as const },
      { ...base, approval_status: 'retired' as const },
      { ...base, effective_to: '2026-01-01T00:00:00Z' },
      { ...base, effective_from: '2026-12-01T00:00:00Z' },
    ]) {
      const c = motorCoverage(motor, [p], at)
      expect(c.usable).toHaveLength(0)
      expect(c.unusable[0].match.reasons.length).toBeGreaterThan(0)
    }
  })

  it('rejects other voltage, frequency, phase count and motor type', () => {
    for (const m of [{ ...motor, rated_voltage: 230 }, { ...motor, rated_frequency: 50 }, { ...motor, phase_count: 1 }, { ...motor, motor_type: 'dc' }]) {
      expect(motorCoverage(m, [base], at).usable).toHaveLength(0)
    }
  })

  it('treats a missing motor spec as unknown, not usable', () => {
    const c = motorCoverage({ ...motor, rated_voltage: null }, [base], at)
    expect(c.usable).toHaveLength(0)
    expect(c.unusable[0].match.status).toBe('unknown')
  })

  it('does not treat an approved profile without limits as usable', () => {
    const c = motorCoverage(motor, [{ ...base, limit_count: 0 }], at)
    expect(c.usable).toHaveLength(0)
    expect(c.unusable[0].match.reasons).toEqual(['The profile has no limits.'])
  })

  it('reports nothing usable when no profiles exist', () => {
    expect(motorCoverage(motor, [], at)).toEqual({ usable: [], unusable: [] })
  })
})
