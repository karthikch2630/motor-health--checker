import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, Loader2, Pencil, Save, Send } from 'lucide-react'
import FormField, { inputClass } from './FormField'
import MeasurementFields from './MeasurementFields'
import Notice from './Notice'
import ReferencePanel from './ReferencePanel'
import ReviewPanel from './ReviewPanel'
import { useSaveAndSubmit, useSaveDraft } from '../hooks/useTests'
import { useSingleFlight } from '../hooks/useSingleFlight'
import { validateReadings } from '../lib/measurements'
import { newTestForm, testToFormValues, validateSessionMeta, type TestFormValues, type TestMetaErrors } from '../lib/testForm'
import { PartialSaveError, type SaveDraftInput } from '../lib/tests'
import { LOAD_CONDITIONS, LOAD_CONDITION_LABELS } from '../lib/combinedVariation'
import { DATA_ORIGINS, DATA_ORIGIN_LABELS, dataOriginOf } from '../lib/dataOrigin'
import type { Motor } from '../types/motor'
import type { ParameterDefinition, ReferenceProfileWithCount } from '../types/reference'
import type { SessionWithReadings } from '../types/test'

interface Props {
  motors: Motor[]
  definitions: ParameterDefinition[]
  profiles: ReferenceProfileWithCount[] | undefined
  profilesLoading: boolean
  profilesError?: string | null
  /** Present when continuing an existing draft. */
  existing?: SessionWithReadings
  defaultMotorId?: string
}

/** Draft entry form with a review step. Submitting is only possible from the review step. */
export default function TestEditor({
  motors,
  definitions,
  profiles,
  profilesLoading,
  profilesError,
  existing,
  defaultMotorId,
}: Props) {
  const navigate = useNavigate()
  const [values, setValues] = useState<TestFormValues>(() =>
    existing ? testToFormValues(existing.session, existing.readings, definitions) : newTestForm(definitions, defaultMotorId),
  )
  const [step, setStep] = useState<'edit' | 'review'>('edit')
  const [metaErrors, setMetaErrors] = useState<TestMetaErrors>({})
  const [readingErrors, setReadingErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // The draft this form is bound to. Set after the first successful (or partially successful) save so that
  // every retry UPDATES the same draft instead of creating a duplicate.
  const [sessionId, setSessionId] = useState<string | null>(existing?.session.id ?? null)
  const [reviewInput, setReviewInput] = useState<SaveDraftInput | null>(null)

  const flight = useSingleFlight()
  const save = useSaveDraft()
  const submit = useSaveAndSubmit()
  const busy = save.isPending || submit.isPending
  const motor = motors.find((m) => m.id === values.motor_id)
  const when = useMemo(() => {
    const d = new Date(values.timestamp)
    return Number.isNaN(d.getTime()) ? null : d
  }, [values.timestamp])

  const setField = <K extends keyof TestFormValues>(key: K, value: TestFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setNotice(null)
  }

  /** Validates everything; returns the payload to save, or null after showing errors. */
  function buildInput(requireReadings: boolean): SaveDraftInput | null {
    setFormError(null)
    const meta = validateSessionMeta(values, existing?.session.operating_conditions)
    const rd = validateReadings(values.readings, definitions)
    setMetaErrors(meta.ok ? {} : meta.errors)
    setReadingErrors(rd.ok ? {} : rd.errors)
    if (!meta.ok || !rd.ok) {
      const firstMeta = meta.ok ? undefined : Object.keys(meta.errors)[0]
      const firstReading = rd.ok ? undefined : Object.keys(rd.errors)[0]
      document.getElementById(firstMeta ?? `reading-${firstReading}-value`)?.focus()
      return null
    }
    if (requireReadings && rd.readings.length === 0) {
      setFormError('Enter at least one measurement before reviewing. A test with no readings cannot be submitted.')
      return null
    }
    return {
      sessionId,
      session: meta.data,
      readings: rd.readings,
      allParameterCodes: definitions.map((d) => d.code),
    }
  }

  function onError(error: Error) {
    // A partial failure still created the draft: remember it so a retry updates it.
    if (error instanceof PartialSaveError) setSessionId(error.sessionId)
  }

  function handleSave(e?: FormEvent) {
    e?.preventDefault()
    if (busy) return
    const input = buildInput(false)
    if (!input || !flight.start()) return
    setNotice(null)
    save.mutate(input, {
      onSettled: flight.done,
      onError,
      onSuccess: (id) => {
        setSessionId(id)
        if (existing) setNotice('Draft saved.')
        else navigate(`/tests/${id}`, { replace: true, state: { flash: 'Draft saved. You can continue editing it later.' } })
      },
    })
  }

  function handleReview() {
    if (busy) return
    const input = buildInput(true)
    if (!input) return
    save.reset()
    submit.reset()
    setReviewInput(input)
    setStep('review')
    window.scrollTo?.({ top: 0 })
  }

  function handleSubmit() {
    if (busy || !reviewInput || !flight.start()) return
    // Use the latest session id: a failed earlier attempt may have created the draft.
    submit.mutate(
      { ...reviewInput, sessionId },
      {
        onSettled: flight.done,
        onError,
        onSuccess: ({ session, alreadySubmitted }) =>
          navigate(`/tests/${session.id}`, {
            replace: true,
            state: {
              flash: alreadySubmitted
                ? 'This test had already been submitted; nothing was changed.'
                : 'Test submitted. It is recorded and waiting for assessment.',
            },
          }),
      },
    )
  }

  if (step === 'review' && reviewInput) {
    const op = reviewInput.session.operating_conditions
    return (
      <div className="space-y-6">
        <Notice kind="success">
          Review the test below. After you submit, it can no longer be edited here.
        </Notice>
        <ReviewPanel
          motor={motor}
          testTimestamp={reviewInput.session.test_timestamp}
          method={reviewInput.session.measurement_method}
          operator={typeof op.operator === 'string' ? op.operator : null}
          conditions={typeof op.description === 'string' ? op.description : null}
          loadCondition={typeof op.load_condition === 'string' ? op.load_condition : null}
          dataOrigin={dataOriginOf(op)}
          notes={reviewInput.session.notes}
          definitions={definitions}
          readings={reviewInput.readings}
        />
        <ReferencePanel motor={motor} testTime={when} profiles={profiles} loading={profilesLoading} error={profilesError} />
        {submit.error && <Notice kind="error">{submit.error.message}</Notice>}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleSubmit}
            disabled={busy}
            className="flex items-center gap-2 rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            {submit.isPending ? 'Submitting…' : 'Submit test'}
          </button>
          <button
            onClick={() => setStep('edit')}
            disabled={busy}
            className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <Pencil className="h-4 w-4" aria-hidden /> Back to editing
          </button>
        </div>
      </div>
    )
  }

  const err = (key: keyof TestMetaErrors) => ({
    'aria-invalid': metaErrors[key] ? (true as const) : undefined,
    'aria-describedby': metaErrors[key] ? `${key}-msg` : undefined,
  })

  return (
    <form onSubmit={handleSave} noValidate className="space-y-8">
      {notice && <Notice kind="success">{notice}</Notice>}
      {save.error && <Notice kind="error">{save.error.message}</Notice>}
      {formError && <Notice kind="error">{formError}</Notice>}
      {(Object.keys(metaErrors).length > 0 || Object.keys(readingErrors).length > 0) && (
        <Notice kind="error">Please correct the highlighted fields.</Notice>
      )}

      <fieldset className="rounded-lg border border-slate-200 bg-white p-5">
        <legend className="px-2 text-sm font-semibold text-slate-800">Test details</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="motor_id"
            label="Motor"
            required
            error={metaErrors.motor_id}
            hint={sessionId ? 'The motor cannot be changed once a draft has been saved.' : undefined}
          >
            <select
              id="motor_id"
              value={values.motor_id}
              onChange={(e) => setField('motor_id', e.target.value)}
              disabled={sessionId !== null}
              className={inputClass}
              {...err('motor_id')}
            >
              <option value="">Select a motor…</option>
              {motors.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.motor_tag} — {m.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="timestamp" label="Test date and time" required error={metaErrors.timestamp}>
            <input id="timestamp" type="datetime-local" value={values.timestamp} onChange={(e) => setField('timestamp', e.target.value)} className={inputClass} {...err('timestamp')} />
          </FormField>
          <FormField id="measurement_method" label="Measurement method / instrument" error={metaErrors.measurement_method}>
            <input id="measurement_method" type="text" autoComplete="off" value={values.measurement_method} onChange={(e) => setField('measurement_method', e.target.value)} className={inputClass} {...err('measurement_method')} />
          </FormField>
          <FormField id="operator" label="Operator" error={metaErrors.operator} hint="Who took the measurements.">
            <input id="operator" type="text" autoComplete="off" value={values.operator} onChange={(e) => setField('operator', e.target.value)} className={inputClass} {...err('operator')} />
          </FormField>
          <FormField
            id="load_condition"
            label="Load during the test"
            error={metaErrors.load_condition}
            hint="Declared by the operator, not measured by this app. Some reference checks apply only at rated load; if left blank they are reported as not assessed."
            className="sm:col-span-2"
          >
            <select id="load_condition" value={values.load_condition} onChange={(e) => setField('load_condition', e.target.value)} className={inputClass} {...err('load_condition')}>
              <option value="">Not recorded</option>
              {LOAD_CONDITIONS.map((c) => (
                <option key={c} value={c}>{LOAD_CONDITION_LABELS[c]}</option>
              ))}
            </select>
          </FormField>
          <FormField
            id="data_origin"
            label="Origin of these readings"
            error={metaErrors.data_origin}
            hint="State whether the values come from a real instrument or are synthetic/demo values. Synthetic values are not engineering evidence."
            className="sm:col-span-2"
          >
            <select id="data_origin" value={values.data_origin} onChange={(e) => setField('data_origin', e.target.value)} className={inputClass} {...err('data_origin')}>
              <option value="">Not stated</option>
              {DATA_ORIGINS.map((o) => (
                <option key={o} value={o}>{DATA_ORIGIN_LABELS[o]}</option>
              ))}
            </select>
          </FormField>
          <FormField id="conditions" label="Operating conditions" error={metaErrors.conditions} hint="e.g. load and ambient conditions during the test, as observed." className="sm:col-span-2">
            <input id="conditions" type="text" autoComplete="off" value={values.conditions} onChange={(e) => setField('conditions', e.target.value)} className={inputClass} {...err('conditions')} />
          </FormField>
          <FormField id="notes" label="Notes" error={metaErrors.notes} className="sm:col-span-2">
            <textarea id="notes" rows={3} value={values.notes} onChange={(e) => setField('notes', e.target.value)} className={inputClass} {...err('notes')} />
          </FormField>
        </div>
        {motor && (
          <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <strong>{motor.motor_tag}</strong> · {motor.motor_type}
            {motor.rated_voltage !== null && ` · ${motor.rated_voltage} V`}
            {motor.rated_current !== null && ` · ${motor.rated_current} A`}
            {motor.rated_rpm !== null && ` · ${motor.rated_rpm} RPM`}
            {motor.rated_frequency !== null && ` · ${motor.rated_frequency} Hz`}
            {motor.phase_count !== null && ` · ${motor.phase_count} phase(s)`}
            {motor.manufacturer && ` · ${motor.manufacturer}`}
          </p>
        )}
      </fieldset>

      <ReferencePanel motor={motor} testTime={when} profiles={profiles} loading={profilesLoading} error={profilesError} />

      <section aria-labelledby="measurements">
        <h2 id="measurements" className="mb-1 text-sm font-semibold text-slate-800">Measurements</h2>
        <p className="mb-3 text-xs text-slate-500">
          Enter the value exactly as read and pick the unit you used; values in supported units are converted to the
          canonical unit for comparison, and the original value and unit are kept. Only one reading per parameter per
          test can be recorded, so per-phase readings (needed later for imbalance checks) cannot be stored yet.
        </p>
        <MeasurementFields
          definitions={definitions}
          values={values.readings}
          errors={readingErrors}
          disabled={busy}
          onChange={(code, patch) => {
            setNotice(null)
            setValues((v) => ({ ...v, readings: { ...v.readings, [code]: { ...v.readings[code], ...patch } } }))
          }}
        />
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          {save.isPending ? 'Saving…' : 'Save draft'}
        </button>
        <button
          type="button"
          onClick={handleReview}
          disabled={busy}
          className="flex items-center gap-2 rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Eye className="h-4 w-4" aria-hidden /> Review and submit
        </button>
        <Link to="/history" className="rounded-md px-4 py-2 text-sm text-slate-600 hover:bg-slate-200">
          Cancel
        </Link>
      </div>
    </form>
  )
}
