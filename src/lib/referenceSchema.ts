/**
 * Validation for reference profiles and limits. Mirrors the constraints in migrations 003/004;
 * the database stays the final authority. No engineering values are defined here.
 */
import { describeCombinedRule, parseCombinedConfig } from './combinedVariation'
import { z } from 'zod'
import type {
  LimitInput,
  ParameterDefinition,
  ProfileInput,
  ReferenceLimit,
  ReferenceProfile,
} from '../types/reference'

// ---------------------------------------------------------------- shared helpers

const blankToNull = (v: string) => (v.trim() === '' ? null : v.trim())

/** Blank -> null ("not specified"; never zero and never "unlimited"). */
const optionalNumber = (label: string, opts: { positive?: boolean; integer?: boolean } = {}) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === '') return null
      const n = Number(v)
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: 'custom', message: `${label} must be a number` })
        return z.NEVER
      }
      if (opts.positive && n <= 0) {
        ctx.addIssue({ code: 'custom', message: `${label} must be greater than 0` })
        return z.NEVER
      }
      if (opts.integer && !Number.isInteger(n)) {
        ctx.addIssue({ code: 'custom', message: `${label} must be a whole number` })
        return z.NEVER
      }
      return n
    })

const requiredText = (label: string) =>
  z.string().trim().min(1, `${label} is required`).max(300, `${label} must be 300 characters or fewer`)

const optionalText = (label: string, max = 2000) =>
  z.string().trim().max(max, `${label} must be ${max} characters or fewer`).transform(blankToNull)

function collectErrors<K extends string>(issues: { path: PropertyKey[]; message: string }[]) {
  const errors: Partial<Record<K, string>> = {}
  for (const issue of issues) {
    const key = issue.path[0] as K | undefined
    if (key && !errors[key]) errors[key] = issue.message
  }
  return errors
}

// ---------------------------------------------------------------- profiles

/**
 * Keys this app writes into reference_profiles.applicable_specs. Other keys already present are preserved.
 * (The database treats the column as free JSON; matching rules are applied in later phases.)
 */
export const SPEC_KEYS = ['phase_count', 'rated_frequency_hz', 'rated_voltage_min_v', 'rated_voltage_max_v'] as const

export interface ProfileFormValues {
  name: string
  motor_type: string
  description: string
  version: string
  source_name: string
  source_reference: string
  effective_from: string // yyyy-mm-dd
  effective_to: string // yyyy-mm-dd
  spec_phase_count: string
  spec_frequency: string
  spec_voltage_min: string
  spec_voltage_max: string
}

export type ProfileFormErrors = Partial<Record<keyof ProfileFormValues, string>>

export const EMPTY_PROFILE_FORM: ProfileFormValues = {
  name: '',
  motor_type: '',
  description: '',
  version: '1',
  source_name: '',
  source_reference: '',
  effective_from: '',
  effective_to: '',
  spec_phase_count: '',
  spec_frequency: '',
  spec_voltage_min: '',
  spec_voltage_max: '',
}

const dateField = (label: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === '') return null
      const d = new Date(`${v}T00:00:00`)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: 'custom', message: `${label} must be a valid date` })
        return z.NEVER
      }
      return d.toISOString()
    })

const profileFormSchema = z
  .object({
    name: requiredText('Profile name'),
    motor_type: requiredText('Applicable motor type'),
    description: optionalText('Description'),
    version: optionalNumber('Version', { positive: true, integer: true }),
    source_name: requiredText('Source'),
    source_reference: optionalText('Source reference'),
    effective_from: dateField('Effective from'),
    effective_to: dateField('Effective to'),
    spec_phase_count: optionalNumber('Number of phases', { positive: true, integer: true }),
    spec_frequency: optionalNumber('Rated frequency', { positive: true }),
    spec_voltage_min: optionalNumber('Minimum rated voltage', { positive: true }),
    spec_voltage_max: optionalNumber('Maximum rated voltage', { positive: true }),
  })
  .superRefine((v, ctx) => {
    if (v.version === null) {
      ctx.addIssue({ code: 'custom', path: ['version'], message: 'Version is required' })
    }
    if (v.spec_voltage_min !== null && v.spec_voltage_max !== null && v.spec_voltage_min > v.spec_voltage_max) {
      ctx.addIssue({
        code: 'custom',
        path: ['spec_voltage_min'],
        message: 'Minimum rated voltage must not exceed the maximum',
      })
    }
    if (v.effective_from !== null && v.effective_to !== null && v.effective_from > v.effective_to) {
      ctx.addIssue({ code: 'custom', path: ['effective_to'], message: 'Effective to must not be before effective from' })
    }
  })

export type ProfileFormResult = { ok: true; data: ProfileInput } | { ok: false; errors: ProfileFormErrors }

/** `existingSpecs` lets unknown keys survive an edit. */
export function validateProfileForm(
  values: ProfileFormValues,
  existingSpecs: Record<string, unknown> = {},
): ProfileFormResult {
  const parsed = profileFormSchema.safeParse(values)
  if (!parsed.success) return { ok: false, errors: collectErrors<keyof ProfileFormValues>(parsed.error.issues) }
  const v = parsed.data

  const specs: Record<string, unknown> = { ...existingSpecs }
  for (const k of SPEC_KEYS) delete specs[k]
  if (v.spec_phase_count !== null) specs.phase_count = v.spec_phase_count
  if (v.spec_frequency !== null) specs.rated_frequency_hz = v.spec_frequency
  if (v.spec_voltage_min !== null) specs.rated_voltage_min_v = v.spec_voltage_min
  if (v.spec_voltage_max !== null) specs.rated_voltage_max_v = v.spec_voltage_max

  return {
    ok: true,
    data: {
      name: v.name,
      motor_type: v.motor_type,
      description: v.description,
      version: v.version as number,
      source_name: v.source_name,
      source_reference: v.source_reference,
      effective_from: v.effective_from,
      effective_to: v.effective_to,
      applicable_specs: specs,
    },
  }
}

const isoToDateInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function profileToFormValues(p: ReferenceProfile): ProfileFormValues {
  const s = (k: string) => (typeof p.applicable_specs[k] === 'number' ? String(p.applicable_specs[k]) : '')
  return {
    name: p.name,
    motor_type: p.motor_type,
    description: p.description ?? '',
    version: String(p.version),
    source_name: p.source_name,
    source_reference: p.source_reference ?? '',
    effective_from: isoToDateInput(p.effective_from),
    effective_to: isoToDateInput(p.effective_to),
    spec_phase_count: s('phase_count'),
    spec_frequency: s('rated_frequency_hz'),
    spec_voltage_min: s('rated_voltage_min_v'),
    spec_voltage_max: s('rated_voltage_max_v'),
  }
}

/** Human-readable list of the applicability entries a profile declares. */
export function describeSpecs(specs: Record<string, unknown>): string[] {
  const out: string[] = []
  if (typeof specs.phase_count === 'number') out.push(`${specs.phase_count} phase(s)`)
  if (typeof specs.rated_frequency_hz === 'number') out.push(`Rated frequency ${specs.rated_frequency_hz} Hz`)
  const lo = specs.rated_voltage_min_v
  const hi = specs.rated_voltage_max_v
  if (typeof lo === 'number' && typeof hi === 'number') out.push(`Rated voltage ${lo}–${hi} V`)
  else if (typeof lo === 'number') out.push(`Rated voltage ≥ ${lo} V`)
  else if (typeof hi === 'number') out.push(`Rated voltage ≤ ${hi} V`)
  if (specs.supply_type === 'line') out.push('Fixed-frequency line supply only (not drive-fed)')
  else if (specs.supply_type === 'inverter') out.push('Inverter-fed only')
  const combined = parseCombinedConfig(specs)
  if (combined.kind === 'ok') out.push(`Combined rule: ${describeCombinedRule(combined.config)}`)
  else if (combined.kind === 'invalid') out.push(`Combined rule INVALID (${combined.reason})`)
  return out
}

// ---------------------------------------------------------------- limits

export interface LimitFormValues {
  parameter_code: string
  lower_limit: string
  upper_limit: string
  warning_lower: string
  warning_upper: string
  conditions: string
  source_note: string
}

export type LimitFormErrors = Partial<Record<keyof LimitFormValues | 'thresholds', string>>

export const EMPTY_LIMIT_FORM: LimitFormValues = {
  parameter_code: '',
  lower_limit: '',
  upper_limit: '',
  warning_lower: '',
  warning_upper: '',
  conditions: '',
  source_note: '',
}

const limitFormSchema = z.object({
  parameter_code: z.string().min(1, 'Select a parameter'),
  lower_limit: optionalNumber('Lower limit'),
  upper_limit: optionalNumber('Upper limit'),
  warning_lower: optionalNumber('Lower warning threshold'),
  warning_upper: optionalNumber('Upper warning threshold'),
  conditions: optionalText('Applicable conditions'),
  source_note: requiredText('Source note'),
})

export type LimitFormResult = { ok: true; data: LimitInput } | { ok: false; errors: LimitFormErrors }

/**
 * `definitions` is the catalog read from parameter_definitions. The unit and display name are taken from it,
 * never typed by the user, so a limit cannot be recorded in a unit other than the canonical one.
 */
export function validateLimitForm(
  values: LimitFormValues,
  definitions: ParameterDefinition[],
  existingConditions: Record<string, unknown> = {},
): LimitFormResult {
  const parsed = limitFormSchema.safeParse(values)
  const errors: LimitFormErrors = parsed.success ? {} : collectErrors<keyof LimitFormValues>(parsed.error.issues)

  const def = definitions.find((d) => d.code === values.parameter_code)
  if (values.parameter_code && !def) errors.parameter_code = 'Unknown parameter'
  if (!parsed.success || !def) return { ok: false, errors }

  const v = parsed.data
  if (v.lower_limit === null && v.upper_limit === null && v.warning_lower === null && v.warning_upper === null) {
    errors.thresholds = 'Enter at least one limit or warning threshold. Blank values mean "not specified", not zero or unlimited.'
  }
  if (v.lower_limit !== null && v.upper_limit !== null && v.lower_limit > v.upper_limit) {
    errors.lower_limit = 'Lower limit must not exceed the upper limit'
  }
  if (v.warning_lower !== null && v.warning_upper !== null && v.warning_lower > v.warning_upper) {
    errors.warning_lower = 'Lower warning threshold must not exceed the upper warning threshold'
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  const conditions: Record<string, unknown> = { ...existingConditions }
  delete conditions.description
  if (v.conditions !== null) conditions.description = v.conditions

  return {
    ok: true,
    data: {
      parameter_code: def.code,
      parameter_name: def.display_name,
      unit: def.canonical_unit,
      lower_limit: v.lower_limit,
      upper_limit: v.upper_limit,
      warning_lower: v.warning_lower,
      warning_upper: v.warning_upper,
      applicable_conditions: conditions,
      source_note: v.source_note,
    },
  }
}

export function limitToFormValues(l: ReferenceLimit): LimitFormValues {
  const s = (n: number | null) => (n === null ? '' : String(n))
  const desc = l.applicable_conditions?.description
  return {
    parameter_code: l.parameter_code,
    lower_limit: s(l.lower_limit),
    upper_limit: s(l.upper_limit),
    warning_lower: s(l.warning_lower),
    warning_upper: s(l.warning_upper),
    conditions: typeof desc === 'string' ? desc : '',
    source_note: l.source_note,
  }
}

// ---------------------------------------------------------------- approval readiness

export interface ApprovalReadiness {
  /** Problems that must be fixed before the profile can be approved. */
  blockers: string[]
  /** Gaps that do not block approval but should be reviewed first. */
  warnings: string[]
}

export function assessApprovalReadiness(
  profile: ReferenceProfile,
  limits: ReferenceLimit[],
  definitions: ParameterDefinition[],
): ApprovalReadiness {
  const blockers: string[] = []
  const warnings: string[] = []

  if (profile.source_name.trim() === '') blockers.push('The source of the reference data is not recorded.')
  if (limits.length === 0) blockers.push('The profile has no limits. Add at least one limit from the stated source.')

  for (const l of limits) {
    const def = definitions.find((d) => d.code === l.parameter_code)
    if (!def) blockers.push(`${l.parameter_name}: the parameter is not in the parameter catalog.`)
    else if (def.canonical_unit !== l.unit) {
      blockers.push(`${l.parameter_name}: unit "${l.unit}" differs from the canonical unit "${def.canonical_unit}".`)
    }
    if (l.source_note.trim() === '') blockers.push(`${l.parameter_name}: no source note.`)
  }

  const combined = parseCombinedConfig(profile.applicable_specs)
  if (combined.kind === 'invalid') blockers.push(`The combined voltage/frequency rule is inconsistent: ${combined.reason}.`)
  if (combined.kind === 'ok') {
    for (const code of [combined.config.voltage_parameter, combined.config.frequency_parameter]) {
      if (!limits.some((l) => l.parameter_code === code)) {
        warnings.push(`The combined rule uses "${code}", but the profile has no individual limit for it.`)
      }
    }
  }

  if (!profile.source_reference?.trim()) {
    warnings.push('No source reference (document, standard or URL) is recorded, so the limits cannot be traced.')
  }
  if (describeSpecs(profile.applicable_specs).length === 0) {
    warnings.push('No applicable motor specifications are recorded. Applicability is limited to the motor type text.')
  }
  if (!profile.effective_from) warnings.push('No effective-from date is set.')
  return { blockers, warnings }
}
