/** Row shapes of public.parameter_definitions, reference_profiles and reference_limits (migrations 002-004). */
export interface ParameterDefinition {
  code: string
  display_name: string
  description: string | null
  canonical_unit: string
}

export type ApprovalStatus = 'draft' | 'approved' | 'retired'

export interface ReferenceProfile {
  id: string
  owner_id: string
  name: string
  motor_type: string
  description: string | null
  applicable_specs: Record<string, unknown>
  source_name: string
  source_reference: string | null
  version: number
  approval_status: ApprovalStatus
  effective_from: string | null
  effective_to: string | null
  created_at: string
}

export interface ReferenceLimit {
  id: string
  owner_id: string
  reference_profile_id: string
  parameter_code: string
  parameter_name: string
  unit: string
  lower_limit: number | null
  upper_limit: number | null
  warning_lower: number | null
  warning_upper: number | null
  applicable_conditions: Record<string, unknown>
  source_note: string
  created_at: string
}

export type ReferenceProfileWithCount = ReferenceProfile & { limit_count: number }
export type ReferenceProfileWithLimits = ReferenceProfile & { limits: ReferenceLimit[] }

/** Columns the user may write on a profile. */
export type ProfileInput = Pick<
  ReferenceProfile,
  | 'name'
  | 'motor_type'
  | 'description'
  | 'applicable_specs'
  | 'source_name'
  | 'source_reference'
  | 'version'
  | 'effective_from'
  | 'effective_to'
>

/** Columns the user may write on a limit (profile id and owner are set separately / by the database). */
export type LimitInput = Pick<
  ReferenceLimit,
  | 'parameter_code'
  | 'parameter_name'
  | 'unit'
  | 'lower_limit'
  | 'upper_limit'
  | 'warning_lower'
  | 'warning_upper'
  | 'applicable_conditions'
  | 'source_note'
>
