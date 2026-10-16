import { Link, useLocation } from 'react-router-dom'
import { BookMarked, Plus } from 'lucide-react'
import ApprovalBadge from '../components/ApprovalBadge'
import EmptyState from '../components/EmptyState'
import LoadingState from '../components/LoadingState'
import Notice from '../components/Notice'
import PageHeader from '../components/PageHeader'
import MotorCoverageTable from '../components/MotorCoverageTable'
import { useMotors } from '../hooks/useMotors'
import { useParameterDefinitions, useProfiles } from '../hooks/useReference'

export default function ReferenceListPage() {
  const motors = useMotors()
  const { data: profiles, isPending, error, refetch } = useProfiles()
  const defs = useParameterDefinitions()
  const flash = (useLocation().state as { flash?: string } | null)?.flash

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Reference Data"
          subtitle="Reference profiles hold the limits that measurements are compared with. Only approved profiles can support an assessment."
        />
        <Link
          to="/reference/new"
          className="inline-flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-400"
        >
          <Plus className="h-4 w-4" aria-hidden /> New draft profile
        </Link>
      </div>

      {flash && <Notice kind="success">{flash}</Notice>}

      <section aria-labelledby="profiles-heading" className="mb-10">
        <h2 id="profiles-heading" className="mb-3 text-sm font-semibold text-slate-800">
          Reference profiles
        </h2>
        {isPending ? (
          <LoadingState label="Loading reference profiles…" />
        ) : error ? (
          <>
            <Notice kind="error">{error.message}</Notice>
            <button onClick={() => refetch()} className="text-sm font-medium text-amber-700 hover:underline">
              Try again
            </button>
          </>
        ) : profiles.length === 0 ? (
          <EmptyState
            icon={BookMarked}
            title="No reference profiles"
            description="No approved reference data exists, so motor assessments can only report insufficient data. Create a draft profile and add limits from manufacturer documentation, a standard or an approved procedure."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Reference profiles</caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3">Profile</th>
                  <th scope="col" className="px-4 py-3">Version</th>
                  <th scope="col" className="px-4 py-3">Motor type</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Source</th>
                  <th scope="col" className="px-4 py-3">Limits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {profiles.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <th scope="row" className="px-4 py-3 font-medium">
                      <Link to={`/reference/${p.id}`} className="text-slate-900 hover:text-amber-700 hover:underline">
                        {p.name}
                      </Link>
                    </th>
                    <td className="px-4 py-3">v{p.version}</td>
                    <td className="px-4 py-3">{p.motor_type}</td>
                    <td className="px-4 py-3">
                      <ApprovalBadge status={p.approval_status} />
                    </td>
                    <td className="px-4 py-3">{p.source_name}</td>
                    <td className="px-4 py-3">{p.limit_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="coverage-heading" className="mb-10">
        <h2 id="coverage-heading" className="mb-1 text-sm font-semibold text-slate-800">
          Profile availability per motor
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Evaluated for today using each profile's approval status, effective dates and applicable specifications. Draft,
          retired, expired and incompatible profiles are listed with the reason they cannot be used.
        </p>
        {motors.isPending || isPending ? (
          <LoadingState label="Loading motors…" />
        ) : motors.error ? (
          <Notice kind="error">{motors.error.message}</Notice>
        ) : error ? null : motors.data.length === 0 ? (
          <p className="text-sm text-slate-600">No motors are registered.</p>
        ) : (
          <MotorCoverageTable motors={motors.data} profiles={profiles} at={new Date()} />
        )}
      </section>

      <section aria-labelledby="catalog-heading">
        <h2 id="catalog-heading" className="mb-1 text-sm font-semibold text-slate-800">
          Parameter catalog
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Supported parameters and their canonical units. Limits are always recorded in these units. The catalog is
          maintained through database migrations and is read-only here.
        </p>
        {defs.isPending ? (
          <LoadingState label="Loading parameters…" />
        ) : defs.error ? (
          <Notice kind="error">{defs.error.message}</Notice>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Parameter catalog</caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3">Parameter</th>
                  <th scope="col" className="px-4 py-3">Code</th>
                  <th scope="col" className="px-4 py-3">Canonical unit</th>
                  <th scope="col" className="px-4 py-3">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {defs.data.map((d) => (
                  <tr key={d.code}>
                    <th scope="row" className="px-4 py-3 font-medium">{d.display_name}</th>
                    <td className="px-4 py-3 font-mono text-xs">{d.code}</td>
                    <td className="px-4 py-3">{d.canonical_unit}</td>
                    <td className="px-4 py-3 text-slate-600">{d.description ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
