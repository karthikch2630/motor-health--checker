/** Test session form: metadata validation and conversion between database rows and form strings. */
import { z } from 'zod'
import { LOAD_CONDITIONS, LOAD_CONDITION_KEY } from './combinedVariation'
import { DATA_ORIGINS, DATA_ORIGIN_KEY } from './dataOrigin'
import type { ParameterDefinition } from '../types/reference'
import type { ReadingFormValues } from './measurements'
import type { SessionInput, TestReading, TestSession } from '../types/test'

export interface TestFormValues {
  motor_id: string
  /** `datetime-local` value (local time), e.g. 2026-10-15T14:30 */
  timestamp: string
  measurement_method: string
  operator: string
  conditions: string
  /** '' = not recorded, otherwise one of LOAD_CONDITIONS. */
  load_condition: string
  /** '' = not stated, otherwise one of DATA_ORIGINS. */
  data_origin: string
  notes: string
  readings: ReadingFormValues
}

export type TestMetaErrors = Partial<Record<'motor_id' | 'timestamp' | 'measurement_method' | 'operator' | 'conditions' | 'load_condition' | 'data_origin' | 'notes', string>>

const pad = (n: number) => String(n).padStart(2, '0')

export function toDateTimeLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Empty reading rows for every catalog parameter, each defaulting to its canonical unit. */
export function emptyReadings(definitions: ParameterDefinition[]): ReadingFormValues {
  return Object.fromEntries(definitions.map((d) => [d.code, { value: '', unit: d.canonical_unit, location: '' }]))
}

export function newTestForm(definitions: ParameterDefinition[], motorId = '', now = new Date()): TestFormValues {
  return {
    motor_id: motorId,
    timestamp: toDateTimeLocal(now),
    measurement_method: '',
    operator: '',
    conditions: '',
    load_condition: '',
    data_origin: '',
    notes: '',
    readings: emptyReadings(definitions),
  }
}

export function testToFormValues(
  session: TestSession,
  readings: TestReading[],
  definitions: ParameterDefinition[],
): TestFormValues {
  const rows = emptyReadings(definitions)
  for (const r of readings) {
    rows[r.parameter_code] = {
      value: String(r.measured_value),
      unit: r.measured_unit,
      location: r.measurement_location ?? '',
    }
  }
  const c = session.operating_conditions ?? {}
  return {
    motor_id: session.motor_id,
    timestamp: toDateTimeLocal(new Date(session.test_timestamp)),
    measurement_method: session.measurement_method ?? '',
    operator: typeof c.operator === 'string' ? c.operator : '',
    conditions: typeof c.description === 'string' ? c.description : '',
    load_condition: typeof c[LOAD_CONDITION_KEY] === 'string' ? (c[LOAD_CONDITION_KEY] as string) : '',
    data_origin: typeof c[DATA_ORIGIN_KEY] === 'string' ? (c[DATA_ORIGIN_KEY] as string) : '',
    notes: session.notes ?? '',
    readings: rows,
  }
}

const optional = (label: string, max: number) =>
  z.string().trim().max(max, `${label} must be ${max} characters or fewer`)

const metaSchema = z.object({
  motor_id: z.string().min(1, 'Select a motor'),
  timestamp: z.string().min(1, 'Enter the test date and time'),
  measurement_method: optional('Measurement method', 500),
  operator: optional('Operator', 200),
  conditions: optional('Operating conditions', 1000),
  load_condition: z.string().refine((x) => x === '' || (LOAD_CONDITIONS as readonly string[]).includes(x), 'Choose one of the listed load conditions'),
  data_origin: z.string().refine((x) => x === '' || (DATA_ORIGINS as readonly string[]).includes(x), 'Choose one of the listed options'),
  notes: optional('Notes', 4000),
})

export type SessionResult = { ok: true; data: SessionInput } | { ok: false; errors: TestMetaErrors }

/** Tests may not be dated in the future (small allowance for clock differences). */
const FUTURE_ALLOWANCE_MS = 5 * 60 * 1000

export function validateSessionMeta(
  values: TestFormValues,
  existingConditions: Record<string, unknown> = {},
  now = new Date(),
): SessionResult {
  const parsed = metaSchema.safeParse(values)
  const errors: TestMetaErrors = {}
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof TestMetaErrors
      if (!errors[key]) errors[key] = issue.message
    }
  }
  const when = new Date(values.timestamp)
  if (values.timestamp && Number.isNaN(when.getTime())) errors.timestamp = 'Enter a valid date and time'
  else if (values.timestamp && when.getTime() > now.getTime() + FUTURE_ALLOWANCE_MS) {
    errors.timestamp = 'The test date and time cannot be in the future'
  }
  if (Object.keys(errors).length > 0 || !parsed.success) return { ok: false, errors }

  const v = parsed.data
  const conditions: Record<string, unknown> = { ...existingConditions }
  delete conditions.operator
  delete conditions.description
  delete conditions[LOAD_CONDITION_KEY]
  delete conditions[DATA_ORIGIN_KEY]
  if (v.operator !== '') conditions.operator = v.operator
  if (v.conditions !== '') conditions.description = v.conditions
  if (v.load_condition !== '') conditions[LOAD_CONDITION_KEY] = v.load_condition
  if (v.data_origin !== '') conditions[DATA_ORIGIN_KEY] = v.data_origin

  return {
    ok: true,
    data: {
      motor_id: v.motor_id,
      test_timestamp: when.toISOString(),
      measurement_method: v.measurement_method === '' ? null : v.measurement_method,
      notes: v.notes === '' ? null : v.notes,
      operating_conditions: conditions,
    },
  }
}
