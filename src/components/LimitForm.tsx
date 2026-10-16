import { useState, type FormEvent } from 'react'
import { Loader2, Save } from 'lucide-react'
import FormField, { inputClass } from './FormField'
import Notice from './Notice'
import {
  validateLimitForm,
  type LimitFormErrors,
  type LimitFormValues,
} from '../lib/referenceSchema'
import type { LimitInput, ParameterDefinition } from '../types/reference'

interface Props {
  initialValues: LimitFormValues
  existingConditions?: Record<string, unknown>
  definitions: ParameterDefinition[]
  /** Parameters that may be chosen (already-used ones are excluded when adding). */
  selectableCodes: string[]
  /** Editing keeps the parameter fixed. */
  lockParameter: boolean
  submitting: boolean
  serverError?: string | null
  onSubmit: (data: LimitInput) => void
  onCancel: () => void
}

export default function LimitForm({
  initialValues,
  existingConditions,
  definitions,
  selectableCodes,
  lockParameter,
  submitting,
  serverError,
  onSubmit,
  onCancel,
}: Props) {
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState<LimitFormErrors>({})
  const def = definitions.find((d) => d.code === values.parameter_code)
  const unit = def ? ` (${def.canonical_unit})` : ''

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    const result = validateLimitForm(values, definitions, existingConditions)
    if (!result.ok) {
      setErrors(result.errors)
      const first = Object.keys(result.errors).find((k) => k !== 'thresholds')
      if (first) document.getElementById(first)?.focus()
      return
    }
    setErrors({})
    onSubmit(result.data)
  }

  const bind = (key: keyof LimitFormValues) => ({
    id: key,
    value: values[key],
    onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value })),
    'aria-invalid': errors[key] ? (true as const) : undefined,
    'aria-describedby': errors[key] ? `${key}-msg` : undefined,
    className: inputClass,
  })

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label={lockParameter ? 'Edit limit' : 'Add limit'}
      className="rounded-lg border border-amber-300 bg-amber-50/40 p-5"
    >
      <h3 className="mb-4 text-sm font-semibold text-slate-800">{lockParameter ? 'Edit limit' : 'Add limit'}</h3>
      {serverError && <Notice kind="error">{serverError}</Notice>}
      {errors.thresholds && <Notice kind="error">{errors.thresholds}</Notice>}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="parameter_code" label="Parameter" required error={errors.parameter_code}>
          <select {...bind('parameter_code')} disabled={lockParameter}>
            <option value="">Select a parameter…</option>
            {definitions
              .filter((d) => selectableCodes.includes(d.code) || d.code === values.parameter_code)
              .map((d) => (
                <option key={d.code} value={d.code}>
                  {d.display_name} ({d.canonical_unit})
                </option>
              ))}
          </select>
        </FormField>
        <div className="text-sm text-slate-600">
          {def ? (
            <>
              <p className="font-medium text-slate-700">Unit: {def.canonical_unit}</p>
              <p className="mt-1 text-xs">{def.description}</p>
              <p className="mt-1 text-xs">Limits are always recorded in the canonical unit; convert values from your source first.</p>
            </>
          ) : (
            <p className="text-xs">Choose a parameter to see its unit and description.</p>
          )}
        </div>

        <FormField id="lower_limit" label={`Lower limit${unit}`} error={errors.lower_limit}>
          <input type="text" inputMode="decimal" {...bind('lower_limit')} />
        </FormField>
        <FormField id="upper_limit" label={`Upper limit${unit}`} error={errors.upper_limit}>
          <input type="text" inputMode="decimal" {...bind('upper_limit')} />
        </FormField>
        <FormField id="warning_lower" label={`Lower warning threshold${unit}`} error={errors.warning_lower}>
          <input type="text" inputMode="decimal" {...bind('warning_lower')} />
        </FormField>
        <FormField id="warning_upper" label={`Upper warning threshold${unit}`} error={errors.warning_upper}>
          <input type="text" inputMode="decimal" {...bind('warning_upper')} />
        </FormField>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Enter only values given by your source. Blank means “not specified” — not zero and not unlimited. How limits
        and warning thresholds are interpreted is defined by the diagnostic rules (a later phase).
      </p>

      <div className="mt-4 grid gap-4">
        <FormField
          id="conditions"
          label="Applicable operating conditions"
          error={errors.conditions}
          hint="e.g. load level, ambient temperature, measurement location or method, if the source specifies them."
        >
          <input type="text" autoComplete="off" {...bind('conditions')} />
        </FormField>
        <FormField
          id="source_note"
          label="Source note"
          required
          error={errors.source_note}
          hint="Where exactly this value comes from (table, clause, page)."
        >
          <textarea rows={2} {...bind('source_note')} />
        </FormField>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="flex items-center gap-2 rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          {submitting ? 'Saving…' : lockParameter ? 'Save limit' : 'Add limit'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md px-4 py-2 text-sm text-slate-600 hover:bg-slate-200">
          Cancel
        </button>
      </div>
    </form>
  )
}
