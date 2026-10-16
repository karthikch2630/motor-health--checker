import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Save } from 'lucide-react'
import FormField, { inputClass } from './FormField'
import Notice from './Notice'
import { validateProfileForm, type ProfileFormErrors, type ProfileFormValues } from '../lib/referenceSchema'
import type { ProfileInput } from '../types/reference'

interface Props {
  initialValues: ProfileFormValues
  /** Existing applicable_specs, so keys this form does not manage survive an edit. */
  existingSpecs?: Record<string, unknown>
  submitLabel: string
  cancelTo: string
  submitting: boolean
  serverError?: string | null
  motorTypeSuggestions?: string[]
  onSubmit: (data: ProfileInput) => void
}

export default function ProfileForm({
  initialValues,
  existingSpecs,
  submitLabel,
  cancelTo,
  submitting,
  serverError,
  motorTypeSuggestions = [],
  onSubmit,
}: Props) {
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState<ProfileFormErrors>({})

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    const result = validateProfileForm(values, existingSpecs)
    if (!result.ok) {
      setErrors(result.errors)
      const first = Object.keys(result.errors)[0]
      if (first) document.getElementById(first)?.focus()
      return
    }
    setErrors({})
    onSubmit(result.data)
  }

  const bind = (key: keyof ProfileFormValues) => ({
    id: key,
    value: values[key],
    onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value })),
    'aria-invalid': errors[key] ? (true as const) : undefined,
    'aria-describedby': errors[key] ? `${key}-msg` : undefined,
    className: inputClass,
  })

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-8">
      {serverError && <Notice kind="error">{serverError}</Notice>}
      {Object.keys(errors).length > 0 && (
        <Notice kind="error">Please correct the highlighted fields and submit again.</Notice>
      )}

      <fieldset className="rounded-lg border border-slate-200 bg-white p-5">
        <legend className="px-2 text-sm font-semibold text-slate-800">Profile</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="name" label="Profile name" required error={errors.name}>
            <input type="text" autoComplete="off" {...bind('name')} />
          </FormField>
          <FormField id="version" label="Version" required error={errors.version} hint="Whole number. Name + version must be unique.">
            <input type="text" inputMode="numeric" {...bind('version')} />
          </FormField>
          <FormField
            id="motor_type"
            label="Applicable motor type"
            required
            error={errors.motor_type}
            hint="Must match the motor type text used when registering motors."
          >
            <input type="text" list="profile-motor-types" autoComplete="off" {...bind('motor_type')} />
            <datalist id="profile-motor-types">
              {motorTypeSuggestions.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </FormField>
          <FormField id="description" label="Description" error={errors.description}>
            <input type="text" autoComplete="off" {...bind('description')} />
          </FormField>
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-slate-200 bg-white p-5">
        <legend className="px-2 text-sm font-semibold text-slate-800">Source</legend>
        <p className="mb-4 text-xs text-slate-500">
          Limits must come from manufacturer documentation, an applicable standard or an approved engineering
          procedure. Do not enter values you cannot trace.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="source_name" label="Source" required error={errors.source_name} hint="e.g. the manufacturer, standard or procedure name">
            <input type="text" autoComplete="off" {...bind('source_name')} />
          </FormField>
          <FormField
            id="source_reference"
            label="Source reference"
            error={errors.source_reference}
            hint="Document number, edition/revision, clause or URL. Recommended."
          >
            <input type="text" autoComplete="off" {...bind('source_reference')} />
          </FormField>
          <FormField id="effective_from" label="Effective from" error={errors.effective_from}>
            <input type="date" {...bind('effective_from')} />
          </FormField>
          <FormField id="effective_to" label="Effective to" error={errors.effective_to}>
            <input type="date" {...bind('effective_to')} />
          </FormField>
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-slate-200 bg-white p-5">
        <legend className="px-2 text-sm font-semibold text-slate-800">Applicable motor specifications</legend>
        <p className="mb-4 text-xs text-slate-500">
          Optional. Narrow the profile to motors it really applies to. Blank means “not restricted by this field”.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FormField id="spec_phase_count" label="Number of phases" error={errors.spec_phase_count}>
            <input type="text" inputMode="numeric" {...bind('spec_phase_count')} />
          </FormField>
          <FormField id="spec_frequency" label="Rated frequency (Hz)" error={errors.spec_frequency}>
            <input type="text" inputMode="decimal" {...bind('spec_frequency')} />
          </FormField>
          <FormField id="spec_voltage_min" label="Rated voltage from (V)" error={errors.spec_voltage_min}>
            <input type="text" inputMode="decimal" {...bind('spec_voltage_min')} />
          </FormField>
          <FormField id="spec_voltage_max" label="Rated voltage to (V)" error={errors.spec_voltage_max}>
            <input type="text" inputMode="decimal" {...bind('spec_voltage_max')} />
          </FormField>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="flex items-center gap-2 rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          {submitting ? 'Saving…' : submitLabel}
        </button>
        <Link to={cancelTo} className="rounded-md px-4 py-2 text-sm text-slate-600 hover:bg-slate-200">
          Cancel
        </Link>
      </div>
    </form>
  )
}
