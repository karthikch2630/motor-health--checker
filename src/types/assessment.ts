/** Row shapes of public.diagnostic_results and public.diagnostic_findings (migrations 007, 008). */
import type { AssessmentStatus, FindingSeverity } from './index'

export interface StoredFinding {
  id: string
  diagnostic_result_id: string
  parameter_code: string | null
  rule_code: string
  severity: FindingSeverity
  observed_value: number | null
  observed_unit: string | null
  applicable_limit: number | null
  finding_description: string
  possible_causes: string[] | null
  recommended_action: string | null
  created_at: string
}

export interface StoredResult {
  id: string
  test_session_id: string
  revision: number
  reference_profile_id: string | null
  reference_profile_version: number | null
  diagnostic_engine_version: string
  overall_status: AssessmentStatus
  summary: string | null
  assessed_at: string
}

export interface StoredAssessment extends StoredResult {
  findings: StoredFinding[]
}

export interface SavedAssessmentRef {
  result_id: string
  revision: number
}
