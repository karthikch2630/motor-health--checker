import { describe, expect, it } from 'vitest'
import {
  assessApprovalReadiness,
  EMPTY_LIMIT_FORM,
  EMPTY_PROFILE_FORM,
  limitToFormValues,
  profileToFormValues,
  validateLimitForm,
  validateProfileForm,
  type LimitFormValues,
  type ProfileFormValues,
} from './referenceSchema'
import type { ParameterDefinition, ReferenceLimit, ReferenceProfile } from '../types/reference'

// SYNTHETIC catalog and numbers for tests only. Not engineering references, not real limits.
const defs: ParameterDefinition[] = [
  { code: 'voltage', display_name: 'Voltage', description: 'v', canonical_unit: 'V' },
  { code: 'temperature', display_name: 'Temperature', description: 't', canonical_unit: '°C' },
]

const profileForm: ProfileFormValues = {
  ...EMPTY_PROFILE_FORM,
  name: 'SYNTHETIC test profile',
  motor_type: 'induction',
  source_name: 'Synthetic source',
}
const limitForm: LimitFormValues = {
  ...EMPTY_LIMIT_FORM,
  parameter_code: 'voltage',
  upper_limit: '10',
  source_note: 'synthetic note',
}

describe('validateProfileForm', () => {
  it('accepts the minimum and stores blanks as null', () => {
    const r = validateProfileForm(profileForm)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data).toMatchObject({ version: 1, description: null, source_reference: null, effective_from: null })
    expect(r.data.applicable_specs).toEqual({})
  })

  it('requires name, motor type and a source (missing source blocks the draft)', () => {
    const r = validateProfileForm({ ...profileForm, name: '', motor_type: ' ', source_name: '' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(Object.keys(r.errors).sort()).toEqual(['motor_type', 'name', 'source_name'])
  })

  it.each([['0'], ['1.5'], ['abc'], ['']])('rejects version %j', (version) => {
    const r = validateProfileForm({ ...profileForm, version })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.version).toBeTruthy()
  })

  it('validates applicable specifications and their ordering', () => {
    expect(validateProfileForm({ ...profileForm, spec_phase_count: '2.5' }).ok).toBe(false)
    expect(validateProfileForm({ ...profileForm, spec_voltage_min: '500', spec_voltage_max: '400' }).ok).toBe(false)
    const r = validateProfileForm({ ...profileForm, spec_phase_count: '3', spec_frequency: '50', spec_voltage_min: '380', spec_voltage_max: '420' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.applicable_specs).toEqual({
        phase_count: 3, rated_frequency_hz: 50, rated_voltage_min_v: 380, rated_voltage_max_v: 420,
      })
    }
  })

  it('validates dates and their order', () => {
    expect(validateProfileForm({ ...profileForm, effective_from: '2026-13-45' }).ok).toBe(false)
    expect(validateProfileForm({ ...profileForm, effective_from: '2026-05-01', effective_to: '2026-04-01' }).ok).toBe(false)
    expect(validateProfileForm({ ...profileForm, effective_from: '2026-05-01', effective_to: '2026-06-01' }).ok).toBe(true)
  })

  it('preserves unrelated applicable_specs keys but replaces the ones it manages', () => {
    const r = validateProfileForm({ ...profileForm, spec_phase_count: '1' }, { phase_count: 3, custom_key: 'keep' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.applicable_specs).toEqual({ phase_count: 1, custom_key: 'keep' })
    const cleared = validateProfileForm(profileForm, { phase_count: 3, custom_key: 'keep' })
    if (cleared.ok) expect(cleared.data.applicable_specs).toEqual({ custom_key: 'keep' })
  })

  it('round-trips through the form representation', () => {
    const p = {
      name: 'N', motor_type: 'T', description: null, applicable_specs: { phase_count: 3 }, source_name: 'S',
      source_reference: 'doc 1', version: 2, effective_from: null, effective_to: null,
    } as unknown as ReferenceProfile
    const r = validateProfileForm(profileToFormValues(p), p.applicable_specs)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toMatchObject({ version: 2, source_reference: 'doc 1', applicable_specs: { phase_count: 3 } })
  })
})

describe('validateLimitForm', () => {
  it('takes name and unit from the parameter catalog, never from the user', () => {
    const r = validateLimitForm({ ...limitForm, parameter_code: 'temperature' }, defs)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toMatchObject({ parameter_code: 'temperature', parameter_name: 'Temperature', unit: '°C' })
  })

  it('treats blank as null — never zero', () => {
    const r = validateLimitForm(limitForm, defs)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toMatchObject({ lower_limit: null, upper_limit: 10, warning_lower: null, warning_upper: null })
  })

  it('allows zero and negative values (e.g. sub-zero temperatures)', () => {
    const r = validateLimitForm({ ...limitForm, parameter_code: 'temperature', lower_limit: '-20', upper_limit: '0' }, defs)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toMatchObject({ lower_limit: -20, upper_limit: 0 })
  })

  it('requires at least one threshold', () => {
    const r = validateLimitForm({ ...limitForm, upper_limit: '' }, defs)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.thresholds).toMatch(/at least one/i)
  })

  it('rejects non-numeric input and reversed ranges', () => {
    const bad = validateLimitForm({ ...limitForm, upper_limit: 'ten' }, defs)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.errors.upper_limit).toMatch(/number/)
    const inf = validateLimitForm({ ...limitForm, upper_limit: 'Infinity' }, defs)
    expect(inf.ok).toBe(false)

    const range = validateLimitForm({ ...limitForm, lower_limit: '11', upper_limit: '10' }, defs)
    expect(range.ok).toBe(false)
    if (!range.ok) expect(range.errors.lower_limit).toBeTruthy()

    const warn = validateLimitForm({ ...limitForm, warning_lower: '5', warning_upper: '4' }, defs)
    expect(warn.ok).toBe(false)
    if (!warn.ok) expect(warn.errors.warning_lower).toBeTruthy()
  })

  it('requires a parameter from the catalog and a source note', () => {
    expect(validateLimitForm({ ...limitForm, parameter_code: '' }, defs).ok).toBe(false)
    const unknown = validateLimitForm({ ...limitForm, parameter_code: 'torque' }, defs)
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.errors.parameter_code).toBe('Unknown parameter')
    const noSource = validateLimitForm({ ...limitForm, source_note: '  ' }, defs)
    expect(noSource.ok).toBe(false)
    if (!noSource.ok) expect(noSource.errors.source_note).toBeTruthy()
  })

  it('keeps unrelated condition keys and round-trips the description', () => {
    const r = validateLimitForm({ ...limitForm, conditions: 'at rated load' }, defs, { other: 1 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.applicable_conditions).toEqual({ other: 1, description: 'at rated load' })
    const row = { ...r.data, id: 'x', owner_id: 'o', reference_profile_id: 'p', created_at: '' } as ReferenceLimit
    expect(limitToFormValues(row).conditions).toBe('at rated load')
  })
})

describe('assessApprovalReadiness', () => {
  const profile = {
    id: 'p', name: 'N', source_name: 'S', source_reference: 'ref', applicable_specs: { phase_count: 3 },
    effective_from: '2026-01-01T00:00:00Z',
  } as unknown as ReferenceProfile
  const limit = {
    parameter_code: 'voltage', parameter_name: 'Voltage', unit: 'V', source_note: 'note',
  } as unknown as ReferenceLimit

  it('blocks approval when there are no limits', () => {
    const r = assessApprovalReadiness(profile, [], defs)
    expect(r.blockers.join(' ')).toMatch(/no limits/i)
  })

  it('has no blockers or warnings for a complete profile', () => {
    expect(assessApprovalReadiness(profile, [limit], defs)).toEqual({ blockers: [], warnings: [] })
  })

  it('blocks a limit whose unit differs from the canonical unit', () => {
    const r = assessApprovalReadiness(profile, [{ ...limit, unit: 'kV' }], defs)
    expect(r.blockers.join(' ')).toMatch(/differs from the canonical unit/)
  })

  it('blocks a limit with no source note or unknown parameter', () => {
    expect(assessApprovalReadiness(profile, [{ ...limit, source_note: ' ' }], defs).blockers.join(' ')).toMatch(/no source note/)
    expect(assessApprovalReadiness(profile, [{ ...limit, parameter_code: 'torque' }], defs).blockers.join(' ')).toMatch(/catalog/)
  })

  it('warns, without blocking, about missing traceability and applicability', () => {
    const sparse = { ...profile, source_reference: null, applicable_specs: {}, effective_from: null } as ReferenceProfile
    const r = assessApprovalReadiness(sparse, [limit], defs)
    expect(r.blockers).toEqual([])
    expect(r.warnings).toHaveLength(3)
  })

  it('blocks a missing source name', () => {
    expect(assessApprovalReadiness({ ...profile, source_name: ' ' }, [limit], defs).blockers.join(' ')).toMatch(/source/i)
  })
})
