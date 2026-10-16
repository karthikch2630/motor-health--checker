import { Link, useLocation, useParams } from 'react-router-dom'
import { ArrowLeft, ClipboardPlus, Pencil } from 'lucide-react'
import MotorHistory from '../components/MotorHistory'
import LoadingState from '../components/LoadingState'
import Notice from '../components/Notice'
import PageHeader from '../components/PageHeader'
import { useMotor } from '../hooks/useMotors'
import { DASH, formatDateTime, formatPower, formatWithUnit } from '../utils/format'

function Spec({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value === null || value === '' ? DASH : value}</dd>
    </div>
  )
}

export default function MotorDetailPage() {
  const { id } = useParams()
  const flash = (useLocation().state as { flash?: string } | null)?.flash
  const { data: motor, isPending, error, refetch } = useMotor(id)

  const back = (
    <Link to="/motors" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-amber-700">
      <ArrowLeft className="h-4 w-4" aria-hidden /> All motors
    </Link>
  )

  if (isPending) return <LoadingState label="Loading motor…" />
  if (error) {
    return (
      <>
        {back}
        <Notice kind="error">{error.message}</Notice>
        <button onClick={() => refetch()} className="text-sm font-medium text-amber-700 hover:underline">
          Try again
        </button>
      </>
    )
  }
  if (!motor) {
    return (
      <>
        {back}
        <Notice kind="error">This motor was not found.</Notice>
      </>
    )
  }

  return (
    <>
      {back}
      {flash && <Notice kind="success">{flash}</Notice>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title={`${motor.motor_tag} — ${motor.name}`} subtitle={motor.motor_type} />
        <div className="flex flex-wrap gap-2">
        <Link
          to={`/tests/new?motor=${motor.id}`}
          className="inline-flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-400"
        >
          <ClipboardPlus className="h-4 w-4" aria-hidden /> New test
        </Link>
        <Link
          to={`/motors/${motor.id}/edit`}
          className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <Pencil className="h-4 w-4" aria-hidden /> Edit
        </Link>
        </div>
      </div>

      <div className="space-y-6">
        <section aria-labelledby="ident" className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 id="ident" className="mb-4 text-sm font-semibold text-slate-800">Identification</h2>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Spec label="Manufacturer" value={motor.manufacturer} />
            <Spec label="Model" value={motor.model} />
            <Spec label="Serial number" value={motor.serial_number} />
            <Spec label="Location" value={motor.location} />
          </dl>
        </section>

        <section aria-labelledby="ratings" className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 id="ratings" className="mb-4 text-sm font-semibold text-slate-800">Rated specifications</h2>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Spec label="Rated voltage" value={formatWithUnit(motor.rated_voltage, 'V')} />
            <Spec label="Rated current" value={formatWithUnit(motor.rated_current, 'A')} />
            <Spec label="Rated power" value={formatPower(motor.rated_power, motor.power_unit)} />
            <Spec label="Rated frequency" value={formatWithUnit(motor.rated_frequency, 'Hz')} />
            <Spec label="Rated speed" value={formatWithUnit(motor.rated_rpm, 'RPM')} />
            <Spec label="Phases" value={motor.phase_count} />
            <Spec label="Supply" value={motor.supply_type === 'line' ? 'Fixed-frequency line supply' : motor.supply_type === 'inverter' ? 'Inverter / VFD' : null} />
          </dl>
        </section>

        {motor.notes && (
          <section aria-labelledby="notes" className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 id="notes" className="mb-2 text-sm font-semibold text-slate-800">Notes</h2>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{motor.notes}</p>
          </section>
        )}

        <MotorHistory motorId={motor.id} />

        <p className="text-xs text-slate-500">
          Registered {formatDateTime(motor.created_at)} · Last updated {formatDateTime(motor.updated_at)}
        </p>
      </div>
    </>
  )
}
