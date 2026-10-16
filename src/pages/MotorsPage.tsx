import { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Pencil, Plus, Search, Settings2 } from 'lucide-react'
import EmptyState from '../components/EmptyState'
import LoadingState from '../components/LoadingState'
import Notice from '../components/Notice'
import PageHeader from '../components/PageHeader'
import { inputClass } from '../components/FormField'
import { useMotors } from '../hooks/useMotors'
import { filterMotors, motorTypes } from '../lib/motorFilters'
import { formatPower } from '../utils/format'

const addButtonClass =
  'inline-flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-400'

export default function MotorsPage() {
  const { data: motors, isPending, error, refetch } = useMotors()
  const flash = (useLocation().state as { flash?: string } | null)?.flash
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')

  const types = useMemo(() => motorTypes(motors ?? []), [motors])
  const visible = useMemo(() => filterMotors(motors ?? [], search, type), [motors, search, type])

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Motors" subtitle="Registered motors and their specifications." />
        <Link to="/motors/new" className={addButtonClass}>
          <Plus className="h-4 w-4" aria-hidden /> Add motor
        </Link>
      </div>

      {flash && <Notice kind="success">{flash}</Notice>}

      {isPending ? (
        <LoadingState label="Loading motors…" />
      ) : error ? (
        <>
          <Notice kind="error">{error.message}</Notice>
          <button onClick={() => refetch()} className="text-sm font-medium text-amber-700 hover:underline">
            Try again
          </button>
        </>
      ) : motors.length === 0 ? (
        <EmptyState
          icon={Settings2}
          title="No motors registered"
          description="Register your first motor to start recording tests. You will need its nameplate details."
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-3">
            <div className="relative min-w-60 flex-1">
              <label htmlFor="motor-search" className="sr-only">
                Search motors
              </label>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                id="motor-search"
                type="search"
                placeholder="Search tag, name, manufacturer, model, serial, location"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`${inputClass} !mt-0 pl-9`}
              />
            </div>
            <div>
              <label htmlFor="motor-type-filter" className="sr-only">
                Filter by motor type
              </label>
              <select
                id="motor-type-filter"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className={`${inputClass} !mt-0`}
              >
                <option value="">All motor types</option>
                {types.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No motors match"
              description="Try a different search term or clear the motor type filter."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Registered motors</caption>
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-3">Tag</th>
                    <th scope="col" className="px-4 py-3">Name</th>
                    <th scope="col" className="px-4 py-3">Type</th>
                    <th scope="col" className="px-4 py-3">Manufacturer</th>
                    <th scope="col" className="px-4 py-3">Rated power</th>
                    <th scope="col" className="px-4 py-3">Location</th>
                    <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visible.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <th scope="row" className="px-4 py-3 font-medium">
                        <Link to={`/motors/${m.id}`} className="text-slate-900 hover:text-amber-700 hover:underline">
                          {m.motor_tag}
                        </Link>
                      </th>
                      <td className="px-4 py-3">{m.name}</td>
                      <td className="px-4 py-3">{m.motor_type}</td>
                      <td className="px-4 py-3">{m.manufacturer ?? '—'}</td>
                      <td className="px-4 py-3">{formatPower(m.rated_power, m.power_unit)}</td>
                      <td className="px-4 py-3">{m.location ?? '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={`/motors/${m.id}/edit`}
                          className="inline-flex items-center gap-1 text-slate-600 hover:text-amber-700"
                          aria-label={`Edit ${m.motor_tag}`}
                        >
                          <Pencil className="h-4 w-4" aria-hidden /> Edit
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-slate-500">
            Showing {visible.length} of {motors.length} motors.
          </p>
        </>
      )}
    </>
  )
}
