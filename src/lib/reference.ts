/** Data access for reference profiles, limits and the parameter catalog. Runs as the signed-in user (RLS applies). */
import { supabase } from './supabase'
import { DataError, describeDbError } from './motors'
import type {
  LimitInput,
  ParameterDefinition,
  ProfileInput,
  ReferenceLimit,
  ReferenceProfile,
  ReferenceProfileWithCount,
  ReferenceProfileWithLimits,
} from '../types/reference'

function client() {
  if (!supabase) throw new DataError('Supabase is not configured.')
  return supabase
}

/**
 * Friendly messages for the lifecycle triggers and constraints in migrations 003/004,
 * falling back to the generic database mapping. Raw messages (which contain ids) are never shown.
 */
export function describeReferenceError(error: unknown): string {
  const message = ((error ?? {}) as { message?: string }).message ?? ''
  const rules: [RegExp, string][] = [
    [/requires approval authority/i, 'You do not have approval authority in this workspace. Ask the workspace owner to approve or retire this profile.'],
    [/has no limits and cannot be approved/i, 'Add at least one limit before approving this profile.'],
    [/Limits of reference profile .* cannot be changed/i, 'Limits can only be changed while the profile is a draft. Create a new version instead.'],
    [/Approved reference profile .* is immutable/i, 'An approved profile cannot be edited. Create a new version instead.'],
    [/can only be retired/i, 'An approved profile can only be retired.'],
    [/Retired reference profile .* cannot be modified/i, 'A retired profile cannot be modified.'],
    [/draft profile must be approved before it can be retired/i, 'Only an approved profile can be retired.'],
    [/Only draft reference profiles can be deleted/i, 'Only draft profiles can be deleted.'],
    [/reference_limits_range_order/, 'The lower limit must not exceed the upper limit.'],
    [/reference_limits_warning_order/, 'The lower warning threshold must not exceed the upper warning threshold.'],
    [/reference_limits_has_limit/, 'Enter at least one limit or warning threshold.'],
    [/reference_limits_profile_parameter_key/, 'This profile already has a limit for that parameter.'],
    [/reference_limits_parameter_code_fkey/, 'That parameter is not in the parameter catalog.'],
    [/reference_profiles_name_version_key/, 'A profile with this name and version already exists. Choose another version.'],
    [/reference_profiles_effective_order/, 'The effective-to date must not be before the effective-from date.'],
  ]
  for (const [re, text] of rules) if (re.test(message)) return text
  return describeDbError(error)
}

async function run<T>(op: () => PromiseLike<T>): Promise<T> {
  try {
    return await op()
  } catch (error) {
    throw error instanceof DataError ? error : new DataError(describeReferenceError(error))
  }
}

export const listParameterDefinitions = () =>
  run(async () => {
    const { data, error } = await client().from('parameter_definitions').select('*').order('display_name')
    if (error) throw error
    return (data ?? []) as ParameterDefinition[]
  })

export const listProfiles = () =>
  run(async () => {
    const { data, error } = await client()
      .from('reference_profiles')
      .select('*, reference_limits(count)')
      .order('name', { ascending: true })
      .order('version', { ascending: false })
    if (error) throw error
    return ((data ?? []) as (ReferenceProfile & { reference_limits: { count: number }[] })[]).map(
      ({ reference_limits, ...p }) => ({ ...p, limit_count: reference_limits?.[0]?.count ?? 0 }),
    ) as ReferenceProfileWithCount[]
  })

/** Returns null when the profile does not exist or is not visible to this user. */
export const getProfile = (id: string) =>
  run(async () => {
    const { data, error } = await client()
      .from('reference_profiles')
      .select('*, reference_limits(*)')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    const { reference_limits, ...profile } = data as ReferenceProfile & { reference_limits: ReferenceLimit[] }
    const limits = [...(reference_limits ?? [])].sort((a, b) => a.parameter_name.localeCompare(b.parameter_name))
    return { ...profile, limits } as ReferenceProfileWithLimits
  })

/** New profiles are always created as drafts. Nothing is ever approved automatically. */
export const createProfile = (input: ProfileInput) =>
  run(async () => {
    const { data, error } = await client()
      .from('reference_profiles')
      .insert({ ...input, approval_status: 'draft' })
      .select()
      .single()
    if (error) throw error
    return data as ReferenceProfile
  })

export const updateProfile = (id: string, input: ProfileInput) =>
  run(async () => {
    const { data, error } = await client().from('reference_profiles').update(input).eq('id', id).select().maybeSingle()
    if (error) throw error
    if (!data) throw new DataError('The profile could not be updated. It may no longer exist.')
    return data as ReferenceProfile
  })

async function setStatus(id: string, patch: Partial<ReferenceProfile>) {
  const { data, error } = await client().from('reference_profiles').update(patch).eq('id', id).select().maybeSingle()
  if (error) throw error
  if (!data) throw new DataError('The profile could not be updated. It may no longer exist.')
  return data as ReferenceProfile
}

/** Explicit user action only. The database re-checks that the profile has limits and is still a draft. */
export const approveProfile = (id: string) => run(() => setStatus(id, { approval_status: 'approved' }))

/** Retiring only changes the profile row; saved assessments keep pointing at the exact version they used. */
export const retireProfile = (profile: ReferenceProfile) =>
  run(() => {
    const now = new Date()
    const from = profile.effective_from ? new Date(profile.effective_from) : null
    // effective_to may not precede effective_from.
    const to = from && from > now ? from : now
    return setStatus(profile.id, { approval_status: 'retired', effective_to: to.toISOString() })
  })

export const addLimit = (profileId: string, input: LimitInput) =>
  run(async () => {
    const { data, error } = await client()
      .from('reference_limits')
      .insert({ ...input, reference_profile_id: profileId })
      .select()
      .single()
    if (error) throw error
    return data as ReferenceLimit
  })

export const updateLimit = (id: string, input: LimitInput) =>
  run(async () => {
    const { data, error } = await client().from('reference_limits').update(input).eq('id', id).select().maybeSingle()
    if (error) throw error
    if (!data) throw new DataError('The limit could not be updated. It may no longer exist.')
    return data as ReferenceLimit
  })

export const deleteLimit = (id: string) =>
  run(async () => {
    const { data, error } = await client().from('reference_limits').delete().eq('id', id).select('id')
    if (error) throw error
    if (!data || data.length === 0) throw new DataError('The limit could not be removed. It may no longer exist.')
  })

/**
 * Creates the next version of a profile as a new DRAFT, copying its metadata and limits.
 * The source profile is left untouched. Not atomic (two requests): if copying limits fails, the empty
 * draft remains and the error says so; it can be completed or left unused (drafts never affect assessments).
 */
export async function createNextVersion(
  source: ReferenceProfileWithLimits,
  existingVersions: number[],
): Promise<ReferenceProfile> {
  const nextVersion = Math.max(source.version, ...existingVersions) + 1
  const created = await createProfile({
    name: source.name,
    motor_type: source.motor_type,
    description: source.description,
    applicable_specs: source.applicable_specs,
    source_name: source.source_name,
    source_reference: source.source_reference,
    version: nextVersion,
    effective_from: null,
    effective_to: null,
  })
  if (source.limits.length > 0) {
    try {
      await run(async () => {
        const rows = source.limits.map((l) => ({
          reference_profile_id: created.id,
          parameter_code: l.parameter_code,
          parameter_name: l.parameter_name,
          unit: l.unit,
          lower_limit: l.lower_limit,
          upper_limit: l.upper_limit,
          warning_lower: l.warning_lower,
          warning_upper: l.warning_upper,
          applicable_conditions: l.applicable_conditions,
          source_note: l.source_note,
        }))
        const { error } = await client().from('reference_limits').insert(rows)
        if (error) throw error
      })
    } catch (error) {
      throw new DataError(
        `Draft version ${nextVersion} was created, but its limits could not be copied (${(error as Error).message}) ` +
          'Open the draft in Reference Data to add them manually.',
      )
    }
  }
  return created
}
