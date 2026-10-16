/**
 * Runs and stores assessments. The comparison itself lives in diagnostics.ts (pure); this file only gathers
 * inputs and persists the outcome. Persistence uses the database function save_diagnostic_assessment
 * (migration 011), so a result, its findings and the session's move to `assessed` are stored in ONE
 * transaction. If anything fails, nothing is stored and no success is reported.
 */
import { supabase } from './supabase'
import { assessMotor, type DiagnosticResult } from './diagnostics'
import { DataError } from './motors'
import { getProfile } from './reference'
import { describeTestError } from './tests'
import type { Motor } from '../types/motor'
import type { ParameterDefinition } from '../types/reference'
import type { SavedAssessmentRef, StoredAssessment, StoredFinding, StoredResult } from '../types/assessment'
import type { TestReading, TestSession } from '../types/test'

function client() {
  if (!supabase) throw new DataError('Supabase is not configured.')
  return supabase
}

export function describeAssessmentError(error: unknown): string {
  const e = (error ?? {}) as { message?: string; code?: string }
  const message = e.message ?? ''
  const rules: [RegExp, string][] = [
    [/save_diagnostic_assessment|PGRST202|42883|could not find the function/i, 'The assessment function is missing from the database. Apply migrations 010 and 011 (see the README).'],
    [/is still a draft and cannot be assessed/i, 'This test is still a draft. Submit it before assessing.'],
    [/Test session .* was not found/i, 'The test could not be found. It may have been removed.'],
    [/is not approved and cannot support/i, 'The selected reference profile is no longer approved, so the assessment was not saved. Choose another profile and try again.'],
    [/diagnostic_results_session_revision_key/, 'Another assessment of this test was saved at the same time. Reload the page and try again.'],
    [/diagnostic_results_profile_fk/, 'The selected reference profile version could not be verified, so the assessment was not saved.'],
    [/Draft test session .* cannot be assessed/i, 'This test is still a draft. Submit it before assessing.'],
  ]
  for (const [re, text] of rules) if (re.test(message) || re.test(e.code ?? '')) return text
  return describeTestError(error)
}

const wrap = (error: unknown) => (error instanceof DataError ? error : new DataError(describeAssessmentError(error)))

/** All stored assessments of a test, newest revision first, each with its findings. */
export async function listAssessments(sessionId: string): Promise<StoredAssessment[]> {
  try {
    const { data, error } = await client()
      .from('diagnostic_results')
      .select('*')
      .eq('test_session_id', sessionId)
      .order('revision', { ascending: false })
    if (error) throw error
    const results = (data ?? []) as StoredResult[]
    if (results.length === 0) return []
    const { data: rows, error: findingsError } = await client()
      .from('diagnostic_findings')
      .select('*')
      .in('diagnostic_result_id', results.map((r) => r.id))
    if (findingsError) throw findingsError
    const findings = (rows ?? []) as StoredFinding[]
    return results.map((r) => ({ ...r, findings: findings.filter((f) => f.diagnostic_result_id === r.id) }))
  } catch (error) {
    throw wrap(error)
  }
}

/** Maps an engine result onto the arguments of save_diagnostic_assessment. */
export function toSaveArgs(sessionId: string, r: DiagnosticResult) {
  return {
    p_session_id: sessionId,
    p_profile_id: r.referenceProfileId,
    p_profile_version: r.referenceProfileVersion,
    p_engine_version: r.diagnosticEngineVersion,
    p_status: r.overallStatus,
    p_summary: r.summary,
    p_findings: r.findings.map((f) => ({
      parameter_code: f.parameterCode,
      rule_code: f.ruleCode,
      severity: f.severity,
      observed_value: f.observedValue,
      observed_unit: f.observedUnit,
      applicable_limit: f.applicableLimit,
      finding_description: f.description,
      possible_causes: f.possibleCauses,
      recommended_action: f.recommendedAction,
    })),
  }
}

/** Stores an assessment atomically. Resolves only if EVERYTHING was stored. */
export async function saveAssessment(sessionId: string, result: DiagnosticResult): Promise<SavedAssessmentRef> {
  if (result.overallStatus === 'NOT_ASSESSED') {
    // NOT_ASSESSED means "no assessment performed"; it is never persisted.
    throw new DataError('A test that is not assessed cannot be saved as an assessment.')
  }
  try {
    const { data, error } = await client().rpc('save_diagnostic_assessment', toSaveArgs(sessionId, result))
    if (error) throw error
    const ref = data as SavedAssessmentRef | null
    if (!ref || typeof ref.result_id !== 'string' || typeof ref.revision !== 'number') {
      throw new DataError('The database did not confirm that the assessment was saved.')
    }
    return ref
  } catch (error) {
    throw wrap(error)
  }
}

export interface RunAssessmentInput {
  session: TestSession
  readings: TestReading[]
  motor: Motor
  definitions: ParameterDefinition[]
  /** The profile the user selected, or null to record an assessment with no usable profile. */
  profileId: string | null
}

/** Loads the selected profile, runs the engine, and stores the outcome. */
export async function runAssessment(input: RunAssessmentInput) {
  if (input.session.status === 'draft') {
    throw new DataError('This test is still a draft. Submit it before assessing.')
  }
  let profile = null
  if (input.profileId) {
    const loaded = await getProfile(input.profileId)
    if (!loaded) throw new DataError('The selected reference profile was not found.')
    profile = loaded
  }
  const result = assessMotor({
    sessionStatus: input.session.status,
    testTime: new Date(input.session.test_timestamp),
    motor: input.motor,
    operatingConditions: input.session.operating_conditions ?? {},
    readings: input.readings,
    profile,
    parameterNames: Object.fromEntries(input.definitions.map((d) => [d.code, d.display_name])),
  })
  const saved = await saveAssessment(input.session.id, result)
  return { result, saved }
}
