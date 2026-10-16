/**
 * Combined voltage/frequency variation rule (docs/DIAGNOSTIC_RULES.md section 21.11), modelled on
 * ANSI/NEMA MG 1-2016 (Rev. 2018), Part 12, clause 12.44.1(d):
 *
 *   "A combined variation in voltage and frequency of 10 percent (sum of absolute values) of the rated values, provided the
 *    frequency variation does not exceed plus or minus 5 percent of rated frequency."
 *
 * Deviation of a reading from its rated value, in percent of that rated value:  d = (measured - rated) / rated * 100.
 * Sign does not matter (absolute values are summed). The allowance is exceeded when
 *    |dV| + |dF| > max_combined_percent      or      |dF| > max_frequency_percent.
 * "Up to" is inclusive: a deviation exactly on a limit is within it. Floating-point noise (~1e-14 %) is absorbed by EPSILON_PERCENT;
 * measurement rounding by the instrument/operator is NOT corrected - the entered value is what is judged.
 *
 * Every number comes from the profile (applicable_specs.combined_variation); none is hard-coded here. The rated values are the
 * MOTOR's recorded rated voltage and frequency ("rated values" in the clause). Pure: no React, no database.
 */
import type { DiagnosticFinding, EngineReading } from './diagnostics'

export const COMBINED_VARIATION_KEY = 'combined_variation'
/** Operating-condition key (test_sessions.operating_conditions) that records the load at which the readings were taken. */
export const LOAD_CONDITION_KEY = 'load_condition'
/** Limit-condition key (reference_limits.applicable_conditions) that makes the limit valid only at that load condition. */
export const REQUIRED_LOAD_CONDITION_KEY = 'required_load_condition'

export const LOAD_CONDITIONS = ['rated', 'below_rated', 'above_rated', 'no_load', 'unknown'] as const
export type LoadCondition = (typeof LOAD_CONDITIONS)[number]
export const LOAD_CONDITION_LABELS: Record<LoadCondition, string> = {
  rated: 'Rated load (nameplate)',
  below_rated: 'Below rated load',
  above_rated: 'Above rated load',
  no_load: 'No load',
  unknown: 'Not known',
}

/** Beyond floating-point noise only. 1e-9 percent is far below any real instrument resolution. */
export const EPSILON_PERCENT = 1e-9
const exceeds = (value: number, max: number) => value > max + EPSILON_PERCENT

export interface CombinedVariationConfig {
  voltage_parameter: string
  frequency_parameter: string
  /** Units the normalized readings must have (the catalog's canonical units). */
  voltage_unit: string
  frequency_unit: string
  max_combined_percent: number
  max_frequency_percent: number
  /** Load condition under which the clause applies (e.g. "rated"). Not assumed from the test being submitted. */
  required_load_condition: string
  /** Free-text citation shown to the user. */
  source: string
}

export type ParsedCombinedConfig =
  | { kind: 'absent' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'ok'; config: CombinedVariationConfig }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

export function parseCombinedConfig(specs: Record<string, unknown> | null | undefined): ParsedCombinedConfig {
  const raw = specs?.[COMBINED_VARIATION_KEY]
  if (raw === undefined) return { kind: 'absent' }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { kind: 'invalid', reason: 'it is not an object' }
  const c = raw as Record<string, unknown>
  for (const k of ['voltage_parameter', 'frequency_parameter', 'voltage_unit', 'frequency_unit', 'required_load_condition', 'source']) {
    if (!isText(c[k])) return { kind: 'invalid', reason: `"${k}" is missing or not text` }
  }
  for (const k of ['max_combined_percent', 'max_frequency_percent']) {
    if (!isNum(c[k]) || (c[k] as number) <= 0) return { kind: 'invalid', reason: `"${k}" must be a positive number` }
  }
  if (c.voltage_parameter === c.frequency_parameter) return { kind: 'invalid', reason: 'the voltage and frequency parameters must differ' }
  return { kind: 'ok', config: c as unknown as CombinedVariationConfig }
}

export type ConditionState = 'met' | 'not_established' | 'not_met'

/**
 * Whether the required load condition is established by the RECORDED test data. Absent, unknown, unrecognised or
 * non-text values are "not established"; a recognised different value is "not met". Never assumed.
 */
export function loadConditionState(operatingConditions: Record<string, unknown> | null | undefined, required: string): ConditionState {
  const v = operatingConditions?.[LOAD_CONDITION_KEY]
  if (typeof v !== 'string' || v === 'unknown' || !(LOAD_CONDITIONS as readonly string[]).includes(v)) return 'not_established'
  return v === required ? 'met' : 'not_met'
}

export function describeConditionProblem(state: Exclude<ConditionState, 'met'>, required: string, recorded: unknown): string {
  const label = LOAD_CONDITION_LABELS[required as LoadCondition] ?? required
  return state === 'not_established'
    ? `The load condition required by this check ("${label}") is not recorded for this test, so it cannot be established that the check applies.`
    : `The test was recorded at "${LOAD_CONDITION_LABELS[recorded as LoadCondition] ?? String(recorded)}", not at the required "${label}", so this check does not apply to it.`
}

export function describeCombinedRule(c: CombinedVariationConfig): string {
  return (
    `|voltage deviation| + |frequency deviation| must not exceed ${c.max_combined_percent} % of the motor's rated values, and the ` +
    `frequency deviation must not exceed ±${c.max_frequency_percent} %. Applies at: ${LOAD_CONDITION_LABELS[c.required_load_condition as LoadCondition] ?? c.required_load_condition}. Source: ${c.source}`
  )
}

const pct = (n: number) => String(Math.round(n * 1e4) / 1e4)

function finding(ruleCode: string, severity: DiagnosticFinding['severity'], description: string, extra: Partial<DiagnosticFinding> = {}): DiagnosticFinding {
  return {
    parameterCode: null, ruleCode, severity, observedValue: null, observedUnit: null, applicableLimit: null,
    description, possibleCauses: [], recommendedAction: null, ...extra,
  }
}

export interface CombinedInput {
  config: CombinedVariationConfig
  motor: { rated_voltage: number | null; rated_frequency: number | null }
  readings: EngineReading[]
  operatingConditions: Record<string, unknown> | null | undefined
  /** e.g. "profile \"X\" v1", for messages. */
  label: string
  /** Recommended action attached to a violation (kept in diagnostics.ts to avoid duplicating the wording). */
  inspectionAction: string
}

export interface CombinedOutcome {
  findings: DiagnosticFinding[]
  /** 1 when the rule could not be (fully) assessed; this makes the assessment incomplete. */
  unevaluable: number
}

export function evaluateCombinedVariation(i: CombinedInput): CombinedOutcome {
  const { config: c } = i
  const NOT_EVALUABLE = 'DATA_COMBINED_RULE_NOT_EVALUABLE'
  const problems: string[] = []

  const reading = (code: string, unit: string, name: string): number | null => {
    const rows = i.readings.filter((r) => r.parameter_code === code)
    if (rows.length === 0) return problems.push(`${name} was not measured.`), null
    if (rows.length > 1) return problems.push(`${name} has ${rows.length} readings; only one is allowed.`), null
    const r = rows[0]
    if (!isNum(r.normalized_value) || !r.normalized_unit) return problems.push(`The ${name.toLowerCase()} reading has no valid normalized value.`), null
    if (r.normalized_unit !== unit) return problems.push(`The ${name.toLowerCase()} reading is in ${r.normalized_unit}, not ${unit}; no conversion is attempted.`), null
    return r.normalized_value
  }
  const v = reading(c.voltage_parameter, c.voltage_unit, 'Voltage')
  const f = reading(c.frequency_parameter, c.frequency_unit, 'Frequency')
  const vr = i.motor.rated_voltage
  const fr = i.motor.rated_frequency
  if (!isNum(vr) || vr <= 0) problems.push("The motor's rated voltage is not recorded.")
  if (!isNum(fr) || fr <= 0) problems.push("The motor's rated frequency is not recorded.")

  const state = loadConditionState(i.operatingConditions, c.required_load_condition)
  const out: DiagnosticFinding[] = []
  let unevaluable = 0

  if (state !== 'met') {
    unevaluable = 1
    out.push(
      finding(
        state === 'not_established' ? 'DATA_CONDITION_NOT_ESTABLISHED' : 'DATA_CONDITION_NOT_MET',
        'INFO',
        `Combined voltage/frequency check not assessed. ${describeConditionProblem(state, c.required_load_condition, i.operatingConditions?.[LOAD_CONDITION_KEY])}`,
      ),
    )
  }
  if (v === null || f === null || !isNum(vr) || vr <= 0 || !isNum(fr) || fr <= 0) {
    unevaluable = 1
    out.push(finding(NOT_EVALUABLE, 'INFO', `Combined voltage/frequency check not assessed: ${problems.join(' ')}`))
    return { findings: out, unevaluable }
  }

  const dv = ((v - vr) / vr) * 100
  const df = ((f - fr) / fr) * 100
  const sum = Math.abs(dv) + Math.abs(df)
  const dev = `voltage ${v} ${c.voltage_unit} (${pct(dv)} % of rated ${vr}), frequency ${f} ${c.frequency_unit} (${pct(df)} % of rated ${fr})`
  const caveat =
    state === 'met'
      ? ''
      : ' The required load condition is not established, so it is not confirmed that this tolerance applies; the deviation is reported so it is not hidden.'
  const nature = ' This is a supply-tolerance check, not a fault diagnosis.'
  const action = i.inspectionAction

  const sumBad = exceeds(sum, c.max_combined_percent)
  const freqBad = exceeds(Math.abs(df), c.max_frequency_percent)
  if (sumBad) {
    out.push(finding('COMBINED_VF_SUM_EXCEEDED', 'WARNING',
      `The combined voltage and frequency deviation is ${pct(sum)} % (sum of absolute values), above the ${c.max_combined_percent} % allowance of ${i.label}: ${dev}.${nature}${caveat}`,
      { observedValue: sum, observedUnit: '%', applicableLimit: c.max_combined_percent, recommendedAction: action }))
  }
  if (freqBad) {
    out.push(finding('COMBINED_VF_FREQUENCY_EXCEEDED', 'WARNING',
      `The frequency deviation is ${pct(Math.abs(df))} %, above the ±${c.max_frequency_percent} % condition attached to the combined allowance of ${i.label}: ${dev}.${nature}${caveat}`,
      { observedValue: Math.abs(df), observedUnit: '%', applicableLimit: c.max_frequency_percent, recommendedAction: action }))
  }
  if (!sumBad && !freqBad && state === 'met') {
    out.push(finding('COMBINED_VF_WITHIN', 'INFO',
      `The combined voltage and frequency deviation is ${pct(sum)} % (allowance ${c.max_combined_percent} %) and the frequency deviation ${pct(Math.abs(df))} % (allowance ±${c.max_frequency_percent} %): ${dev}. ` +
      'This checks the supply tolerance only; it does not demonstrate conformity of the motor with the standard or establish its health.',
      { observedValue: sum, observedUnit: '%', applicableLimit: c.max_combined_percent }))
  }
  return { findings: out, unevaluable }
}
