import { DATA_ORIGIN_LABELS, type DataOrigin } from '../lib/dataOrigin'
import { LOAD_CONDITION_LABELS, type LoadCondition } from '../lib/combinedVariation'
import { sortDefinitions } from './MeasurementFields'
import { DASH, formatDateTime } from '../utils/format'
import type { Motor } from '../types/motor'
import type { ParameterDefinition } from '../types/reference'

export interface ReviewReading {
  parameter_code: string
  measured_value: number
  measured_unit: string
  normalized_value: number | null
  normalized_unit: string | null
  measurement_location: string | null
}

interface Props {
  motor: Motor | undefined
  testTimestamp: string
  method: string | null
  operator: string | null
  conditions: string | null
  /** Recorded load condition code (operating_conditions.load_condition), if any. */
  loadCondition?: string | null
  /** Declared origin of the readings (real vs synthetic), if stated. */
  dataOrigin?: DataOrigin | null
  notes: string | null
  definitions: ParameterDefinition[]
  readings: ReviewReading[]
}

/** Read-only summary of exactly what is recorded: original values and units, plus normalized values where converted. */
export default function ReviewPanel({ motor, testTimestamp, method, operator, conditions, loadCondition = null, dataOrigin = null, notes, definitions, readings }: Props) {
  const missing = definitions.filter((d) => !readings.some((r) => r.parameter_code === d.code))
  return (
    <div className="space-y-6">
      <section aria-labelledby="rv-test" className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 id="rv-test" className="mb-4 text-sm font-semibold text-slate-800">Test details</h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Item label="Motor" value={motor ? `${motor.motor_tag} — ${motor.name}` : null} />
          <Item label="Motor type" value={motor?.motor_type ?? null} />
          <Item label="Test date and time" value={formatDateTime(testTimestamp)} />
          <Item label="Measurement method / instrument" value={method} />
          <Item label="Operator" value={operator} />
          <Item
            label="Load during the test (declared)"
            value={loadCondition ? (LOAD_CONDITION_LABELS[loadCondition as LoadCondition] ?? loadCondition) : 'Not recorded'}
          />
          <Item label="Origin of the readings" value={dataOrigin ? DATA_ORIGIN_LABELS[dataOrigin] : 'Not stated'} />
          <Item label="Operating conditions" value={conditions} />
          <Item
            label="Rated specifications (as recorded)"
            value={
              motor
                ? [
                    motor.rated_voltage !== null ? `${motor.rated_voltage} V` : 'voltage not recorded',
                    motor.rated_frequency !== null ? `${motor.rated_frequency} Hz` : 'frequency not recorded',
                    motor.phase_count !== null ? `${motor.phase_count} phase(s)` : 'phases not recorded',
                    motor.supply_type === 'line' ? 'line supply' : motor.supply_type === 'inverter' ? 'inverter-fed' : 'supply type not verified',
                  ].join(' · ')
                : null
            }
          />
          <div className="sm:col-span-2 lg:col-span-3">
            <Item label="Notes" value={notes} />
          </div>
        </dl>
      </section>

      <section aria-labelledby="rv-readings">
        <h2 id="rv-readings" className="mb-3 text-sm font-semibold text-slate-800">Measurements</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Measurements recorded for this test</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3">Parameter</th>
                <th scope="col" className="px-4 py-3">Measured value</th>
                <th scope="col" className="px-4 py-3">Normalized (canonical unit)</th>
                <th scope="col" className="px-4 py-3">Location</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortDefinitions(definitions).map((d) => {
                const r = readings.find((x) => x.parameter_code === d.code)
                return (
                  <tr key={d.code}>
                    <th scope="row" className="px-4 py-3 font-medium">{d.display_name}</th>
                    {r ? (
                      <>
                        <td className="px-4 py-3">{r.measured_value} {r.measured_unit}</td>
                        <td className="px-4 py-3">
                          {r.normalized_value === null ? DASH : `${r.normalized_value} ${r.normalized_unit ?? ''}`}
                        </td>
                        <td className="px-4 py-3">{r.measurement_location ?? DASH}</td>
                      </>
                    ) : (
                      <td colSpan={3} className="px-4 py-3 text-slate-500">Not measured</td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {missing.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            Not measured: {missing.map((d) => d.display_name).join(', ')}. Missing readings are never treated as zero or as
            normal; an assessment that needs them will report insufficient data.
          </p>
        )}
      </section>
    </div>
  )
}

function Item({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-sm text-slate-900">{value && value !== '' ? value : DASH}</dd>
    </div>
  )
}
