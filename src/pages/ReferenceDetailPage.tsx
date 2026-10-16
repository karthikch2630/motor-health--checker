import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CircleCheck, CopyPlus, Pencil, Plus, TriangleAlert, Trash2, Archive } from 'lucide-react'
import ApprovalBadge from '../components/ApprovalBadge'
import ConfirmDialog from '../components/ConfirmDialog'
import EmptyState from '../components/EmptyState'
import LimitForm from '../components/LimitForm'
import LoadingState from '../components/LoadingState'
import Notice from '../components/Notice'
import PageHeader from '../components/PageHeader'
import {
  useAddLimit,
  useApproveProfile,
  useCreateNextVersion,
  useDeleteLimit,
  useParameterDefinitions,
  useProfile,
  useProfiles,
  useRetireProfile,
  useUpdateLimit,
} from '../hooks/useReference'
import {
  assessApprovalReadiness,
  describeSpecs,
  EMPTY_LIMIT_FORM,
  limitToFormValues,
} from '../lib/referenceSchema'
import { formatDateTime } from '../utils/format'
import type { ReferenceLimit } from '../types/reference'

const num = (n: number | null) => (n === null ? <span className="text-slate-400">not set</span> : n)
const dateOnly = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—')

type Dialog = null | 'approve' | 'retire' | 'version' | { deleteLimit: ReferenceLimit }
type Editor = null | 'new' | ReferenceLimit

export default function ReferenceDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const flash = (useLocation().state as { flash?: string } | null)?.flash
  const { data: profile, isPending, error, refetch } = useProfile(id)
  const all = useProfiles()
  const defs = useParameterDefinitions()

  const approve = useApproveProfile(id ?? '')
  const retire = useRetireProfile()
  const nextVersion = useCreateNextVersion()
  const addLimit = useAddLimit(id ?? '')
  const updateLimit = useUpdateLimit()
  const deleteLimit = useDeleteLimit()

  const [dialog, setDialog] = useState<Dialog>(null)
  const [editor, setEditor] = useState<Editor>(null)
  const [message, setMessage] = useState<string | null>(null)

  const back = (
    <Link to="/reference" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-amber-700">
      <ArrowLeft className="h-4 w-4" aria-hidden /> All reference profiles
    </Link>
  )

  if (isPending || defs.isPending) return <LoadingState label="Loading profile…" />
  const loadError = error ?? defs.error
  if (loadError) {
    return (
      <>
        {back}
        <Notice kind="error">{loadError.message}</Notice>
        <button onClick={() => refetch()} className="text-sm font-medium text-amber-700 hover:underline">
          Try again
        </button>
      </>
    )
  }
  if (!profile) {
    return (
      <>
        {back}
        <Notice kind="error">This reference profile was not found.</Notice>
      </>
    )
  }

  const isDraft = profile.approval_status === 'draft'
  const definitions = defs.data ?? []
  const readiness = assessApprovalReadiness(profile, profile.limits, definitions)
  const usedCodes = profile.limits.map((l) => l.parameter_code)
  const selectableCodes = definitions.map((d) => d.code).filter((c) => !usedCodes.includes(c))
  const specs = describeSpecs(profile.applicable_specs)

  function closeDialog() {
    setDialog(null)
    approve.reset()
    retire.reset()
    nextVersion.reset()
    deleteLimit.reset()
  }

  function closeEditor() {
    setEditor(null)
    addLimit.reset()
    updateLimit.reset()
  }

  const dialogBusy = approve.isPending || retire.isPending || nextVersion.isPending || deleteLimit.isPending

  return (
    <>
      {back}
      {flash && <Notice kind="success">{flash}</Notice>}
      {message && <Notice kind="success">{message}</Notice>}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title={`${profile.name} — v${profile.version}`} subtitle={`Reference profile for ${profile.motor_type}`} />
        <div className="flex flex-wrap items-center gap-2">
          <ApprovalBadge status={profile.approval_status} />
          {isDraft && (
            <Link
              to={`/reference/${profile.id}/edit`}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Pencil className="h-4 w-4" aria-hidden /> Edit
            </Link>
          )}
          {isDraft && (
            <button
              onClick={() => setDialog('approve')}
              disabled={readiness.blockers.length > 0}
              title={readiness.blockers.length > 0 ? 'Resolve the items under "Before approval" first' : undefined}
              className="inline-flex items-center gap-2 rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CircleCheck className="h-4 w-4" aria-hidden /> Approve…
            </button>
          )}
          {profile.approval_status === 'approved' && (
            <button
              onClick={() => setDialog('retire')}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Archive className="h-4 w-4" aria-hidden /> Retire…
            </button>
          )}
          {!isDraft && (
            <button
              onClick={() => setDialog('version')}
              className="inline-flex items-center gap-2 rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-slate-900 hover:bg-amber-400"
            >
              <CopyPlus className="h-4 w-4" aria-hidden /> Create new version…
            </button>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {isDraft ? (
          <Notice kind="error">
            This profile is a <strong>draft</strong> and cannot be used for assessments until it is approved.
          </Notice>
        ) : (
          <p className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            {profile.approval_status === 'approved'
              ? 'Approved profiles and their limits are immutable. To change a limit, create a new version.'
              : 'This profile is retired. It is kept so previous assessments stay traceable; it cannot be changed or used for new assessments.'}
          </p>
        )}

        <section aria-labelledby="meta" className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 id="meta" className="mb-4 text-sm font-semibold text-slate-800">Details</h2>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Meta label="Source" value={profile.source_name} />
            <Meta label="Source reference" value={profile.source_reference} />
            <Meta label="Profile version" value={`v${profile.version}`} />
            <Meta label="Effective from" value={dateOnly(profile.effective_from)} />
            <Meta label="Effective to" value={dateOnly(profile.effective_to)} />
            <Meta label="Created" value={formatDateTime(profile.created_at)} />
            <Meta label="Description" value={profile.description} />
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-wide text-slate-500">Applicable motor specifications</dt>
              <dd className="mt-0.5 text-sm text-slate-900">
                {specs.length > 0 ? specs.join(' · ') : 'None recorded (motor type text only)'}
              </dd>
            </div>
          </dl>
        </section>

        {isDraft && (
          <section aria-labelledby="readiness" className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 id="readiness" className="mb-3 text-sm font-semibold text-slate-800">Before approval</h2>
            {readiness.blockers.length === 0 && readiness.warnings.length === 0 && (
              <p className="text-sm text-slate-600">All required information is present. Review the limits against the source before approving.</p>
            )}
            {readiness.blockers.length > 0 && (
              <ul className="space-y-1 text-sm text-red-800">
                {readiness.blockers.map((b) => (
                  <li key={b} className="flex gap-2"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> <span><strong>Required:</strong> {b}</span></li>
                ))}
              </ul>
            )}
            {readiness.warnings.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm text-amber-800">
                {readiness.warnings.map((w) => (
                  <li key={w} className="flex gap-2"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> <span><strong>Check:</strong> {w}</span></li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section aria-labelledby="limits">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 id="limits" className="text-sm font-semibold text-slate-800">Limits</h2>
            {isDraft && editor === null && (
              <button
                onClick={() => setEditor('new')}
                disabled={selectableCodes.length === 0}
                className="inline-flex items-center gap-2 rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-slate-900 hover:bg-amber-400 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" aria-hidden /> Add limit
              </button>
            )}
          </div>

          {isDraft && editor !== null && (
            <div className="mb-4">
              <LimitForm
                key={editor === 'new' ? 'new' : editor.id}
                initialValues={editor === 'new' ? EMPTY_LIMIT_FORM : limitToFormValues(editor)}
                existingConditions={editor === 'new' ? undefined : editor.applicable_conditions}
                definitions={definitions}
                selectableCodes={selectableCodes}
                lockParameter={editor !== 'new'}
                submitting={addLimit.isPending || updateLimit.isPending}
                serverError={(editor === 'new' ? addLimit.error : updateLimit.error)?.message}
                onCancel={closeEditor}
                onSubmit={(input) => {
                  if (editor === 'new') {
                    addLimit.mutate(input, {
                      onSuccess: () => {
                        closeEditor()
                        setMessage('Limit added.')
                      },
                    })
                  } else {
                    updateLimit.mutate(
                      { id: editor.id, input },
                      {
                        onSuccess: () => {
                          closeEditor()
                          setMessage('Limit updated.')
                        },
                      },
                    )
                  }
                }}
              />
            </div>
          )}

          {profile.limits.length === 0 ? (
            <EmptyState
              icon={Plus}
              title="No limits"
              description={
                isDraft
                  ? 'Add the limits given by your source, one per parameter. A profile without limits cannot be approved.'
                  : 'This profile has no limits.'
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Limits for this profile</caption>
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-3">Parameter</th>
                    <th scope="col" className="px-4 py-3">Unit</th>
                    <th scope="col" className="px-4 py-3">Lower limit</th>
                    <th scope="col" className="px-4 py-3">Upper limit</th>
                    <th scope="col" className="px-4 py-3">Lower warning</th>
                    <th scope="col" className="px-4 py-3">Upper warning</th>
                    <th scope="col" className="px-4 py-3">Conditions</th>
                    <th scope="col" className="px-4 py-3">Source note</th>
                    {isDraft && <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {profile.limits.map((l) => {
                    const def = definitions.find((d) => d.code === l.parameter_code)
                    const mismatch = def !== undefined && def.canonical_unit !== l.unit
                    const cond = l.applicable_conditions?.description
                    return (
                      <tr key={l.id}>
                        <th scope="row" className="px-4 py-3 font-medium">{l.parameter_name}</th>
                        <td className="px-4 py-3">
                          {l.unit}
                          {mismatch && (
                            <span className="ml-1 text-xs text-red-700">(canonical: {def.canonical_unit})</span>
                          )}
                        </td>
                        <td className="px-4 py-3">{num(l.lower_limit)}</td>
                        <td className="px-4 py-3">{num(l.upper_limit)}</td>
                        <td className="px-4 py-3">{num(l.warning_lower)}</td>
                        <td className="px-4 py-3">{num(l.warning_upper)}</td>
                        <td className="px-4 py-3">{typeof cond === 'string' ? cond : '—'}</td>
                        <td className="max-w-xs px-4 py-3 text-slate-600">{l.source_note}</td>
                        {isDraft && (
                          <td className="whitespace-nowrap px-4 py-3 text-right">
                            <button
                              onClick={() => setEditor(l)}
                              aria-label={`Edit ${l.parameter_name} limit`}
                              className="mr-2 inline-flex items-center gap-1 text-slate-600 hover:text-amber-700"
                            >
                              <Pencil className="h-4 w-4" aria-hidden /> Edit
                            </button>
                            <button
                              onClick={() => setDialog({ deleteLimit: l })}
                              aria-label={`Remove ${l.parameter_name} limit`}
                              className="inline-flex items-center gap-1 text-slate-600 hover:text-red-700"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden /> Remove
                            </button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500">
            “not set” means the source gives no value; it is never treated as zero or unlimited.
          </p>
        </section>
      </div>

      {dialog === 'approve' && (
        <ConfirmDialog
          title="Approve this reference profile?"
          confirmLabel="Approve profile"
          acknowledgement="I have checked every limit against the stated source."
          busy={approve.isPending}
          error={approve.error?.message}
          onCancel={closeDialog}
          onConfirm={() =>
            approve.mutate(undefined, {
              onSuccess: () => {
                closeDialog()
                setMessage('Profile approved. It and its limits can no longer be edited.')
              },
            })
          }
        >
          <p>
            Once approved, this profile and its limits become <strong>immutable</strong> and can support motor assessments.
            To change a limit later you must create a new version.
          </p>
          {readiness.warnings.length > 0 && (
            <div>
              <p className="font-medium text-amber-800">Review before approving:</p>
              <ul className="list-disc pl-5 text-amber-800">
                {readiness.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </div>
          )}
        </ConfirmDialog>
      )}

      {dialog === 'retire' && (
        <ConfirmDialog
          title="Retire this reference profile?"
          confirmLabel="Retire profile"
          busy={retire.isPending}
          error={retire.error?.message}
          onCancel={closeDialog}
          onConfirm={() =>
            retire.mutate(profile, {
              onSuccess: () => {
                closeDialog()
                setMessage('Profile retired.')
              },
            })
          }
        >
          <p>A retired profile can no longer be used for new assessments and cannot be reactivated.</p>
          <p>Previously saved assessments are not changed: they keep the profile version they were made with.</p>
        </ConfirmDialog>
      )}

      {dialog === 'version' && (
        <ConfirmDialog
          title="Create a new version?"
          confirmLabel="Create draft version"
          busy={nextVersion.isPending}
          error={nextVersion.error?.message}
          onCancel={closeDialog}
          onConfirm={() =>
            nextVersion.mutate(
              { source: profile, existingVersions: (all.data ?? []).filter((p) => p.name === profile.name).map((p) => p.version) },
              {
                onSuccess: (created) => {
                  closeDialog()
                  navigate(`/reference/${created.id}`, {
                    state: { flash: `Draft version ${created.version} created from v${profile.version}. Review, edit and approve it when ready.` },
                  })
                },
              },
            )
          }
        >
          <p>
            This copies the details and limits into a new <strong>draft</strong> (next version number). The current
            version is not changed. The new draft cannot be used until you review and approve it.
          </p>
        </ConfirmDialog>
      )}

      {dialog !== null && typeof dialog === 'object' && (
        <ConfirmDialog
          title="Remove this limit?"
          confirmLabel="Remove limit"
          busy={dialogBusy}
          error={deleteLimit.error?.message}
          onCancel={closeDialog}
          onConfirm={() =>
            deleteLimit.mutate(dialog.deleteLimit.id, {
              onSuccess: () => {
                closeDialog()
                setMessage('Limit removed.')
              },
            })
          }
        >
          <p>
            Remove the <strong>{dialog.deleteLimit.parameter_name}</strong> limit from this draft profile? This cannot be undone.
          </p>
        </ConfirmDialog>
      )}
    </>
  )
}

function Meta({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value && value !== '' ? value : '—'}</dd>
    </div>
  )
}
