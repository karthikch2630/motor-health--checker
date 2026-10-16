/**
 * Measurement parsing, unit handling and per-reading validation.
 *
 * Canonical units come from the parameter catalog (parameter_definitions), never from this file.
 * This file only knows exact, standard unit conversions INTO a canonical unit, and offers a conversion
 * only when its target equals the catalog's canonical unit. It contains no engineering thresholds.
 * Physical bounds below are definitional (e.g. a temperature cannot be below absolute zero), not operating limits.
 */
import type { ParameterDefinition } from '../types/reference'
import type { ReadingInput } from '../types/test'

interface Conversion {
  code: string
  from: string
  to: string
  convert: (v: number) => number
}

const CONVERSIONS: Conversion[] = [
  { code: 'voltage', from: 'kV', to: 'V', convert: (v) => v * 1000 },
  { code: 'current', from: 'mA', to: 'A', convert: (v) => v / 1000 },
  { code: 'temperature', from: '°F', to: '°C', convert: (v) => ((v - 32) * 5) / 9 },
  { code: 'temperature', from: 'K', to: '°C', convert: (v) => v - 273.15 },
  { code: 'vibration', from: 'in/s', to: 'mm/s', convert: (v) => v * 25.4 }, // 1 in = 25.4 mm exactly
  { code: 'speed', from: 'rev/s', to: 'RPM', convert: (v) => v * 60 },
  { code: 'frequency', from: 'kHz', to: 'Hz', convert: (v) => v * 1000 },
]

/** Definitional bounds in the canonical unit: [min, max], either may be absent. Zero is a valid measurement. */
const PHYSICAL_BOUNDS: { code: string; unit: string; min?: number; max?: number }[] = [
  { code: 'voltage', unit: 'V', min: 0 },
  { code: 'current', unit: 'A', min: 0 },
  { code: 'temperature', unit: '°C', min: -273.15 }, // absolute zero
  { code: 'vibration', unit: 'mm/s', min: 0 },
  { code: 'speed', unit: 'RPM', min: 0 },
  { code: 'frequency', unit: 'Hz', min: 0 },
  { code: 'power_factor', unit: 'ratio', min: -1, max: 1 },
]

const MAX_MAGNITUDE = 1e15 // sanity guard against typos such as an extra exponent

export interface UnitOption {
  unit: string
  /** True for the catalog's canonical unit. */
  canonical: boolean
}

/** Canonical unit first, then every supported unit that converts exactly into it. */
export function unitOptionsFor(def: ParameterDefinition): UnitOption[] {
  const extra = CONVERSIONS.filter((c) => c.code === def.code && c.to === def.canonical_unit).map((c) => ({
    unit: c.from,
    canonical: false,
  }))
  return [{ unit: def.canonical_unit, canonical: true }, ...extra]
}

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

export type ParseResult = { ok: true; value: number } | { ok: false; error: string }

/**
 * Strict numeric parsing. Blank is NOT handled here (callers treat blank as "not measured").
 * Rejects hex, "Infinity", "NaN", digit-grouping and decimal commas instead of guessing.
 */
export function parseMeasurement(raw: string): ParseResult {
  const s = raw.trim()
  if (s.includes(',')) return { ok: false, error: 'Use a dot as the decimal separator and no thousands separators' }
  if (!NUMBER_RE.test(s)) return { ok: false, error: 'Enter a number' }
  const n = Number(s)
  if (!Number.isFinite(n)) return { ok: false, error: 'Enter a finite number' }
  if (Math.abs(n) > MAX_MAGNITUDE) return { ok: false, error: 'Value is implausibly large — check for a typing error' }
  return { ok: true, value: n }
}

const tidy = (n: number) => Number(n.toPrecision(12)) // remove binary floating-point noise from conversions

export type NormalizeResult =
  | { ok: true; value: number; unit: string }
  | { ok: false; error: string }

/** Converts into the catalog's canonical unit, or reports that the unit/conversion is unsupported. */
export function normalizeMeasurement(def: ParameterDefinition, value: number, unit: string): NormalizeResult {
  let normalized: number
  if (unit === def.canonical_unit) {
    normalized = value
  } else {
    const c = CONVERSIONS.find((x) => x.code === def.code && x.from === unit && x.to === def.canonical_unit)
    if (!c) return { ok: false, error: `Unit "${unit}" is not supported for ${def.display_name}` }
    normalized = tidy(c.convert(value))
  }
  const bounds = PHYSICAL_BOUNDS.find((b) => b.code === def.code && b.unit === def.canonical_unit)
  if (bounds?.min !== undefined && normalized < bounds.min) {
    return { ok: false, error: `${def.display_name} cannot be below ${bounds.min} ${def.canonical_unit}` }
  }
  if (bounds?.max !== undefined && normalized > bounds.max) {
    return { ok: false, error: `${def.display_name} cannot be above ${bounds.max} ${def.canonical_unit}` }
  }
  return { ok: true, value: normalized, unit: def.canonical_unit }
}

/** What the user typed for one parameter. */
export interface ReadingFormValue {
  value: string
  unit: string
  location: string
}

export type ReadingFormValues = Record<string, ReadingFormValue>

export type ReadingsResult =
  | { ok: true; readings: ReadingInput[] }
  | { ok: false; errors: Record<string, string> }

/**
 * Blank value = not measured (the reading is omitted, never stored as 0).
 * Any non-blank value must parse, use a supported unit and pass the definitional bounds.
 */
export function validateReadings(values: ReadingFormValues, definitions: ParameterDefinition[]): ReadingsResult {
  const errors: Record<string, string> = {}
  const readings: ReadingInput[] = []

  for (const def of definitions) {
    const v = values[def.code]
    if (!v) continue
    const location = v.location.trim()
    if (v.value.trim() === '') {
      if (location !== '') errors[def.code] = 'Enter a value or clear the location'
      continue
    }
    const parsed = parseMeasurement(v.value)
    if (!parsed.ok) {
      errors[def.code] = parsed.error
      continue
    }
    const unit = v.unit || def.canonical_unit
    const normalized = normalizeMeasurement(def, parsed.value, unit)
    if (!normalized.ok) {
      errors[def.code] = normalized.error
      continue
    }
    if (location.length > 200) {
      errors[def.code] = 'Location must be 200 characters or fewer'
      continue
    }
    readings.push({
      parameter_code: def.code,
      measured_value: parsed.value,
      measured_unit: unit,
      normalized_value: normalized.value,
      normalized_unit: normalized.unit,
      measurement_location: location === '' ? null : location,
    })
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, readings }
}
