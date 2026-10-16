import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Save } from 'lucide-react'
import FormField, { inputClass } from './FormField'
import Notice from './Notice'
import {
  validateMotorForm,
  type MotorFormErrors,
  type MotorFormValues,
} from '../lib/motorSchema'
import type { MotorInput } from '../types/motor'

interface Props {
  initialValues: MotorFormValues
  submitLabel: string
  cancelTo: string
  submitting: boolean
  /** Error from the database operation, shown above the form. */
  serverError?: string | null
  /** Existing motor types, offered as suggestions (free text is still allowed). */
  typeSuggestions?: string[]
  onSubmit: (data: MotorInput) => void
}

export default function MotorForm({
  initialValues,
  submitLabel,
  cancelTo,
  submitting,
  serverError,
  typeSuggestions = [],
  onSubmit,
}: Props) {
  const [values, setValues] = useState<MotorFormValues>(initialValues)
  const [errors, setErrors] = useState<MotorFormErrors>({})

  const set = <K extends keyof MotorFormValues>(key: K, value: MotorFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }))

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    const result = validateMotorForm(values)
    if (!result.ok) {
      setErrors(result.errors)
      const first = Object.keys(result.errors)[0]
      if (first) document.getElementById(first)?.focus()
      return
    }
    setErrors({})
    onSubmit(result.data)
  }

  /** Common props for a text-like control bound to a form key. */
  const bind = (key: keyof MotorFormValues) => ({
    id: key,
    value: values[key],
    onChange: (e: { target: { value: string } }) => set(key, e.target.value as never),
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
        <legend className="px-2 text-sm font-semibold text-slate-800">Identification</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="motor_tag" label="Motor ID / equipment tag" required error={errors.motor_tag}>
            <input type="text" autoComplete="off" {...bind('motor_tag')} />
          </FormField>
          <FormField id="name" label="Motor name" required error={errors.name}>
            <input type="text" autoComplete="off" {...bind('name')} />
          </FormField>
          <FormField
            id="motor_type"
            label="Motor type"
            required
            error={errors.motor_type}
            hint="Reference profiles are matched by motor type, so use consistent wording."
          >
            <input type="text" list="motor-type-options" autoComplete="off" {...bind('motor_type')} />
            <datalist id="motor-type-options">
              {typeSuggestions.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </FormField>
          <FormField id="location" label="Installation location" error={errors.location}>
            <input type="text" autoComplete="off" {...bind('location')} />
          </FormField>
          <FormField id="manufacturer" label="Manufacturer" error={errors.manufacturer}>
            <input type="text" autoComplete="off" {...bind('manufacturer')} />
          </FormField>
          <FormField id="model" label="Model" error={errors.model}>
            <input type="text" autoComplete="off" {...bind('model')} />
          </FormField>
          <FormField id="serial_number" label="Serial number" error={errors.serial_number}>
            <input type="text" autoComplete="off" {...bind('serial_number')} />
          </FormField>
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-slate-200 bg-white p-5">
        <legend className="px-2 text-sm font-semibold text-slate-800">Rated specifications</legend>
        <p className="mb-4 text-xs text-slate-500">
          Optional. Enter values from the nameplate; leave blank if unknown. Blank is stored as “not specified”,
          never as zero.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormField id="rated_voltage" label="Rated voltage (V)" error={errors.rated_voltage}>
            <input type="text" inputMode="decimal" {...bind('rated_voltage')} />
          </FormField>
          <FormField id="rated_current" label="Rated current (A)" error={errors.rated_current}>
            <input type="text" inputMode="decimal" {...bind('rated_current')} />
          </FormField>
          <FormField id="rated_frequency" label="Rated frequency (Hz)" error={errors.rated_frequency}>
            <input type="text" inputMode="decimal" {...bind('rated_frequency')} />
          </FormField>
          <FormField id="rated_power" label="Rated power" error={errors.rated_power}>
            <input type="text" inputMode="decimal" {...bind('rated_power')} />
          </FormField>
          <FormField id="power_unit" label="Power unit" error={errors.power_unit}>
            <select {...bind('power_unit')}>
              <option value="">—</option>
              <option value="W">W</option>
              <option value="kW">kW</option>
            </select>
          </FormField>
          <FormField id="rated_rpm" label="Rated speed (RPM)" error={errors.rated_rpm}>
            <input type="text" inputMode="numeric" {...bind('rated_rpm')} />
          </FormField>
          <FormField id="phase_count" label="Number of phases" error={errors.phase_count}>
            <input type="text" inputMode="numeric" {...bind('phase_count')} />
          </FormField>
          <FormField
            id="supply_type"
            label="Supply to the motor"
            error={errors.supply_type}
            hint="Leave blank if not verified. Reference profiles for a fixed-frequency line supply are not applied to a motor whose supply is unknown or inverter-fed."
          >
            <select {...bind('supply_type')}>
              <option value="">Not specified</option>
              <option value="line">Fixed-frequency line supply (not drive-fed)</option>
              <option value="inverter">Inverter / variable-frequency drive</option>
            </select>
          </FormField>
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-slate-200 bg-white p-5">
        <legend className="px-2 text-sm font-semibold text-slate-800">Notes</legend>
        <FormField id="notes" label="Additional information" error={errors.notes}>
          <textarea rows={4} {...bind('notes')} />
        </FormField>
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
