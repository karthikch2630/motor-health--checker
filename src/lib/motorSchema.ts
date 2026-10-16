import { z } from 'zod'
import type { Motor, MotorInput } from '../types/motor'

/**
 * Form validation for motors. It mirrors the database constraints in
 * 001_create_motors.sql (positive numbers, power_unit required with rated_power,
 * integer rpm / phase count). The database remains the final authority.
 */

export interface MotorFormValues {
  motor_tag: string
  name: string
  motor_type: string
  manufacturer: string
  model: string
  serial_number: string
  rated_voltage: string
  rated_current: string
  rated_power: string
  power_unit: '' | 'W' | 'kW'
  rated_frequency: string
  rated_rpm: string
  phase_count: string
  supply_type: '' | 'line' | 'inverter'
  location: string
  notes: string
}

export type MotorFormErrors = Partial<Record<keyof MotorFormValues, string>>

export const EMPTY_MOTOR_FORM: MotorFormValues = {
  motor_tag: '',
  name: '',
  motor_type: '',
  manufacturer: '',
  model: '',
  serial_number: '',
  rated_voltage: '',
  rated_current: '',
  rated_power: '',
  power_unit: '',
  rated_frequency: '',
  rated_rpm: '',
  phase_count: '',
  supply_type: '',
  location: '',
  notes: '',
}

const requiredText = (label: string) =>
  z.string().trim().min(1, `${label} is required`).max(200, `${label} must be 200 characters or fewer`)

const optionalText = (label: string, max = 200) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer`)
    .transform((v) => (v === '' ? null : v))

/** Blank -> null (not specified). Otherwise must be a finite number > 0 (and an integer if requested). */
const optionalPositive = (label: string, opts: { integer?: boolean; max?: number } = {}) =>
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
      if (n <= 0) {
        ctx.addIssue({ code: 'custom', message: `${label} must be greater than 0` })
        return z.NEVER
      }
      if (opts.integer && !Number.isInteger(n)) {
        ctx.addIssue({ code: 'custom', message: `${label} must be a whole number` })
        return z.NEVER
      }
      if (opts.max !== undefined && n > opts.max) {
        ctx.addIssue({ code: 'custom', message: `${label} is too large` })
        return z.NEVER
      }
      return n
    })

const motorFormSchema = z
  .object({
    motor_tag: requiredText('Motor tag'),
    name: requiredText('Name'),
    motor_type: requiredText('Motor type'),
    manufacturer: optionalText('Manufacturer'),
    model: optionalText('Model'),
    serial_number: optionalText('Serial number'),
    rated_voltage: optionalPositive('Rated voltage'),
    rated_current: optionalPositive('Rated current'),
    rated_power: optionalPositive('Rated power'),
    power_unit: z.enum(['', 'W', 'kW']).transform((v) => (v === '' ? null : v)),
    rated_frequency: optionalPositive('Rated frequency'),
    rated_rpm: optionalPositive('Rated speed', { integer: true, max: 2_147_483_647 }),
    phase_count: optionalPositive('Number of phases', { integer: true, max: 32_767 }),
    supply_type: z.enum(['', 'line', 'inverter']).transform((v) => (v === '' ? null : v)),
    location: optionalText('Location'),
    notes: optionalText('Notes', 4000),
  })
  .superRefine((v, ctx) => {
    if (v.rated_power !== null && v.power_unit === null) {
      ctx.addIssue({ code: 'custom', path: ['power_unit'], message: 'Select a unit for the rated power' })
    }
  })

export type MotorFormResult =
  | { ok: true; data: MotorInput }
  | { ok: false; errors: MotorFormErrors }

export function validateMotorForm(values: MotorFormValues): MotorFormResult {
  const parsed = motorFormSchema.safeParse(values)
  if (parsed.success) return { ok: true, data: parsed.data }

  const errors: MotorFormErrors = {}
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof MotorFormValues | undefined
    if (key && !errors[key]) errors[key] = issue.message
  }
  return { ok: false, errors }
}

/** Database row -> editable form strings (null becomes an empty string, never zero). */
export function motorToFormValues(m: Motor): MotorFormValues {
  const s = (v: string | number | null) => (v === null ? '' : String(v))
  return {
    motor_tag: m.motor_tag,
    name: m.name,
    motor_type: m.motor_type,
    manufacturer: s(m.manufacturer),
    model: s(m.model),
    serial_number: s(m.serial_number),
    rated_voltage: s(m.rated_voltage),
    rated_current: s(m.rated_current),
    rated_power: s(m.rated_power),
    power_unit: m.power_unit ?? '',
    rated_frequency: s(m.rated_frequency),
    rated_rpm: s(m.rated_rpm),
    phase_count: s(m.phase_count),
    supply_type: m.supply_type ?? '',
    location: s(m.location),
    notes: s(m.notes),
  }
}
