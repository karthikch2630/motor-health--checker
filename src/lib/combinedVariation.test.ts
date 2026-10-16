import { describe, expect, it } from 'vitest'
import { assessMotor, type DiagnosticInput, type EngineProfile, type EngineReading } from './diagnostics'
import {
  describeConditionProblem, loadConditionState, parseCombinedConfig, type CombinedVariationConfig,
} from './combinedVariation'
import { normalizeMeasurement } from './measurements'
import { assessApprovalReadiness } from './referenceSchema'
import { newTestForm, validateSessionMeta } from './testForm'

// All numbers below are SYNTHETIC test inputs that mirror the draft NEMA MG 1 12.44.1 profile; they are not stored reference data.
const CFG: CombinedVariationConfig = {
  voltage_parameter: 'voltage', frequency_parameter: 'frequency', voltage_unit: 'V', frequency_unit: 'Hz',
  max_combined_percent: 10, max_frequency_percent: 5, required_load_condition: 'rated', source: 'SYNTHETIC',
}
const RATED_LOAD = { load_condition: 'rated' }
const lim = (code: string, name: string, unit: string, lo: number, hi: number, cond: Record<string, unknown> = { required_load_condition: 'rated' }) => ({
  parameter_code: code, parameter_name: name, unit, lower_limit: null, upper_limit: null, warning_lower: lo, warning_upper: hi, applicable_conditions: cond,
})
const profile = (over: Partial<EngineProfile> = {}, cfg: unknown = CFG): EngineProfile => ({
  id: 'p', name: 'SYNTHETIC', version: 1, approval_status: 'approved', motor_type: 'induction',
  applicable_specs: cfg === undefined ? {} : { combined_variation: cfg },
  effective_from: null, effective_to: null,
  limits: [lim('voltage', 'Voltage', 'V', 414, 506), lim('frequency', 'Frequency', 'Hz', 57, 63)], ...over,
})
const rd = (code: string, v: number | null, unit: string): EngineReading => ({
  parameter_code: code, measured_value: v ?? 0, measured_unit: unit, normalized_value: v, normalized_unit: v === null ? null : unit,
})
const run = (v: number | null | undefined, f: number | null | undefined, over: Partial<DiagnosticInput> = {}, p: EngineProfile = profile()) =>
  assessMotor({
    sessionStatus: 'submitted', testTime: new Date('2026-06-01T00:00:00Z'),
    motor: { motor_type: 'induction', phase_count: 3, rated_frequency: 60, rated_voltage: 460 },
    operatingConditions: RATED_LOAD,
    readings: [...(v === undefined ? [] : [rd('voltage', v, 'V')]), ...(f === undefined ? [] : [rd('frequency', f, 'Hz')])],
    profile: p, parameterNames: { voltage: 'Voltage', frequency: 'Frequency' }, ...over,
  })
const codes = (r: ReturnType<typeof run>) => r.findings.map((f) => f.ruleCode).sort()

describe('combined voltage/frequency rule - rated load established', () => {
  it('both deviations within the individual ranges and the combined allowance: NORMAL with a tolerance-only statement', () => {
    const r = run(450, 59)
    expect(r.overallStatus).toBe('NORMAL')
    expect(codes(r)).toEqual(['COMBINED_VF_WITHIN', 'WITHIN_LIMITS', 'WITHIN_LIMITS'])
    const w = r.findings.find((f) => f.ruleCode === 'COMBINED_VF_WITHIN')!
    expect(w.severity).toBe('INFO')
    expect(w.description).toMatch(/does not demonstrate conformity/)
    expect(w.description).toMatch(/establish its health/)
  })

  it('individual deviations inside their ranges but combined deviation above 10 %: WARNING, never NORMAL', () => {
    const r = run(414, 58.8) // -10 % and -2 % -> 12 %
    expect(r.overallStatus).toBe('WARNING')
    expect(codes(r)).toEqual(['COMBINED_VF_SUM_EXCEEDED', 'WITHIN_LIMITS', 'WITHIN_LIMITS'])
    const f = r.findings.find((x) => x.ruleCode === 'COMBINED_VF_SUM_EXCEEDED')!
    expect(f).toMatchObject({ severity: 'WARNING', observedUnit: '%', applicableLimit: 10 })
    expect(f.observedValue).toBeCloseTo(12, 9)
    expect(f.description).toMatch(/not a fault diagnosis/)
  })

  it.each([
    ['exactly -10 % voltage, rated frequency', 414, 60],
    ['exactly +10 % voltage, rated frequency', 506, 60],
    ['exactly -5 % frequency, rated voltage', 460, 57],
    ['exactly +5 % frequency, rated voltage', 460, 63],
    ['-5 % voltage and -5 % frequency (sum exactly 10)', 437, 57],
    ['+5 % voltage and -5 % frequency (signs do not matter)', 483, 57],
    ['+7 % voltage and +3 % frequency (sum exactly 10)', 492.2, 61.8],
  ])('boundary is inclusive: %s', (_n, v, f) => {
    const r = run(v, f)
    expect(codes(r)).not.toContain('COMBINED_VF_SUM_EXCEEDED')
    expect(codes(r)).not.toContain('COMBINED_VF_FREQUENCY_EXCEEDED')
    expect(r.overallStatus).toBe('NORMAL')
  })

  it.each([
    ['just beyond the sum', 436.9, 57, 'COMBINED_VF_SUM_EXCEEDED'],
    ['frequency just beyond 5 % (sum still < 10)', 460, 56.9, 'COMBINED_VF_FREQUENCY_EXCEEDED'],
    ['voltage +10.01 % at rated frequency', 506.05, 60, 'COMBINED_VF_SUM_EXCEEDED'],
  ])('just beyond the boundary: %s', (_n, v, f, rule) => {
    const r = run(v, f)
    expect(codes(r)).toContain(rule)
    expect(r.overallStatus).toBe('WARNING')
  })

  it('frequency beyond 5 % and sum beyond 10 %: both combined findings and the individual warning are kept', () => {
    const r = run(440, 56)
    expect(codes(r)).toEqual(expect.arrayContaining(['COMBINED_VF_SUM_EXCEEDED', 'COMBINED_VF_FREQUENCY_EXCEEDED', 'WARNING_BELOW_LOWER']))
  })

  it('floating-point noise at the boundary never produces a false violation (various rated values)', () => {
    for (const [vr, fr] of [[460, 60], [230, 50], [4160, 60], [575, 60], [400, 50], [208, 60]]) {
      for (const [a, b] of [[5, 5], [10, 0], [0, 5], [7, 3], [2.5, 5], [9.9, 0.1], [3.3, 5]]) {
        for (const sv of [1, -1]) {
          for (const sf of [1, -1]) {
            const v = vr * (1 + (sv * a) / 100)
            const f = fr * (1 + (sf * b) / 100)
            const wide = profile({ limits: [lim('voltage', 'Voltage', 'V', 0, 1e9), lim('frequency', 'Frequency', 'Hz', 0, 1e9)] })
            const r = run(v, f, { motor: { motor_type: 'induction', phase_count: 3, rated_frequency: fr, rated_voltage: vr } }, wide)
            const label = `${vr}V/${fr}Hz ${sv * a}% ${sf * b}%`
            expect(codes(r), label).not.toContain('COMBINED_VF_SUM_EXCEEDED')
            expect(codes(r), label).not.toContain('COMBINED_VF_FREQUENCY_EXCEEDED')
          }
        }
      }
    }
  })

  it('unit normalization happens before the rule: 0.414 kV and 414 V give the same verdict', () => {
    const def = { code: 'voltage', display_name: 'Voltage', description: null, canonical_unit: 'V' }
    const n = normalizeMeasurement(def, 0.414, 'kV')
    expect(n).toEqual({ ok: true, value: 414, unit: 'V' })
    const r = run((n as { value: number }).value, 58.8)
    expect(codes(r)).toContain('COMBINED_VF_SUM_EXCEEDED')
  })

  it('a reading whose normalized unit is not the canonical one is not converted: the rule is unassessed', () => {
    const r = run(414, 60, { readings: [rd('voltage', 414, 'V'), rd('frequency', 0.06, 'kHz')] })
    expect(codes(r)).toContain('DATA_COMBINED_RULE_NOT_EVALUABLE')
    expect(codes(r)).not.toContain('COMBINED_VF_WITHIN')
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
    expect(r.complete).toBe(false)
  })

  it('an individual violation is not hidden by a passing combined check', () => {
    const tight = profile({ limits: [lim('voltage', 'Voltage', 'V', 414, 480), lim('frequency', 'Frequency', 'Hz', 57, 63)] })
    const r = run(490, 60, {}, tight) // +6.5 %: combined within, individual warning above 480
    expect(codes(r)).toEqual(expect.arrayContaining(['COMBINED_VF_WITHIN', 'WARNING_ABOVE_UPPER']))
    expect(r.overallStatus).toBe('WARNING')
  })

  it('a combined violation is kept alongside a critical individual finding', () => {
    const withCritical = profile({ limits: [{ ...lim('voltage', 'Voltage', 'V', 414, 506), upper_limit: 600 }, lim('frequency', 'Frequency', 'Hz', 57, 63)] })
    const r = run(650, 58.8, {}, withCritical)
    expect(r.overallStatus).toBe('FAULT_SUSPECTED')
    expect(codes(r)).toContain('COMBINED_VF_SUM_EXCEEDED')
    expect(codes(r)).toContain('LIMIT_ABOVE_UPPER')
  })
})

describe('combined rule - rated-load condition and missing information', () => {
  it.each([
    ['not recorded', undefined, 'DATA_CONDITION_NOT_ESTABLISHED'],
    ['unknown', 'unknown', 'DATA_CONDITION_NOT_ESTABLISHED'],
    ['unsupported value', 'turbo', 'DATA_CONDITION_NOT_ESTABLISHED'],
    ['wrong type', 42, 'DATA_CONDITION_NOT_ESTABLISHED'],
    ['below rated', 'below_rated', 'DATA_CONDITION_NOT_MET'],
    ['no load', 'no_load', 'DATA_CONDITION_NOT_MET'],
  ])('%s: values inside every range are NOT passed - unassessed, incomplete, INSUFFICIENT_DATA', (_n, value, rule) => {
    const r = run(460, 60, { operatingConditions: value === undefined ? {} : { load_condition: value } })
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
    expect(r.complete).toBe(false)
    expect(codes(r)).toContain(rule)
    expect(codes(r)).not.toContain('WITHIN_LIMITS')
    expect(codes(r)).not.toContain('COMBINED_VF_WITHIN')
  })

  it('submitting the test does not imply rated load: no operating conditions at all is not established', () => {
    const r = run(460, 60, { operatingConditions: undefined })
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
  })

  it('when load is not established, a numeric violation is still reported (not hidden) but flagged as unconfirmed', () => {
    const r = run(414, 58.8, { operatingConditions: {} })
    expect(r.overallStatus).toBe('WARNING') // known abnormality outranks missing information (21.5 rows 3-4)
    expect(r.complete).toBe(false)
    const f = r.findings.find((x) => x.ruleCode === 'COMBINED_VF_SUM_EXCEEDED')!
    expect(f.description).toMatch(/not established, so it is not confirmed that this tolerance applies/)
    expect(codes(r)).toContain('DATA_CONDITION_NOT_ESTABLISHED')
  })

  it('an out-of-range individual reading at an unestablished load is reported AND the check is marked unassessed', () => {
    const r = run(300, 60, { operatingConditions: {} })
    expect(codes(r)).toEqual(expect.arrayContaining(['WARNING_BELOW_LOWER', 'DATA_CONDITION_NOT_ESTABLISHED']))
    expect(r.findings.find((f) => f.ruleCode === 'WARNING_BELOW_LOWER')!.description).toMatch(/not established for this test/)
  })

  it.each([
    ['voltage missing', undefined, 60],
    ['frequency missing', 460, undefined],
  ])('%s: combined check unassessed, never NORMAL', (_n, v, f) => {
    const r = run(v, f)
    expect(codes(r)).toContain('DATA_COMBINED_RULE_NOT_EVALUABLE')
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
    expect(codes(r)).not.toContain('COMBINED_VF_WITHIN')
  })

  it('no readings at all: INSUFFICIENT_DATA (nothing evaluated)', () => {
    const r = run(undefined, undefined)
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
    expect(codes(r)).toEqual(['DATA_MISSING_READING'])
  })

  it('invalid (non-finite) normalized reading: unassessed', () => {
    const r = run(null, 60)
    expect(codes(r)).toContain('DATA_COMBINED_RULE_NOT_EVALUABLE')
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
  })

  it('duplicate reading: unassessed', () => {
    const r = run(460, 60, { readings: [rd('voltage', 460, 'V'), rd('voltage', 461, 'V'), rd('frequency', 60, 'Hz')] })
    expect(codes(r)).toContain('DATA_COMBINED_RULE_NOT_EVALUABLE')
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
  })

  it.each([
    ['no rated voltage', { rated_voltage: null, rated_frequency: 60 }],
    ['no rated frequency', { rated_voltage: 460, rated_frequency: null }],
  ])('motor with %s on a profile that restricts those specs: applicability unknown, no limits applied', (_n, rated) => {
    const p = profile({ applicable_specs: { rated_voltage_min_v: 460, rated_voltage_max_v: 460, rated_frequency_hz: 60, combined_variation: CFG } })
    const r = run(460, 60, { motor: { motor_type: 'induction', phase_count: 3, ...rated } }, p)
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
    expect(codes(r)).toEqual(['PROFILE_APPLICABILITY_UNKNOWN'])
  })

  it('rated values missing on a profile without spec restrictions: combined rule unassessed', () => {
    const r = run(460, 60, { motor: { motor_type: 'induction', phase_count: 3, rated_voltage: null, rated_frequency: 60 } })
    expect(codes(r)).toContain('DATA_COMBINED_RULE_NOT_EVALUABLE')
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
  })

  it('a profile without the combined rule behaves as before (no combined findings)', () => {
    const r = run(414, 58.8, {}, profile({ applicable_specs: {} }, undefined))
    expect(codes(r).some((c) => c.startsWith('COMBINED_'))).toBe(false)
    expect(r.overallStatus).toBe('NORMAL')
  })

  it('limits without a required_load_condition are evaluated regardless of the recorded load', () => {
    const p = profile({ limits: [lim('voltage', 'Voltage', 'V', 414, 506, {}), lim('frequency', 'Frequency', 'Hz', 57, 63, {})], applicable_specs: {} })
    expect(run(460, 60, { operatingConditions: {} }, p).overallStatus).toBe('NORMAL')
  })

  it('an invalid combined configuration is reported as CONFIG_INVALID_COMBINED_RULE and blocks NORMAL', () => {
    for (const bad of [{ ...CFG, max_combined_percent: 0 }, { ...CFG, max_frequency_percent: 'x' }, { ...CFG, source: '' }, 'text', null, { ...CFG, frequency_parameter: 'voltage' }]) {
      const r = run(460, 60, {}, profile({}, bad))
      expect(codes(r), JSON.stringify(bad)).toContain('CONFIG_INVALID_COMBINED_RULE')
      expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
    }
  })

  it('is deterministic', () => {
    expect(run(414, 58.8)).toEqual(run(414, 58.8))
  })
})

describe('combinedVariation helpers', () => {
  it('parseCombinedConfig distinguishes absent / invalid / ok', () => {
    expect(parseCombinedConfig({}).kind).toBe('absent')
    expect(parseCombinedConfig(undefined).kind).toBe('absent')
    expect(parseCombinedConfig({ combined_variation: CFG }).kind).toBe('ok')
    expect(parseCombinedConfig({ combined_variation: [] }).kind).toBe('invalid')
  })

  it('loadConditionState never assumes rated load', () => {
    expect(loadConditionState(undefined, 'rated')).toBe('not_established')
    expect(loadConditionState({}, 'rated')).toBe('not_established')
    expect(loadConditionState({ load_condition: 'rated' }, 'rated')).toBe('met')
    expect(loadConditionState({ load_condition: 'no_load' }, 'rated')).toBe('not_met')
    expect(describeConditionProblem('not_met', 'rated', 'no_load')).toMatch(/No load.*Rated load/)
  })
})

describe('load condition on the test form and profile approval', () => {
  const base = { ...newTestForm([], 'm1'), timestamp: '2026-01-01T00:00' }
  it('is stored in operating_conditions, preserved with other keys, and may be cleared', () => {
    const a = validateSessionMeta({ ...base, load_condition: 'rated', operator: 'A' }, { keep: 1 })
    expect(a.ok && a.data.operating_conditions).toEqual({ keep: 1, operator: 'A', load_condition: 'rated' })
    const b = validateSessionMeta({ ...base, load_condition: '' }, { load_condition: 'rated' })
    expect(b.ok && b.data.operating_conditions).toEqual({})
  })
  it('rejects an unknown load condition', () => {
    expect(validateSessionMeta({ ...base, load_condition: 'heavy' }).ok).toBe(false)
  })
  it('approval is blocked when the combined rule is malformed', () => {
    const p = { ...profile(), source_name: 's', source_reference: 'r', effective_from: '2026-01-01', applicable_specs: { combined_variation: { nope: 1 } } } as never
    const limits = [{ parameter_code: 'voltage', parameter_name: 'Voltage', unit: 'V', source_note: 'n' }] as never
    const defs = [{ code: 'voltage', canonical_unit: 'V' }] as never
    expect(assessApprovalReadiness(p, limits, defs).blockers.join(' ')).toMatch(/combined voltage\/frequency rule is inconsistent/)
  })
})
