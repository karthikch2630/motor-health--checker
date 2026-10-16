/**
 * Shared application types.
 * Assessment statuses follow docs/DIAGNOSTIC_RULES.md section 10.
 */
export const ASSESSMENT_STATUSES = [
  'NORMAL',
  'WARNING',
  'FAULT_SUSPECTED',
  'INSUFFICIENT_DATA',
  'NOT_ASSESSED',
] as const

export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number]

/** Finding severities are separate from the overall assessment status. */
export type FindingSeverity = 'INFO' | 'WARNING' | 'CRITICAL'

/** Parameter identifiers shared by database and frontend (DIAGNOSTIC_RULES.md section 3). */
export type ParameterCode =
  | 'voltage'
  | 'current'
  | 'temperature'
  | 'vibration'
  | 'speed'
  | 'frequency'
  | 'power_factor'
