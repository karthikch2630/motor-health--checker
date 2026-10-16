import { describe, expect, it } from 'vitest'
import { coverageOf, nextActions, type GuidanceFinding } from './assessmentGuidance'

const f = (rule_code: string, parameter_code: string | null = null, severity: GuidanceFinding['severity'] = 'INFO'): GuidanceFinding => ({ rule_code, parameter_code, severity })
const catalog = [
  { code: 'voltage', name: 'Voltage' }, { code: 'frequency', name: 'Frequency' },
  { code: 'current', name: 'Current' }, { code: 'vibration', name: 'Vibration' },
]

describe('coverageOf', () => {
  it('voltage/frequency-only profile: those are assessed, the rest are not, with the reason', () => {
    const c = coverageOf([f('WITHIN_LIMITS', 'voltage'), f('WITHIN_LIMITS', 'frequency'), f('COVERAGE_PARTIAL')], catalog, true)
    expect(c.assessed.map((x) => x.code)).toEqual(['voltage', 'frequency'])
    expect(c.notAssessed.map((x) => x.code)).toEqual(['current', 'vibration'])
    expect(c.notAssessed[0].reason).toMatch(/no approved limit/)
    expect(c.sentence).toBe('Assessed: Voltage, Frequency. Not assessed: Current, Vibration.')
  })
  it('no profile applied: nothing assessed, reason says so', () => {
    const c = coverageOf([f('PROFILE_NOT_AVAILABLE')], catalog, false)
    expect(c.assessed).toEqual([])
    expect(c.sentence).toBe('Nothing was assessed.')
    expect(c.notAssessed.every((x) => /No compatible approved reference profile/.test(x.reason))).toBe(true)
  })
  it('a missing reading is reported as such; a check at an unestablished load stays unassessed even if a deviation was shown', () => {
    const c = coverageOf(
      [f('DATA_MISSING_READING', 'voltage'), f('WARNING_BELOW_LOWER', 'frequency', 'WARNING'), f('DATA_CONDITION_NOT_ESTABLISHED', 'frequency')],
      catalog.slice(0, 2), true,
    )
    expect(c.assessed).toEqual([])
    expect(c.notAssessed.find((x) => x.code === 'voltage')?.reason).toBe('No reading was recorded.')
    expect(c.notAssessed.find((x) => x.code === 'frequency')?.reason).toMatch(/load condition/)
  })
  it('a measured parameter the profile has no limit for is explained as "no approved limit", not as an unusable reading', () => {
    const c = coverageOf([f('DATA_NO_LIMIT_FOR_READING', 'current'), f('WITHIN_LIMITS', 'voltage')], catalog.slice(0, 3), true)
    expect(c.notAssessed.find((x) => x.code === 'current')?.reason).toMatch(/recorded, but the applied profile has no approved limit/)
    expect(c.notAssessed.find((x) => x.code === 'current')?.reason).not.toMatch(/could not be used/)
  })
  it('a warning counts as assessed', () => {
    expect(coverageOf([f('WARNING_ABOVE_UPPER', 'voltage', 'WARNING')], catalog.slice(0, 1), true).assessed).toHaveLength(1)
  })
})

describe('nextActions', () => {
  it('unknown supply gets the actionable verify-the-nameplate message', () => {
    expect(nextActions([f('PROFILE_APPLICABILITY_UNKNOWN')])[0]).toMatch(/Supply type not verified\. Confirm the motor nameplate/)
  })
  it('missing profile, missing reading and load condition each get their own action; duplicates collapse', () => {
    const a = nextActions([f('PROFILE_NOT_AVAILABLE'), f('DATA_MISSING_READING', 'voltage'), f('DATA_MISSING_READING', 'current'), f('DATA_CONDITION_NOT_ESTABLISHED')])
    expect(a).toHaveLength(3)
    expect(a.join(' ')).toMatch(/Record the missing measurement/)
    expect(a.join(' ')).toMatch(/only if the motor really was at rated load/)
  })
  it('a supply-tolerance warning never says the motor is damaged', () => {
    const a = nextActions([f('COMBINED_VF_SUM_EXCEEDED', null, 'WARNING')]).join(' ')
    expect(a).toMatch(/supply voltage and frequency/)
    expect(a).toMatch(/not evidence that the motor is damaged/)
  })
  it('a clean result has no actions', () => {
    expect(nextActions([f('WITHIN_LIMITS', 'voltage')])).toEqual([])
  })
})
