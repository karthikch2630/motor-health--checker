import { describe, expect, it } from 'vitest'
import {
  assessMotor,
  DIAGNOSTIC_ENGINE_VERSION,
  evaluateLimit,
  isAssessmentComplete,
  validateThresholds,
  type DiagnosticInput,
  type EngineLimit,
  type EngineProfile,
  type EngineReading,
} from './diagnostics'

// ALL NUMBERS BELOW ARE SYNTHETIC TEST DATA. They are not engineering limits and are never used as defaults.
// Fixture "parameters" reuse real catalog codes only so unit/name handling looks realistic.

const limit = (over: Partial<EngineLimit> = {}): EngineLimit => ({
  parameter_code: 'voltage', parameter_name: 'Voltage', unit: 'V',
  lower_limit: null, upper_limit: null, warning_lower: null, warning_upper: null, ...over,
})
const profile = (limits: EngineLimit[], over: Partial<EngineProfile> = {}): EngineProfile => ({
  id: 'prof-1', name: 'SYNTHETIC profile', version: 3, approval_status: 'approved', motor_type: 'induction',
  applicable_specs: {}, effective_from: null, effective_to: null, limits, ...over,
})
const reading = (code: string, v: number | null, unit = 'V', over: Partial<EngineReading> = {}): EngineReading => ({
  parameter_code: code, measured_value: v ?? 0, measured_unit: unit, normalized_value: v, normalized_unit: v === null ? null : unit, ...over,
})
const input = (readings: EngineReading[], p: EngineProfile | null, over: Partial<DiagnosticInput> = {}): DiagnosticInput => ({
  sessionStatus: 'submitted', testTime: new Date('2026-06-01T00:00:00Z'),
  motor: { motor_type: 'Induction', phase_count: 3, rated_frequency: 50, rated_voltage: 400 }, readings, profile: p, ...over,
})
const codes = (r: ReturnType<typeof assessMotor>) => r.findings.map((f) => f.ruleCode)

// Synthetic two-sided configuration: L=10, WL=20, WU=80, U=90
const full = limit({ lower_limit: 10, warning_lower: 20, warning_upper: 80, upper_limit: 90 })

describe('boundary comparisons (inclusive; strictly beyond is a finding)', () => {
  it.each([
    [50, 'WITHIN_LIMITS', 'INFO'],
    [20, 'WITHIN_LIMITS', 'INFO'], // equals warning_lower
    [80, 'WITHIN_LIMITS', 'INFO'], // equals warning_upper
    [19.999, 'WARNING_BELOW_LOWER', 'WARNING'],
    [80.001, 'WARNING_ABOVE_UPPER', 'WARNING'],
    [10, 'WARNING_BELOW_LOWER', 'WARNING'], // equals lower_limit: not critical, but below warning_lower
    [90, 'WARNING_ABOVE_UPPER', 'WARNING'], // equals upper_limit: not critical, but above warning_upper
    [9.999, 'LIMIT_BELOW_LOWER', 'CRITICAL'],
    [90.001, 'LIMIT_ABOVE_UPPER', 'CRITICAL'],
    [-5, 'LIMIT_BELOW_LOWER', 'CRITICAL'],
  ])('value %f -> %s (%s)', (v, rule, severity) => {
    const f = evaluateLimit(v, 'V', full, 'p')
    expect(f.ruleCode).toBe(rule)
    expect(f.severity).toBe(severity)
  })

  it('records the crossed boundary, observed value and unit', () => {
    const f = evaluateLimit(95, 'V', full, 'profile "P" v3')
    expect(f).toMatchObject({ applicableLimit: 90, observedValue: 95, observedUnit: 'V', parameterCode: 'voltage' })
    expect(f.description).toMatch(/95 V.*above the approved upper limit of 90 V/)
    expect(f.description).toMatch(/not a confirmed fault/)
    expect(f.possibleCauses).toEqual([]) // no source-backed cause rules exist
    expect(f.recommendedAction).toMatch(/qualified person/)
  })

  it('treats zero as a real value, not as missing', () => {
    const f = evaluateLimit(0, 'V', limit({ lower_limit: 5 }), 'p')
    expect(f.ruleCode).toBe('LIMIT_BELOW_LOWER')
    expect(f.observedValue).toBe(0)
    expect(evaluateLimit(0, 'V', limit({ upper_limit: 5 }), 'p').ruleCode).toBe('WITHIN_LIMITS')
  })
})

describe('one-sided and partial configurations', () => {
  it('upper limit only: no lower-side findings, however low the value', () => {
    expect(evaluateLimit(-1000, 'V', limit({ upper_limit: 50 }), 'p').ruleCode).toBe('WITHIN_LIMITS')
    expect(evaluateLimit(51, 'V', limit({ upper_limit: 50 }), 'p').ruleCode).toBe('LIMIT_ABOVE_UPPER')
  })
  it('lower limit only: no upper-side findings, however high the value', () => {
    expect(evaluateLimit(1e9, 'V', limit({ lower_limit: 50 }), 'p').ruleCode).toBe('WITHIN_LIMITS')
    expect(evaluateLimit(49, 'V', limit({ lower_limit: 50 }), 'p').ruleCode).toBe('LIMIT_BELOW_LOWER')
  })
  it('warning threshold only: can warn but can never be critical on that side', () => {
    const l = limit({ warning_upper: 50 })
    expect(evaluateLimit(1e9, 'V', l, 'p')).toMatchObject({ ruleCode: 'WARNING_ABOVE_UPPER', severity: 'WARNING' })
  })
  it('limit without warning thresholds: breach is critical, nothing in between', () => {
    const l = limit({ lower_limit: 10, upper_limit: 90 })
    expect(evaluateLimit(89, 'V', l, 'p').severity).toBe('INFO')
    expect(evaluateLimit(91, 'V', l, 'p').severity).toBe('CRITICAL')
  })
})

describe('validateThresholds (ambiguous / inconsistent configurations)', () => {
  it('accepts consistent configurations, including equal neighbours', () => {
    expect(validateThresholds(full)).toBeNull()
    expect(validateThresholds(limit({ lower_limit: 5, upper_limit: 5 }))).toBeNull()
    expect(validateThresholds(limit({ warning_lower: 1, warning_upper: 1 }))).toBeNull()
    expect(validateThresholds(limit({ lower_limit: 1, warning_upper: 2 }))).toBeNull() // non-adjacent pair
  })
  it.each([
    [{ lower_limit: 50, upper_limit: 10 }],
    [{ warning_lower: 30, warning_upper: 20 }],
    [{ lower_limit: 10, warning_lower: 5 }], // warning below the hard limit
    [{ warning_upper: 95, upper_limit: 90 }], // warning above the hard limit
    [{ lower_limit: 50, warning_upper: 40 }],
    [{ warning_lower: 60, upper_limit: 50 }],
  ])('rejects %j', (over) => {
    expect(validateThresholds(limit(over))).toMatch(/expected lower limit/)
  })
  it('rejects an empty configuration and non-finite numbers (never reads null as 0 or infinity)', () => {
    expect(validateThresholds(limit())).toMatch(/no limit or warning/)
    expect(validateThresholds(limit({ upper_limit: Infinity }))).toMatch(/not a finite/)
    expect(validateThresholds(limit({ lower_limit: NaN }))).toMatch(/not a finite/)
  })
})

describe('assessMotor — statuses', () => {
  const p = profile([full])

  it('NORMAL: every required parameter evaluated, nothing abnormal, complete', () => {
    const r = assessMotor(input([reading('voltage', 50)], p))
    expect(r.overallStatus).toBe('NORMAL')
    expect(r.complete).toBe(true)
    expect(r.referenceProfileId).toBe('prof-1')
    expect(r.referenceProfileVersion).toBe(3)
    expect(r.diagnosticEngineVersion).toBe(DIAGNOSTIC_ENGINE_VERSION)
    expect(codes(r)).toEqual(['WITHIN_LIMITS'])
  })

  it('WARNING when a warning threshold is crossed', () => {
    const r = assessMotor(input([reading('voltage', 85)], p))
    expect(r.overallStatus).toBe('WARNING')
    expect(r.findings[0]).toMatchObject({ ruleCode: 'WARNING_ABOVE_UPPER', applicableLimit: 80 })
  })

  it('FAULT_SUSPECTED when an approved hard boundary is crossed — worded as suspected, never confirmed', () => {
    const r = assessMotor(input([reading('voltage', 95)], p))
    expect(r.overallStatus).toBe('FAULT_SUSPECTED')
    expect(r.summary).toMatch(/suspected/i)
    expect(r.summary).toMatch(/not a confirmed diagnosis/i)
    expect(r.summary).not.toMatch(/confirmed fault\b(?! )/)
  })

  it('NOT_ASSESSED for a draft test; no findings, no profile recorded', () => {
    const r = assessMotor(input([reading('voltage', 95)], p, { sessionStatus: 'draft' }))
    expect(r).toMatchObject({ overallStatus: 'NOT_ASSESSED', findings: [], referenceProfileId: null })
  })

  it('INSUFFICIENT_DATA when a required reading is missing, never NORMAL', () => {
    const two = profile([full, limit({ parameter_code: 'current', parameter_name: 'Current', unit: 'A', upper_limit: 5 })])
    const r = assessMotor(input([reading('voltage', 50)], two))
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
    expect(r.missingParameters).toEqual(['current'])
    expect(r.complete).toBe(false)
    expect(codes(r)).toContain('DATA_MISSING_READING')
    expect(r.summary).toMatch(/cannot be assessed as normal/)
    expect(r.referenceProfileId).toBe('prof-1') // the profile that WAS applied stays traceable
  })

  it('a measured zero satisfies the requirement (zero is not missing)', () => {
    const r = assessMotor(input([reading('voltage', 0)], profile([limit({ upper_limit: 5 })])))
    expect(r.overallStatus).toBe('NORMAL')
    expect(r.missingParameters).toEqual([])
  })

  it('INSUFFICIENT_DATA when the test has no readings at all', () => {
    const r = assessMotor(input([], p))
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
    expect(r.missingParameters).toEqual(['voltage'])
  })
})

describe('assessMotor — mixed findings and incomplete data', () => {
  const two = profile([
    full,
    limit({ parameter_code: 'current', parameter_name: 'Current', unit: 'A', upper_limit: 5, warning_upper: 4 }),
    limit({ parameter_code: 'temperature', parameter_name: 'Temperature', unit: '°C', upper_limit: 70 }),
  ])

  it('preserves a suspected-fault finding even though other parameters are missing', () => {
    const r = assessMotor(input([reading('voltage', 95)], two))
    expect(r.overallStatus).toBe('FAULT_SUSPECTED')
    expect(r.complete).toBe(false)
    expect(r.missingParameters.sort()).toEqual(['current', 'temperature'])
    expect(codes(r)).toEqual(expect.arrayContaining(['LIMIT_ABOVE_UPPER', 'DATA_MISSING_READING']))
    expect(r.summary).toMatch(/incomplete/)
  })

  it('preserves a warning even when other data is missing (status stays WARNING, flagged incomplete)', () => {
    const r = assessMotor(input([reading('voltage', 85)], two))
    expect(r.overallStatus).toBe('WARNING')
    expect(r.complete).toBe(false)
  })

  it('reports several findings in one assessment, most severe first, highest severity decides the status', () => {
    const r = assessMotor(input([reading('voltage', 85), reading('current', 4.5, 'A'), reading('temperature', 80, '°C')], two))
    expect(r.overallStatus).toBe('FAULT_SUSPECTED')
    expect(r.findings.map((f) => f.severity)).toEqual(['CRITICAL', 'WARNING', 'WARNING'])
    expect(r.findings.map((f) => f.parameterCode)).toEqual(['temperature', 'current', 'voltage'])
    expect(r.complete).toBe(true)
  })

  it('two warnings and nothing critical give WARNING', () => {
    const r = assessMotor(input([reading('voltage', 85), reading('current', 4.5, 'A'), reading('temperature', 60, '°C')], two))
    expect(r.overallStatus).toBe('WARNING')
    expect(r.findings.filter((f) => f.severity === 'WARNING')).toHaveLength(2)
  })
})

describe('assessMotor — invalid or unusable data', () => {
  const p = profile([full])

  it('unit mismatch: no conversion, parameter not evaluated, no fake comparison', () => {
    const r = assessMotor(input([reading('voltage', 0.05, 'kV')], p))
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
    expect(codes(r)).toEqual(['DATA_UNIT_MISMATCH'])
  })

  it('missing normalized value is invalid, not zero', () => {
    const r = assessMotor(input([reading('voltage', null)], p))
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
    expect(codes(r)).toEqual(['DATA_INVALID_READING'])
  })

  it('non-finite normalized value is invalid', () => {
    const r = assessMotor(input([reading('voltage', Infinity)], p))
    expect(codes(r)).toEqual(['DATA_INVALID_READING'])
  })

  it('duplicate readings are rejected rather than picking one', () => {
    const r = assessMotor(input([reading('voltage', 50), reading('voltage', 95)], p))
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
    expect(codes(r)).toEqual(['DATA_DUPLICATE_READING'])
  })

  it('an inconsistent limit row is not evaluated and is reported', () => {
    const r = assessMotor(input([reading('voltage', 50)], profile([limit({ lower_limit: 90, upper_limit: 10 })])))
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
    expect(codes(r)).toEqual(['CONFIG_INVALID_THRESHOLDS'])
    expect(r.findings[0].description).toMatch(/inconsistent/)
  })

  it('a readable parameter is still evaluated when another limit row is inconsistent', () => {
    const mixed = profile([full, limit({ parameter_code: 'current', parameter_name: 'Current', unit: 'A', lower_limit: 9, upper_limit: 1 })])
    const r = assessMotor(input([reading('voltage', 95), reading('current', 3, 'A')], mixed))
    expect(r.overallStatus).toBe('FAULT_SUSPECTED')
    expect(codes(r)).toEqual(expect.arrayContaining(['LIMIT_ABOVE_UPPER', 'CONFIG_INVALID_THRESHOLDS']))
  })

  it('a reading with no limit is recorded but not evaluated and does not block NORMAL', () => {
    const r = assessMotor(input([reading('voltage', 50), reading('speed', 1450, 'RPM')], p, { parameterNames: { speed: 'Speed' } }))
    expect(r.overallStatus).toBe('NORMAL')
    const extra = r.findings.find((f) => f.ruleCode === 'DATA_NO_LIMIT_FOR_READING')
    expect(extra).toMatchObject({ parameterCode: 'speed', observedValue: 1450 })
    expect(extra?.description).toMatch(/Speed was measured/)
    expect(r.complete).toBe(false) // flagged, even though the status is NORMAL
  })
})

describe('assessMotor — reference profile problems', () => {
  const readings = [reading('voltage', 95)]

  it('no profile: INSUFFICIENT_DATA, nothing evaluated, no profile recorded', () => {
    const r = assessMotor(input(readings, null))
    expect(r).toMatchObject({ overallStatus: 'INSUFFICIENT_DATA', referenceProfileId: null, referenceProfileVersion: null })
    expect(codes(r)).toEqual(['PROFILE_NOT_AVAILABLE'])
  })

  it.each(['draft', 'retired'] as const)('a %s profile is never used', (status) => {
    const r = assessMotor(input(readings, profile([full], { approval_status: status })))
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
    expect(codes(r)).toEqual(['PROFILE_NOT_APPLICABLE'])
    expect(r.referenceProfileId).toBeNull()
  })

  it('profile for another motor type is not applied', () => {
    const r = assessMotor(input(readings, profile([full], { motor_type: 'synchronous' })))
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
    expect(r.findings[0].description).toMatch(/synchronous/)
  })

  it('unknown applicability (motor lacks a restricted spec) blocks evaluation', () => {
    const p = profile([full], { applicable_specs: { phase_count: 3 } })
    const r = assessMotor(input(readings, p, { motor: { motor_type: 'induction', phase_count: null, rated_frequency: null, rated_voltage: null } }))
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
    expect(codes(r)).toEqual(['PROFILE_APPLICABILITY_UNKNOWN'])
  })

  it('profile not yet effective at the test time is not applied', () => {
    const r = assessMotor(input(readings, profile([full], { effective_from: '2027-01-01T00:00:00Z' })))
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
  })

  it('an approved profile without limits cannot support an assessment', () => {
    const r = assessMotor(input(readings, profile([])))
    expect(codes(r)).toEqual(['PROFILE_NO_LIMITS'])
  })
})

describe('determinism and traceability', () => {
  it('identical inputs give identical output (reproducible)', () => {
    const i = input([reading('voltage', 95), reading('speed', 1, 'RPM')], profile([full]))
    expect(assessMotor(i)).toEqual(assessMotor(structuredClone(i)))
  })

  it('does not depend on reading or limit order', () => {
    const lims = [full, limit({ parameter_code: 'current', parameter_name: 'Current', unit: 'A', upper_limit: 5 })]
    const rs = [reading('voltage', 85), reading('current', 9, 'A')]
    expect(assessMotor(input(rs, profile(lims)))).toEqual(assessMotor(input([...rs].reverse(), profile([...lims].reverse()))))
  })

  it('changing the profile afterwards does not change a result already computed', () => {
    const p = profile([full])
    const before = assessMotor(input([reading('voltage', 85)], p))
    // "Profile changes after assessment": a new version with different limits is a different input, not a mutation.
    const v4 = profile([limit({ upper_limit: 100 })], { id: 'prof-1', version: 4 })
    const after = assessMotor(input([reading('voltage', 85)], v4))
    expect(before.overallStatus).toBe('WARNING')
    expect(before.referenceProfileVersion).toBe(3)
    expect(after.overallStatus).toBe('NORMAL')
    expect(after.referenceProfileVersion).toBe(4)
  })

  it('never mutates its input', () => {
    const i = input([reading('voltage', 85)], profile([full]))
    const copy = structuredClone(i)
    assessMotor(i)
    expect(i).toEqual(copy)
  })
})

describe('isAssessmentComplete', () => {
  it('only INFO/WARNING/CRITICAL limit findings count as complete', () => {
    expect(isAssessmentComplete([{ ruleCode: 'WITHIN_LIMITS' }, { ruleCode: 'LIMIT_ABOVE_UPPER' }])).toBe(true)
    expect(isAssessmentComplete([{ ruleCode: 'DATA_MISSING_READING' }])).toBe(false)
    expect(isAssessmentComplete([{ ruleCode: 'CONFIG_INVALID_THRESHOLDS' }])).toBe(false)
    expect(isAssessmentComplete([{ ruleCode: 'PROFILE_NOT_AVAILABLE' }])).toBe(false)
  })
})

describe('partial coverage (profile covers only some supported parameters)', () => {
  // SYNTHETIC limits and names; not engineering data.
  const names = { voltage: 'Voltage', frequency: 'Frequency', current: 'Current', temperature: 'Temperature', vibration: 'Vibration' }
  const vf = [limit({ parameter_code: 'voltage', parameter_name: 'Voltage', warning_lower: 20, warning_upper: 80, upper_limit: 90 }), limit({ parameter_code: 'frequency', parameter_name: 'Frequency', unit: 'Hz', warning_lower: 20, warning_upper: 80 })]
  const ok = [reading('voltage', 50), reading('frequency', 50, 'Hz')]

  it('keeps the NORMAL status but states the assessment is partial and lists what was not checked', () => {
    const r = assessMotor(input(ok, profile(vf), { parameterNames: names }))
    expect(r.overallStatus).toBe('NORMAL')
    expect(r.summary).toMatch(/^PARTIAL ASSESSMENT/)
    expect(r.summary).toMatch(/not a statement that the motor is healthy/)
    const f = r.findings.find((x) => x.ruleCode === 'COVERAGE_PARTIAL')!
    expect(f).toMatchObject({ severity: 'INFO', parameterCode: null })
    expect(f.description).toMatch(/Current, Temperature, Vibration/)
    expect(r.summary).not.toMatch(/All 2 required/)
  })

  it('a profile covering every supported parameter gives the ordinary complete NORMAL summary and no coverage finding', () => {
    const one = { voltage: 'Voltage' }
    const r = assessMotor(input([reading('voltage', 50)], profile([vf[0]]), { parameterNames: one }))
    expect(r.overallStatus).toBe('NORMAL')
    expect(r.summary).toMatch(/^All 1 required/)
    expect(codes(r)).not.toContain('COVERAGE_PARTIAL')
  })

  it('still reports warnings and critical findings, and does not hide them behind the coverage note', () => {
    const r = assessMotor(input([reading('voltage', 95), reading('frequency', 50, 'Hz')], profile(vf), { parameterNames: names }))
    expect(r.overallStatus).toBe('FAULT_SUSPECTED')
    expect(codes(r)).toContain('COVERAGE_PARTIAL')
  })

  it('does not downgrade INSUFFICIENT_DATA or turn it into NORMAL when a covered reading is missing', () => {
    const r = assessMotor(input([reading('voltage', 50)], profile(vf), { parameterNames: names }))
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA')
  })

  it('coverage findings do not change completeness semantics (statuses unchanged)', () => {
    expect(isAssessmentComplete([{ ruleCode: 'COVERAGE_PARTIAL' }])).toBe(true)
  })
})
