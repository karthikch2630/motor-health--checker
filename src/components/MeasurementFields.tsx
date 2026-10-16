import { inputClass } from './FormField'
import { unitOptionsFor, type ReadingFormValue, type ReadingFormValues } from '../lib/measurements'
import type { ParameterDefinition } from '../types/reference'

// Display order only. Codes, names, units and descriptions all come from the parameter catalog.
const DISPLAY_ORDER = ['voltage', 'current', 'temperature', 'vibration', 'speed', 'frequency', 'power_factor']

export function sortDefinitions(defs: ParameterDefinition[]): ParameterDefinition[] {
  const rank = (c: string) => (DISPLAY_ORDER.includes(c) ? DISPLAY_ORDER.indexOf(c) : DISPLAY_ORDER.length)
  return [...defs].sort((a, b) => rank(a.code) - rank(b.code) || a.display_name.localeCompare(b.display_name))
}

interface Props {
  definitions: ParameterDefinition[]
  values: ReadingFormValues
  errors: Record<string, string>
  disabled?: boolean
  onChange: (code: string, patch: Partial<ReadingFormValue>) => void
}

export default function MeasurementFields({ definitions, values, errors, disabled, onChange }: Props) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {sortDefinitions(definitions).map((def) => {
        const v = values[def.code] ?? { value: '', unit: def.canonical_unit, location: '' }
        const options = unitOptionsFor(def)
        const unitKnown = options.some((o) => o.unit === v.unit)
        const err = errors[def.code]
        const base = `reading-${def.code}`
        return (
          <fieldset key={def.code} className="rounded-lg border border-slate-200 bg-white p-4" disabled={disabled}>
            <legend className="px-2 text-sm font-semibold text-slate-800">{def.display_name}</legend>
            <p id={`${base}-hint`} className="mb-3 text-xs text-slate-500">
              {def.description ?? ''} Leave blank if not measured (blank is never saved as zero).
            </p>
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <div>
                <label htmlFor={`${base}-value`} className="block text-sm font-medium text-slate-700">
                  {def.display_name} value
                </label>
                <input
                  id={`${base}-value`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={v.value}
                  onChange={(e) => onChange(def.code, { value: e.target.value })}
                  aria-invalid={err ? true : undefined}
                  aria-describedby={err ? `${base}-err` : `${base}-hint`}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor={`${base}-unit`} className="block text-sm font-medium text-slate-700">
                  Unit
                </label>
                {options.length > 1 || !unitKnown ? (
                  <select
                    id={`${base}-unit`}
                    value={v.unit}
                    onChange={(e) => onChange(def.code, { unit: e.target.value })}
                    className={inputClass}
                  >
                    {options.map((o) => (
                      <option key={o.unit} value={o.unit}>
                        {o.unit}
                        {o.canonical ? ' (canonical)' : ''}
                      </option>
                    ))}
                    {!unitKnown && <option value={v.unit}>{v.unit} (unsupported)</option>}
                  </select>
                ) : (
                  <p id={`${base}-unit`} className="mt-1 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
                    {def.canonical_unit}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-3">
              <label htmlFor={`${base}-location`} className="block text-sm font-medium text-slate-700">
                Measurement location (optional)
              </label>
              <input
                id={`${base}-location`}
                type="text"
                autoComplete="off"
                value={v.location}
                onChange={(e) => onChange(def.code, { location: e.target.value })}
                className={inputClass}
              />
            </div>
            {err && (
              <p id={`${base}-err`} className="mt-2 text-xs text-red-600">
                {err}
              </p>
            )}
          </fieldset>
        )
      })}
    </div>
  )
}
