/**
 * Reference profile compatibility, using ONLY metadata that exists on the profile and the motor:
 * approval status, effective dates, motor type text, and the optional applicable_specs keys
 * (phase_count, rated_frequency_hz, rated_voltage_min_v / _max_v, supply_type).
 *
 * Results:
 *  - compatible:   every check that the profile defines passed.
 *  - unknown:      nothing contradicts the profile, but at least one defined restriction could not be checked
 *                  (the motor lacks that specification). Applicability is NOT established.
 *  - incompatible: a defined restriction is violated.
 * This is selection support only. Which profile an assessment uses is decided and recorded in a later phase.
 */
import type { Motor } from '../types/motor'
import type { ReferenceProfile } from '../types/reference'

export type Compatibility = 'compatible' | 'unknown' | 'incompatible'

export interface MatchResult {
  status: Compatibility
  /** Why the profile is incompatible or why applicability could not be established. */
  reasons: string[]
}

const norm = (s: string) => s.trim().toLowerCase()
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function checkProfileCompatibility(
  profile: Pick<
    ReferenceProfile,
    'approval_status' | 'motor_type' | 'applicable_specs' | 'effective_from' | 'effective_to'
  >,
  motor: Pick<Motor, 'motor_type' | 'phase_count' | 'rated_frequency' | 'rated_voltage'> & { supply_type?: Motor['supply_type'] },
  testTime: Date,
): MatchResult {
  const incompatible: string[] = []
  const unknown: string[] = []

  if (profile.approval_status !== 'approved') incompatible.push('The profile is not approved.')

  if (norm(profile.motor_type) !== norm(motor.motor_type)) {
    incompatible.push(`The profile is for motor type "${profile.motor_type}", not "${motor.motor_type}".`)
  }

  const t = testTime.getTime()
  if (profile.effective_from && new Date(profile.effective_from).getTime() > t) {
    incompatible.push('The profile is not yet effective at the test date.')
  }
  if (profile.effective_to && new Date(profile.effective_to).getTime() < t) {
    incompatible.push('The profile was no longer effective at the test date.')
  }

  const specs = profile.applicable_specs ?? {}

  const phases = num(specs.phase_count)
  if (phases !== null) {
    if (motor.phase_count === null) unknown.push('The motor has no number of phases recorded.')
    else if (motor.phase_count !== phases) incompatible.push(`The profile is for ${phases}-phase motors; this motor has ${motor.phase_count}.`)
  }

  const freq = num(specs.rated_frequency_hz)
  if (freq !== null) {
    if (motor.rated_frequency === null) unknown.push('The motor has no rated frequency recorded.')
    else if (motor.rated_frequency !== freq) incompatible.push(`The profile is for ${freq} Hz motors; this motor is rated ${motor.rated_frequency} Hz.`)
  }

  const supply = specs.supply_type
  if (supply === 'line' || supply === 'inverter') {
    if (!motor.supply_type) unknown.push("The motor's supply (line or inverter-fed) is not recorded, so it cannot be established that this profile applies.")
    else if (motor.supply_type !== supply) {
      incompatible.push(`The profile is for ${supply === 'line' ? 'fixed-frequency line supply' : 'inverter-fed'} motors; this motor is ${motor.supply_type === 'line' ? 'on a line supply' : 'inverter-fed'}.`)
    }
  }

  const vMin = num(specs.rated_voltage_min_v)
  const vMax = num(specs.rated_voltage_max_v)
  if (vMin !== null || vMax !== null) {
    if (motor.rated_voltage === null) unknown.push('The motor has no rated voltage recorded.')
    else if ((vMin !== null && motor.rated_voltage < vMin) || (vMax !== null && motor.rated_voltage > vMax)) {
      incompatible.push(`The motor's rated voltage (${motor.rated_voltage} V) is outside the profile's range.`)
    }
  }

  if (incompatible.length > 0) return { status: 'incompatible', reasons: incompatible }
  if (unknown.length > 0) return { status: 'unknown', reasons: unknown }
  return { status: 'compatible', reasons: [] }
}
