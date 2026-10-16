/**
 * Plain-language guidance derived from a STORED assessment: what was and was not assessed, and what to do next.
 * Display only. It never changes or recomputes a stored status, and it adds no engineering rule.
 */

export interface GuidanceFinding {
  rule_code: string
  parameter_code: string | null
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  finding_description?: string
}

const UNEVALUATED = /^(DATA_|CONFIG_|PROFILE_)/
const isEvaluated = (f: GuidanceFinding) => !UNEVALUATED.test(f.rule_code) && f.rule_code !== 'COVERAGE_PARTIAL' && !f.rule_code.startsWith('COMBINED_VF_WITHIN')

export interface CoverageItem {
  code: string
  name: string
  /** Why it was not assessed (empty for assessed parameters). */
  reason: string
}

export interface Coverage {
  assessed: CoverageItem[]
  notAssessed: CoverageItem[]
  /** One sentence for the top of the result, e.g. "Assessed: Voltage, Frequency. Not assessed: Current, ...". */
  sentence: string
}

/** Which catalog parameters the stored findings actually evaluated, and why the others were not. */
export function coverageOf(
  findings: GuidanceFinding[],
  catalog: { code: string; name: string }[],
  profileApplied: boolean,
): Coverage {
  const assessed: CoverageItem[] = []
  const notAssessed: CoverageItem[] = []
  for (const p of catalog) {
    const own = findings.filter((f) => f.parameter_code === p.code)
    // A deviation reported at an unestablished load condition is shown, but the check itself stays unassessed.
    const conditionUnmet = own.some((f) => f.rule_code === 'DATA_CONDITION_NOT_ESTABLISHED' || f.rule_code === 'DATA_CONDITION_NOT_MET')
    if (!conditionUnmet && own.some(isEvaluated)) {
      assessed.push({ code: p.code, name: p.name, reason: '' })
      continue
    }
    let reason: string
    if (!profileApplied) reason = 'No compatible approved reference profile was applied.'
    else if (own.some((f) => f.rule_code === 'DATA_CONDITION_NOT_ESTABLISHED')) reason = 'The required load condition is not recorded for this test.'
    else if (own.some((f) => f.rule_code === 'DATA_CONDITION_NOT_MET')) reason = 'The test was not recorded at the load condition this check requires.'
    else if (own.some((f) => f.rule_code === 'DATA_MISSING_READING')) reason = 'No reading was recorded.'
    else if (own.some((f) => f.rule_code.startsWith('DATA_') || f.rule_code.startsWith('CONFIG_'))) reason = 'The reading or the limit could not be used (see findings).'
    else reason = 'The applied profile has no approved limit for it.'
    notAssessed.push({ code: p.code, name: p.name, reason })
  }
  const list = (xs: CoverageItem[]) => xs.map((x) => x.name).join(', ')
  const sentence =
    assessed.length === 0
      ? 'Nothing was assessed.'
      : `Assessed: ${list(assessed)}.` + (notAssessed.length > 0 ? ` Not assessed: ${list(notAssessed)}.` : '')
  return { assessed, notAssessed, sentence }
}

const ACTIONS: [RegExp, string][] = [
  [/^PROFILE_NOT_AVAILABLE$/, 'No approved, compatible reference profile was applied. Open Reference Data → "Profile availability per motor" to see why each profile does not apply.'],
  [/^PROFILE_APPLICABILITY_UNKNOWN$/, 'Supply type not verified. Confirm the motor nameplate before applying this reference profile, then record it on the motor page.'],
  [/^PROFILE_NOT_APPLICABLE$/, 'The selected profile does not apply to this motor (type, ratings, supply, approval status or dates). See the finding for the exact reason.'],
  [/^PROFILE_NO_LIMITS$/, 'The selected profile has no limits. Add limits from a documented source in Reference Data.'],
  [/^DATA_MISSING_READING$/, 'Record the missing measurement in a new test and assess it.'],
  [/^DATA_DUPLICATE_READING$/, 'Record only one reading per parameter in a test.'],
  [/^DATA_INVALID_READING$|^DATA_UNIT_MISMATCH$/, 'Re-enter the reading with a valid number and a supported unit.'],
  [/^DATA_CONDITION_NOT_ESTABLISHED$/, 'Record "Load during the test" on a new test, but only if the motor really was at rated load. Do not select it just to enable the check.'],
  [/^DATA_CONDITION_NOT_MET$/, 'This check applies only at the load condition the profile requires; repeat the measurement under that condition if it is relevant.'],
  [/^DATA_COMBINED_RULE_NOT_EVALUABLE$/, 'Record valid voltage and frequency readings, and make sure the motor has its rated voltage and frequency recorded.'],
  [/^CONFIG_/, 'A reference limit or rule is inconsistent. Review the profile in Reference Data.'],
  [/^COMBINED_VF_|^WARNING_BELOW_LOWER$|^WARNING_ABOVE_UPPER$/, 'Check the supply voltage and frequency at the motor terminals and verify the instrument and measurement point. This is a supply-tolerance warning, not evidence that the motor is damaged.'],
  [/^LIMIT_(BELOW_LOWER|ABOVE_UPPER)$/, 'An approved limit was crossed. Verify the measurement, then have a qualified person inspect the motor.'],
]

/** Distinct, ordered next actions for the stored findings (most relevant first). */
export function nextActions(findings: GuidanceFinding[]): string[] {
  const out: string[] = []
  for (const [re, text] of ACTIONS) {
    if (findings.some((f) => re.test(f.rule_code)) && !out.includes(text)) out.push(text)
  }
  return out
}
