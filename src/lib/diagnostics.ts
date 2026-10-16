/**
 * Diagnostic engine (docs/DIAGNOSTIC_RULES.md section 21, rule specification 1.0.0).
 *
 * Pure and deterministic: the same readings, motor, profile and test time always give the same result.
 * No React, no database access, no hard-coded engineering values; every limit comes from the profile that is
 * passed in. Missing data is never treated as zero or as healthy.
 */
import {
  describeConditionProblem,
  evaluateCombinedVariation,
  loadConditionState,
  LOAD_CONDITION_KEY,
  parseCombinedConfig,
  REQUIRED_LOAD_CONDITION_KEY,
} from './combinedVariation'
import { checkProfileCompatibility } from './profileMatch'
import type { AssessmentStatus, FindingSeverity } from '../types'
import type { Motor } from '../types/motor'
import type { ReferenceLimit, ReferenceProfile } from '../types/reference'
import type { SessionStatus } from '../types/test'

export const DIAGNOSTIC_ENGINE_VERSION = '1.2.0'

/** Generic action: it makes no claim about the cause of a deviation. */
export const GENERIC_INSPECTION_ACTION =
  'Verify the measurement (instrument, method, unit and location). Then have a qualified person inspect the motor ' +
  'according to your site procedures.'

// ---------------------------------------------------------------- input / output types

export type EngineLimit = Pick<
  ReferenceLimit,
  'parameter_code' | 'parameter_name' | 'unit' | 'lower_limit' | 'upper_limit' | 'warning_lower' | 'warning_upper'
> & {
  /** Only the key `required_load_condition` is enforced (21.11); other keys are descriptive. */
  applicable_conditions?: Record<string, unknown>
}

export type EngineProfile = Pick<
  ReferenceProfile,
  'id' | 'name' | 'version' | 'approval_status' | 'motor_type' | 'applicable_specs' | 'effective_from' | 'effective_to'
> & { limits: EngineLimit[] }

export interface EngineReading {
  parameter_code: string
  measured_value: number
  measured_unit: string
  normalized_value: number | null
  normalized_unit: string | null
}

export interface DiagnosticInput {
  sessionStatus: SessionStatus
  testTime: Date
  motor: Pick<Motor, 'motor_type' | 'phase_count' | 'rated_frequency' | 'rated_voltage'> & { supply_type?: Motor['supply_type'] }
  readings: EngineReading[]
  /** The single profile chosen for this assessment, or null if none is available. */
  profile: EngineProfile | null
  /** test_sessions.operating_conditions. The load condition is read from `load_condition`; absent means "not established". */
  operatingConditions?: Record<string, unknown>
  /** Display names for parameters that have no limit row (optional). */
  parameterNames?: Record<string, string>
}

export interface DiagnosticFinding {
  parameterCode: string | null
  ruleCode: string
  severity: FindingSeverity
  observedValue: number | null
  observedUnit: string | null
  applicableLimit: number | null
  description: string
  possibleCauses: string[]
  recommendedAction: string | null
}

export interface DiagnosticResult {
  overallStatus: AssessmentStatus
  summary: string
  findings: DiagnosticFinding[]
  /** Required parameters (those with limits) that have no usable reading. */
  missingParameters: string[]
  /** False when something that should have been checked could not be (see findings). */
  complete: boolean
  /** Null when no usable profile was applied. */
  referenceProfileId: string | null
  referenceProfileVersion: number | null
  diagnosticEngineVersion: string
}

// ---------------------------------------------------------------- helpers

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Rule-code prefixes that mean "something could not be checked". */
/** INFO finding: the applied profile has no limits for some supported parameters (they were not checked). */
export const COVERAGE_PARTIAL = 'COVERAGE_PARTIAL'

const INCOMPLETE_PREFIXES = ['DATA_', 'CONFIG_', 'PROFILE_']

export function isAssessmentComplete(findings: { ruleCode: string }[]): boolean {
  return !findings.some((f) => INCOMPLETE_PREFIXES.some((p) => f.ruleCode.startsWith(p)))
}

const infoFinding = (
  parameterCode: string | null,
  ruleCode: string,
  description: string,
  extra: Partial<DiagnosticFinding> = {},
): DiagnosticFinding => ({
  parameterCode,
  ruleCode,
  severity: 'INFO',
  observedValue: null,
  observedUnit: null,
  applicableLimit: null,
  description,
  possibleCauses: [],
  recommendedAction: null,
  ...extra,
})

/**
 * Checks threshold consistency (21.1): at least one value configured, all finite, and the configured values
 * non-decreasing in the order L, WL, WU, U. Returns a problem description or null.
 */
export function validateThresholds(limit: EngineLimit): string | null {
  const ordered: [string, number | null][] = [
    ['lower limit', limit.lower_limit],
    ['lower warning threshold', limit.warning_lower],
    ['upper warning threshold', limit.warning_upper],
    ['upper limit', limit.upper_limit],
  ]
  for (const [name, v] of ordered) {
    if (v !== null && !isNum(v)) return `the ${name} is not a finite number`
  }
  const set = ordered.filter((o): o is [string, number] => o[1] !== null)
  if (set.length === 0) return 'no limit or warning threshold is configured'
  for (let i = 1; i < set.length; i++) {
    if (set[i][1] < set[i - 1][1]) {
      return `the ${set[i][0]} (${set[i][1]}) is below the ${set[i - 1][0]} (${set[i - 1][1]}); expected lower limit ≤ lower warning ≤ upper warning ≤ upper limit`
    }
  }
  return null
}

function describeBoundaries(limit: EngineLimit): string {
  const parts: string[] = []
  if (limit.lower_limit !== null) parts.push(`lower limit ${limit.lower_limit}`)
  if (limit.warning_lower !== null) parts.push(`lower warning ${limit.warning_lower}`)
  if (limit.warning_upper !== null) parts.push(`upper warning ${limit.warning_upper}`)
  if (limit.upper_limit !== null) parts.push(`upper limit ${limit.upper_limit}`)
  return parts.join(', ')
}

/** Evaluates one valid value against one valid limit (21.1). Boundaries are inclusive. */
export function evaluateLimit(
  value: number,
  unit: string,
  limit: EngineLimit,
  profileLabel: string,
): DiagnosticFinding {
  const name = limit.parameter_name
  const base = { parameterCode: limit.parameter_code, observedValue: value, observedUnit: unit }
  const where = `(${profileLabel})`
  const lim = (n: number) => `${n} ${limit.unit}`
  const observed = `The measured ${name.toLowerCase()} is ${value} ${unit}`
  const note = ' This is an observed abnormal measurement, not a confirmed fault.'

  const critical = (rule: string, side: string, boundary: number): DiagnosticFinding => ({
    ...infoFinding(limit.parameter_code, rule, `${observed}, ${side} the approved ${side === 'below' ? 'lower' : 'upper'} limit of ${lim(boundary)} ${where}.${note}`),
    ...base,
    severity: 'CRITICAL',
    applicableLimit: boundary,
    recommendedAction: GENERIC_INSPECTION_ACTION,
  })
  const warning = (rule: string, side: string, boundary: number): DiagnosticFinding => ({
    ...infoFinding(limit.parameter_code, rule, `${observed}, ${side} the ${side === 'below' ? 'lower' : 'upper'} warning threshold of ${lim(boundary)} ${where}; it requires attention.`),
    ...base,
    severity: 'WARNING',
    applicableLimit: boundary,
    recommendedAction: GENERIC_INSPECTION_ACTION,
  })

  if (limit.lower_limit !== null && value < limit.lower_limit) return critical('LIMIT_BELOW_LOWER', 'below', limit.lower_limit)
  if (limit.upper_limit !== null && value > limit.upper_limit) return critical('LIMIT_ABOVE_UPPER', 'above', limit.upper_limit)
  if (limit.warning_lower !== null && value < limit.warning_lower) return warning('WARNING_BELOW_LOWER', 'below', limit.warning_lower)
  if (limit.warning_upper !== null && value > limit.warning_upper) return warning('WARNING_ABOVE_UPPER', 'above', limit.warning_upper)

  return {
    ...infoFinding(
      limit.parameter_code,
      'WITHIN_LIMITS',
      `${observed}, within the configured boundaries in ${limit.unit}: ${describeBoundaries(limit)} ${where}.`,
    ),
    ...base,
  }
}

function result(
  overallStatus: AssessmentStatus,
  summary: string,
  findings: DiagnosticFinding[],
  missingParameters: string[],
  profile: EngineProfile | null,
): DiagnosticResult {
  return {
    overallStatus,
    summary,
    findings,
    missingParameters,
    complete: isAssessmentComplete(findings),
    referenceProfileId: profile?.id ?? null,
    referenceProfileVersion: profile?.version ?? null,
    diagnosticEngineVersion: DIAGNOSTIC_ENGINE_VERSION,
  }
}

// ---------------------------------------------------------------- main entry point

export function assessMotor(input: DiagnosticInput): DiagnosticResult {
  // 21.5 row 1: a draft is not assessed.
  if (input.sessionStatus === 'draft') {
    return result('NOT_ASSESSED', 'The test is still a draft, so no assessment was performed.', [], [], null)
  }

  // 21.3: only an approved, applicable profile may be used.
  const profile = input.profile
  if (profile === null) {
    return result(
      'INSUFFICIENT_DATA',
      'No reference profile was available, so the readings could not be compared with approved limits.',
      [infoFinding(null, 'PROFILE_NOT_AVAILABLE', 'No approved reference profile was selected for this assessment.')],
      [],
      null,
    )
  }
  const match = checkProfileCompatibility(profile, input.motor, input.testTime)
  if (match.status !== 'compatible') {
    const unknown = match.status === 'unknown'
    return result(
      'INSUFFICIENT_DATA',
      unknown
        ? `Applicability of reference profile "${profile.name}" v${profile.version} could not be established, so no limits were applied.`
        : `Reference profile "${profile.name}" v${profile.version} does not apply to this motor, so no limits were applied.`,
      [
        infoFinding(
          null,
          unknown ? 'PROFILE_APPLICABILITY_UNKNOWN' : 'PROFILE_NOT_APPLICABLE',
          `${unknown ? 'Applicability could not be established' : 'The profile is not applicable'}: ${match.reasons.join(' ')}`,
        ),
      ],
      [],
      null,
    )
  }

  const label = `profile "${profile.name}" v${profile.version}`
  if (profile.limits.length === 0) {
    return result(
      'INSUFFICIENT_DATA',
      `Reference profile "${profile.name}" v${profile.version} has no limits, so nothing could be evaluated.`,
      [infoFinding(null, 'PROFILE_NO_LIMITS', 'The selected profile contains no limits.')],
      [],
      profile,
    )
  }
  if (input.readings.length === 0) {
    return result(
      'INSUFFICIENT_DATA',
      'The test contains no readings, so nothing could be evaluated.',
      [infoFinding(null, 'DATA_MISSING_READING', 'No readings were recorded for this test.')],
      profile.limits.map((l) => l.parameter_code),
      profile,
    )
  }

  const findings: DiagnosticFinding[] = []
  const missing: string[] = []
  const names = { ...input.parameterNames }
  let unevaluable = 0

  // Required parameters = parameters with a limit (21.2). Stable, sorted order for reproducible output.
  const limits = [...profile.limits].sort((a, b) => a.parameter_code.localeCompare(b.parameter_code))
  for (const limit of limits) {
    const code = limit.parameter_code
    const name = limit.parameter_name
    const rows = input.readings.filter((r) => r.parameter_code === code)

    const skip = (rule: string, text: string, extra: Partial<DiagnosticFinding> = {}) => {
      unevaluable++
      findings.push(infoFinding(code, rule, text, extra))
    }

    if (rows.length === 0) {
      missing.push(code)
      skip('DATA_MISSING_READING', `${name} was not measured, so it could not be checked against the profile.`)
      continue
    }
    if (rows.length > 1) {
      skip('DATA_DUPLICATE_READING', `${name} has ${rows.length} readings in this test; only one is allowed, so it was not evaluated.`)
      continue
    }
    const reading = rows[0]
    if (!isNum(reading.normalized_value) || !reading.normalized_unit) {
      skip('DATA_INVALID_READING', `The ${name.toLowerCase()} reading has no valid normalized value, so it was not evaluated.`)
      continue
    }
    if (reading.normalized_unit !== limit.unit) {
      skip(
        'DATA_UNIT_MISMATCH',
        `The ${name.toLowerCase()} reading is in ${reading.normalized_unit} but the profile limit is in ${limit.unit}; no conversion is attempted, so it was not evaluated.`,
        { observedValue: reading.normalized_value, observedUnit: reading.normalized_unit },
      )
      continue
    }
    const problem = validateThresholds(limit)
    if (problem) {
      skip('CONFIG_INVALID_THRESHOLDS', `The ${name.toLowerCase()} limit in ${label} is inconsistent (${problem}), so it was not evaluated.`)
      continue
    }
    const evaluated = evaluateLimit(reading.normalized_value, reading.normalized_unit, limit, label)
    const required = limit.applicable_conditions?.[REQUIRED_LOAD_CONDITION_KEY]
    const state = typeof required === 'string' ? loadConditionState(input.operatingConditions, required) : 'met'
    if (state === 'met' || typeof required !== 'string') {
      findings.push(evaluated)
      continue
    }
    // 21.11: the limit applies only under a load condition the recorded data does not establish. Never pass it silently;
    // a numeric deviation is still reported (so it cannot be hidden), but the check itself is unassessed.
    if (evaluated.severity !== 'INFO') {
      findings.push({
        ...evaluated,
        description: `${evaluated.description} The load condition required by this limit is not established for this test, so it is not confirmed that the limit applies; the deviation is reported so it is not hidden.`,
      })
    }
    skip(
      state === 'not_established' ? 'DATA_CONDITION_NOT_ESTABLISHED' : 'DATA_CONDITION_NOT_MET',
      `${name} was not assessed against ${label}. ${describeConditionProblem(state, required, input.operatingConditions?.[LOAD_CONDITION_KEY])}`,
      { observedValue: reading.normalized_value, observedUnit: reading.normalized_unit },
    )
  }

  // 21.11: explicit combined voltage/frequency rule, when the profile defines one.
  const combined = parseCombinedConfig(profile.applicable_specs)
  if (combined.kind === 'invalid') {
    unevaluable++
    findings.push(infoFinding(null, 'CONFIG_INVALID_COMBINED_RULE', `The combined voltage/frequency rule of ${label} is inconsistent (${combined.reason}), so it was not evaluated.`))
  } else if (combined.kind === 'ok') {
    const outcome = evaluateCombinedVariation({
      config: combined.config, motor: input.motor, readings: input.readings, operatingConditions: input.operatingConditions,
      label, inspectionAction: GENERIC_INSPECTION_ACTION,
    })
    findings.push(...outcome.findings)
    unevaluable += outcome.unevaluable
  }

  // 21.2: readings without a limit are recorded but not evaluated.
  const limited = new Set(limits.map((l) => l.parameter_code))
  const seen = new Set<string>()
  for (const r of input.readings) {
    if (limited.has(r.parameter_code) || seen.has(r.parameter_code)) continue
    seen.add(r.parameter_code)
    const name = names[r.parameter_code] ?? r.parameter_code
    findings.push(
      infoFinding(r.parameter_code, 'DATA_NO_LIMIT_FOR_READING', `${name} was measured, but ${label} has no limit for it, so it was not evaluated.`, {
        observedValue: r.normalized_value,
        observedUnit: r.normalized_unit,
      }),
    )
  }

  // 21.10: parameters of the catalog that this profile does not cover were NOT checked. Say so explicitly.
  const notCovered = Object.keys(names).filter((c) => !limited.has(c)).sort()
  if (notCovered.length > 0) {
    findings.push(
      infoFinding(
        null,
        COVERAGE_PARTIAL,
        `${label} has no limits for: ${notCovered.map((c) => names[c]).join(', ')}. These were not checked, so this result says nothing about them.`,
      ),
    )
  }

  // Keep the findings in a stable order: most severe first, then by parameter.
  const rank: Record<FindingSeverity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 }
  findings.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.parameterCode ?? '').localeCompare(b.parameterCode ?? ''))

  const critical = findings.filter((f) => f.severity === 'CRITICAL').length
  const warnings = findings.filter((f) => f.severity === 'WARNING').length
  const incomplete = unevaluable > 0 ? ` The assessment is incomplete: ${unevaluable} required parameter(s) could not be evaluated (see findings).` : ''

  if (critical > 0) {
    return result(
      'FAULT_SUSPECTED',
      `${critical} measurement(s) are beyond an approved limit of ${label}; a fault is suspected and inspection is recommended. This is not a confirmed diagnosis.${incomplete}`,
      findings, missing, profile,
    )
  }
  if (warnings > 0) {
    return result(
      'WARNING',
      `${warnings} measurement(s) are beyond a warning threshold of ${label} and require attention.${incomplete}`,
      findings, missing, profile,
    )
  }
  if (unevaluable > 0) {
    return result(
      'INSUFFICIENT_DATA',
      `${unevaluable} required parameter(s) could not be evaluated against ${label}, so the motor cannot be assessed as normal. No abnormality was found in the parameters that could be evaluated.`,
      findings, missing, profile,
    )
  }
  return result(
    'NORMAL',
    notCovered.length === 0
      ? `All ${limits.length} required parameter(s) were evaluated against ${label} and are within the configured boundaries. No configured abnormality was found.`
      : `PARTIAL ASSESSMENT: the ${limits.length} parameter(s) covered by ${label} are within the configured boundaries, but ${notCovered.length} supported parameter(s) (${notCovered.map((c) => names[c]).join(', ')}) have no limits and were not checked. This is not a statement that the motor is healthy.`,
    findings, missing, profile,
  )
}
