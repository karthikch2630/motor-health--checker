import { describe, expect, it } from 'vitest'
import { assessMotor, type DiagnosticInput, type EngineProfile, type EngineReading } from './diagnostics'
import { evaluateCombinedVariation, parseCombinedConfig, type CombinedVariationConfig } from './combinedVariation'
import { motorCoverage } from './profileCoverage'

// SYNTHETIC inputs mirroring the shape of the draft NEMA profile (stored values: 414-506 V, 57-63 Hz warning; combined 10 % / 5 %).
const CFG: CombinedVariationConfig = {
  voltage_parameter: 'voltage', frequency_parameter: 'frequency', voltage_unit: 'V', frequency_unit: 'Hz',
  max_combined_percent: 10, max_frequency_percent: 5, required_load_condition: 'rated', source: 'SYNTHETIC',
}
const limit = (code: string, name: string, unit: string, lo: number, hi: number) => ({
  parameter_code: code, parameter_name: name, unit, lower_limit: null, upper_limit: null, warning_lower: lo, warning_upper: hi,
  applicable_conditions: { required_load_condition: 'rated' },
})
const profile = (over: Partial<EngineProfile> = {}): EngineProfile => ({
  id: 'bab00003-0000-4000-8000-000000000001', name: 'SYNTHETIC copy of the draft', version: 1, approval_status: 'approved', motor_type: 'induction',
  applicable_specs: { phase_count: 3, supply_type: 'line', rated_frequency_hz: 60, rated_voltage_min_v: 460, rated_voltage_max_v: 460, combined_variation: CFG },
  effective_from: null, effective_to: null,
  limits: [limit('voltage', 'Voltage', 'V', 414, 506), limit('frequency', 'Frequency', 'Hz', 57, 63)], ...over,
})
const rd = (code: string, v: number, unit: string, over: Partial<EngineReading> = {}): EngineReading =>
  ({ parameter_code: code, measured_value: v, measured_unit: unit, normalized_value: v, normalized_unit: unit, ...over })
const MOTOR = { motor_type: 'induction', phase_count: 3, rated_frequency: 60, rated_voltage: 460, supply_type: 'line' as const }
const run = (readings: EngineReading[], over: Partial<DiagnosticInput> = {}, p: EngineProfile = profile()) =>
  assessMotor({
    sessionStatus: 'submitted', testTime: new Date('2026-06-01T00:00:00Z'), motor: MOTOR, operatingConditions: { load_condition: 'rated' },
    readings, profile: p, parameterNames: { voltage: 'Voltage', frequency: 'Frequency' }, ...over,
  })
const vf = (v: number, f: number) => [rd('voltage', v, 'V'), rd('frequency', f, 'Hz')]
const codes = (r: ReturnType<typeof run>) => r.findings.map((f) => f.ruleCode)
const combined = (r: ReturnType<typeof run>) => r.findings.filter((f) => f.ruleCode.startsWith('COMBINED_'))

describe('requested synthetic cases', () => {
  it('1. 455 V / 60 Hz at rated load: combined ~1.087 %, no combined warning', () => {
    const r = run(vf(455, 60))
    const w = combined(r)
    expect(w.map((f) => f.ruleCode)).toEqual(['COMBINED_VF_WITHIN'])
    expect(w[0].observedValue).toBeCloseTo((5 / 460) * 100, 9) // 1.0869565...
    expect(w[0].observedValue).toBeCloseTo(1.087, 3)
    expect(r.overallStatus).toBe('NORMAL')
  })
  it('2. 414 V / 58.8 Hz: dV 10 %, dF 2 %, combined 12 % -> warning', () => {
    const f = combined(run(vf(414, 58.8)))
    expect(f.map((x) => x.ruleCode)).toEqual(['COMBINED_VF_SUM_EXCEEDED'])
    expect(f[0].observedValue).toBeCloseTo(12, 9)
    expect(f[0].severity).toBe('WARNING')
  })
  it('3. 506 V / 60 Hz: combined exactly 10 % -> no combined warning', () => {
    expect(combined(run(vf(506, 60))).map((f) => f.ruleCode)).toEqual(['COMBINED_VF_WITHIN'])
  })
  it('4. 460 V / 63 Hz: frequency exactly 5 % -> no frequency warning', () => {
    expect(combined(run(vf(460, 63))).map((f) => f.ruleCode)).toEqual(['COMBINED_VF_WITHIN'])
  })
})

describe('signs and just-below / just-above every boundary', () => {
  const cases: [string, number, number, boolean][] = [
    // [label, V, F, violation expected]
    ['sum 10 % exactly (-10 % V)', 414, 60, false],
    ['sum just below 10 % (V 414.05)', 414.05, 60, false],
    ['sum just above 10 % (V 413.95)', 413.95, 60, true],
    ['sum 10 % exactly (+10 % V)', 506, 60, false],
    ['sum just above 10 % (V 506.05)', 506.05, 60, true],
    ['sum 10 % exactly (+4 % V, +6 % F is not allowed -> F rule)', 478.4, 63.6, true], // F 6 % > 5 %
    ['sum 10 % exactly (+5 % V, +5 % F)', 483, 63, false],
    ['sum 10 % exactly (-5 % V, +5 % F)', 437, 63, false],
    ['opposite signs still add: +5.1 % V, -5 % F', 483.46, 57, true],
    ['F -5 % exactly', 460, 57, false],
    ['F just below -5 % (56.97 Hz)', 460, 56.97, true],
    ['F just inside -5 % (57.03 Hz)', 460, 57.03, false],
    ['F +5 % exactly', 460, 63, false],
    ['F just above +5 % (63.03 Hz)', 460, 63.03, true],
  ]
  it.each(cases)('%s', (_label, v, f, bad) => {
    const rule = combined(run(vf(v, f))).some((x) => x.ruleCode === 'COMBINED_VF_SUM_EXCEEDED' || x.ruleCode === 'COMBINED_VF_FREQUENCY_EXCEEDED')
    expect(rule).toBe(bad)
  })

  it('floating-point edge: values computed as rated * (1 +/- p/100) never trip the boundary, tiny real excess always does', () => {
    for (const [vr, fr] of [[460, 60], [460, 50], [230, 60], [575, 60]]) {
      for (const sign of [1, -1]) {
        const onBoundary = [vr * (1 + (sign * 10) / 100), fr]
        const motor = { ...MOTOR, rated_voltage: vr, rated_frequency: fr }
        // no motor-spec restrictions here: this loop varies the rated values to exercise the arithmetic only
        const wide = profile({ applicable_specs: { combined_variation: CFG }, limits: [limit('voltage', 'Voltage', 'V', 0, 1e9), limit('frequency', 'Frequency', 'Hz', 0, 1e9)] })
        expect(combined(run(vf(onBoundary[0], onBoundary[1]), { motor }, wide)).map((x) => x.ruleCode), `${vr}/${fr} ${sign}`).toEqual(['COMBINED_VF_WITHIN'])
        const over = vr * (1 + (sign * 10.001) / 100) // 0.001 % beyond: far above the 1e-9 % tolerance
        expect(combined(run(vf(over, fr), { motor }, wide)).map((x) => x.ruleCode)).toEqual(['COMBINED_VF_SUM_EXCEEDED'])
      }
    }
  })
})

describe('invalid readings never pass (non-finite, missing, duplicate, unit)', () => {
  const NOT_EVALUABLE = 'DATA_COMBINED_RULE_NOT_EVALUABLE'
  it.each([
    ['NaN voltage', [rd('voltage', NaN, 'V'), rd('frequency', 60, 'Hz')]],
    ['Infinity voltage', [rd('voltage', Infinity, 'V'), rd('frequency', 60, 'Hz')]],
    ['-Infinity frequency', [rd('voltage', 460, 'V'), rd('frequency', -Infinity, 'Hz')]],
    ['NaN frequency', [rd('voltage', 460, 'V'), rd('frequency', NaN, 'Hz')]],
    ['null normalized value', [rd('voltage', 460, 'V', { normalized_value: null, normalized_unit: null }), rd('frequency', 60, 'Hz')]],
    ['kV unit (not converted by the engine)', [rd('voltage', 0.46, 'kV'), rd('frequency', 60, 'Hz')]],
    ['unsupported unit text', [rd('voltage', 460, 'V'), rd('frequency', 60, 'rpm')]],
    ['duplicate frequency', [...vf(460, 60), rd('frequency', 60, 'Hz')]],
    ['voltage missing', [rd('frequency', 60, 'Hz')]],
    ['frequency missing', [rd('voltage', 460, 'V')]],
  ])('%s -> unassessed, incomplete, INSUFFICIENT_DATA, no "within" finding', (_n, readings) => {
    const r = run(readings)
    expect(codes(r)).toContain(NOT_EVALUABLE)
    expect(codes(r)).not.toContain('COMBINED_VF_WITHIN')
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
    expect(r.complete).toBe(false)
  })
})

describe('rated values and configuration', () => {
  it.each([
    ['rated voltage NaN', { rated_voltage: NaN }],
    ['rated voltage 0', { rated_voltage: 0 }],
    ['rated voltage negative', { rated_voltage: -460 }],
    ['rated frequency Infinity', { rated_frequency: Infinity }],
    ['rated frequency 0', { rated_frequency: 0 }],
    ['rated frequency null', { rated_frequency: null }],
  ])('%s: the combined rule is unassessed (evaluated directly, bypassing profile applicability)', (_n, rated) => {
    const out = evaluateCombinedVariation({
      config: CFG, motor: { rated_voltage: 460, rated_frequency: 60, ...rated }, readings: vf(460, 60),
      operatingConditions: { load_condition: 'rated' }, label: 'p', inspectionAction: 'x',
    })
    expect(out.unevaluable).toBe(1)
    expect(out.findings.map((f) => f.ruleCode)).toEqual(['DATA_COMBINED_RULE_NOT_EVALUABLE'])
  })

  it.each([
    ['missing key', (() => { const { source: _s, ...c } = CFG; return c })()],
    ['NaN percent', { ...CFG, max_combined_percent: NaN }],
    ['Infinity percent', { ...CFG, max_frequency_percent: Infinity }],
    ['negative percent', { ...CFG, max_combined_percent: -10 }],
    ['string percent', { ...CFG, max_combined_percent: '10' }],
    ['blank unit', { ...CFG, voltage_unit: ' ' }],
    ['array', []],
    ['number', 5],
  ])('malformed configuration (%s) is invalid and the assessment cannot be NORMAL', (_n, bad) => {
    expect(parseCombinedConfig({ combined_variation: bad }).kind).toBe('invalid')
    const r = run(vf(460, 60), {}, profile({ applicable_specs: { combined_variation: bad } }))
    expect(codes(r)).toContain('CONFIG_INVALID_COMBINED_RULE')
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
  })

  it('a missing combined_variation key is "absent" (no rule), which only a profile author can choose; it is never confused with a pass of the rule', () => {
    expect(parseCombinedConfig({}).kind).toBe('absent')
    expect(codes(run(vf(414, 58.8), {}, profile({ applicable_specs: {} }))).some((c) => c.startsWith('COMBINED_'))).toBe(false)
  })
})

describe('load condition: only a recorded "rated" assesses the rule; nothing is inferred', () => {
  it.each(['below_rated', 'above_rated', 'no_load', 'unknown', undefined, '', 'RATED', 'rated '])('load = %j -> not assessed, incomplete', (load) => {
    const r = run(vf(460, 60), { operatingConditions: load === undefined ? {} : { load_condition: load } })
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
    expect(r.complete).toBe(false)
    expect(codes(r)).not.toContain('COMBINED_VF_WITHIN')
    expect(codes(r)).not.toContain('WITHIN_LIMITS')
  })
  it('a current reading equal to rated current does not establish rated load', () => {
    const r = run([...vf(460, 60), rd('current', 10, 'A')], { operatingConditions: {}, motor: { ...MOTOR, rated_current: 10 } as never })
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
  })
})

describe('profile applicability and approval are separate gates', () => {
  it('a DRAFT profile is never used, even when type, specs and supply all match', () => {
    const r = run(vf(460, 60), {}, profile({ approval_status: 'draft' }))
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
    expect(codes(r)).toEqual(['PROFILE_NOT_APPLICABLE'])
    expect(r.referenceProfileId).toBeNull()
  })
  it('supply_type NULL (as for all 15 hosted motors today): profile NOT applied, applicability unknown', () => {
    const r = run(vf(460, 60), { motor: { ...MOTOR, supply_type: null } })
    expect(codes(r)).toEqual(['PROFILE_APPLICABILITY_UNKNOWN'])
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
    expect(r.referenceProfileId).toBeNull()
  })
  it('an inverter-fed motor is incompatible', () => {
    const r = run(vf(460, 60), { motor: { ...MOTOR, supply_type: 'inverter' } })
    expect(codes(r)).toEqual(['PROFILE_NOT_APPLICABLE'])
  })
  it('the model name is never used to infer the supply (VECP3770T-4 / VEBM3558 with NULL supply stay unknown)', () => {
    for (const model of ['VECP3770T-4', 'VEBM3558', 'EM3707']) {
      const motor = { id: 'm', motor_type: 'induction', phase_count: 3, rated_frequency: 60, rated_voltage: 460, supply_type: null, model }
      const cov = motorCoverage(motor, [{ ...profile(), limit_count: 2 } as never], new Date())
      expect(cov.usable, model).toHaveLength(0)
      expect(cov.unusable[0].match.status, model).toBe('unknown')
    }
  })
  it('"compatible" does not bypass approval: profileCoverage lists a compatible draft as unusable', () => {
    const motor = { id: 'm', motor_type: 'induction', phase_count: 3, rated_frequency: 60, rated_voltage: 460, supply_type: 'line' as const }
    const cov = motorCoverage(motor, [{ ...profile({ approval_status: 'draft' }), limit_count: 2 } as never], new Date())
    expect(cov.usable).toHaveLength(0)
    expect(cov.unusable[0].match.reasons.join(' ')).toMatch(/not approved/)
  })
  it('rated voltage other than 460 V is incompatible with the voltage-bounded profile', () => {
    const motor = { id: 'm', motor_type: 'induction', phase_count: 3, rated_frequency: 60, rated_voltage: 460.5, supply_type: 'line' as const }
    expect(motorCoverage(motor, [{ ...profile(), limit_count: 2 } as never], new Date()).usable).toHaveLength(0)
  })
})

describe('partial coverage on the draft-shaped profile', () => {
  it('only voltage and frequency are assessed; current/temperature/vibration/speed/power factor are listed as not checked; never "healthy"', () => {
    const names = { voltage: 'Voltage', frequency: 'Frequency', current: 'Current', temperature: 'Temperature', vibration: 'Vibration', speed: 'Rotational speed', power_factor: 'Power factor' }
    const r = run(vf(460, 60), { parameterNames: names })
    expect(r.overallStatus).toBe('NORMAL')
    expect(r.summary).toMatch(/^PARTIAL ASSESSMENT/)
    expect(r.summary).toMatch(/not a statement that the motor is healthy/)
    const cov = r.findings.find((f) => f.ruleCode === 'COVERAGE_PARTIAL')!
    for (const n of ['Current', 'Temperature', 'Vibration', 'Rotational speed', 'Power factor']) expect(cov.description).toContain(n)
    expect(cov.description).not.toMatch(/Voltage,|Frequency,/)
    expect(r.findings.filter((f) => f.parameterCode && !['voltage', 'frequency'].includes(f.parameterCode))).toEqual([])
  })
})
