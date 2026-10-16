/**
 * Which reference profiles could support an assessment of each motor. Pure, built on checkProfileCompatibility;
 * it adds no rules of its own and decides nothing about limits.
 */
import { checkProfileCompatibility, type MatchResult } from './profileMatch'
import type { Motor } from '../types/motor'
import type { ReferenceProfileWithCount } from '../types/reference'

export type MotorForCoverage = Pick<Motor, 'id' | 'motor_type' | 'phase_count' | 'rated_frequency' | 'rated_voltage'> & { supply_type?: Motor['supply_type'] }

export interface ProfileMatch {
  profile: ReferenceProfileWithCount
  match: MatchResult
}

export interface MotorCoverage {
  /** Approved, compatible and with at least one limit: the profiles an assessment can use. */
  usable: ProfileMatch[]
  /** Every other profile of the same motor type, with the reasons it cannot be used. */
  unusable: ProfileMatch[]
}

export function motorCoverage(
  motor: MotorForCoverage,
  profiles: ReferenceProfileWithCount[],
  at: Date,
): MotorCoverage {
  const usable: ProfileMatch[] = []
  const unusable: ProfileMatch[] = []
  for (const profile of profiles) {
    const match = checkProfileCompatibility(profile, motor, at)
    if (match.status === 'compatible' && profile.limit_count > 0) usable.push({ profile, match })
    else {
      const reasons = match.status === 'compatible' ? ['The profile has no limits.'] : match.reasons
      unusable.push({ profile, match: { status: match.status === 'compatible' ? 'incompatible' : match.status, reasons } })
    }
  }
  return { usable, unusable }
}
