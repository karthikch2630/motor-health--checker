import { useMemo } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import LoadingState from '../components/LoadingState'
import Notice from '../components/Notice'
import PageHeader from '../components/PageHeader'
import AssessmentPanel from '../components/AssessmentPanel'
import ReferencePanel from '../components/ReferencePanel'
import ReviewPanel from '../components/ReviewPanel'
import SessionStatusBadge from '../components/SessionStatusBadge'
import TestEditor from '../components/TestEditor'
import { useMotors } from '../hooks/useMotors'
import { useParameterDefinitions, useProfiles } from '../hooks/useReference'
import { useTest } from '../hooks/useTests'

/** /tests/new (optionally ?motor=<id>) and /tests/:id (editable while draft, read-only afterwards). */
export default function TestEntryPage() {
  const { id } = useParams()
  const [search] = useSearchParams()
  const flash = (useLocation().state as { flash?: string } | null)?.flash
  const motors = useMotors()
  const defs = useParameterDefinitions()
  const profiles = useProfiles()
  const test = useTest(id)

  const back = (
    <Link to="/history" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-amber-700">
      <ArrowLeft className="h-4 w-4" aria-hidden /> All tests
    </Link>
  )

  const loading = motors.isPending || defs.isPending || (!!id && test.isPending)
  const loadError = motors.error ?? defs.error ?? (id ? test.error : null)
  const motor = useMemo(() => {
    const motorId = test.data?.session.motor_id ?? search.get('motor') ?? ''
    return motors.data?.find((m) => m.id === motorId)
  }, [motors.data, test.data, search])

  if (loading) return <LoadingState label="Loading…" />
  if (loadError) {
    return (
      <>
        {back}
        <Notice kind="error">{loadError.message}</Notice>
      </>
    )
  }
  const motorList = motors.data ?? []
  const definitions = defs.data ?? []

  if (id && !test.data) {
    return (
      <>
        {back}
        <Notice kind="error">This test was not found.</Notice>
      </>
    )
  }

  if (!id && motorList.length === 0) {
    return (
      <>
        {back}
        <PageHeader title="New test" subtitle="Record manual measurements for a motor." />
        <Notice kind="error">
          No motors are registered yet. <Link to="/motors/new" className="font-medium underline">Register a motor</Link> before
          recording a test.
        </Notice>
      </>
    )
  }

  if (definitions.length === 0) {
    return (
      <>
        {back}
        <Notice kind="error">The parameter catalog is empty. Apply the database migrations (see the README).</Notice>
      </>
    )
  }

  const existing = test.data ?? undefined
  const profileError = profiles.error?.message ?? null

  if (existing && existing.session.status !== 'draft') {
    const s = existing.session
    const c = s.operating_conditions ?? {}
    return (
      <>
        {back}
        {flash && <Notice kind="success">{flash}</Notice>}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageHeader title={`Test — ${motor?.motor_tag ?? 'motor'}`} subtitle="Recorded measurements (read-only)." />
          <SessionStatusBadge status={s.status} />
        </div>
        <div className="space-y-6">
          <ReviewPanel
            motor={motor}
            testTimestamp={s.test_timestamp}
            method={s.measurement_method}
            operator={typeof c.operator === 'string' ? c.operator : null}
            conditions={typeof c.description === 'string' ? c.description : null}
            notes={s.notes}
            definitions={definitions}
            readings={existing.readings}
          />
          <ReferencePanel
            motor={motor}
            testTime={new Date(s.test_timestamp)}
            profiles={profiles.data}
            loading={profiles.isPending}
            error={profileError}
          />
          <p className="text-sm text-slate-600">
            {s.status === 'submitted'
              ? 'This test has been submitted. Its readings can no longer be edited.'
              : 'This test has been assessed. Its readings cannot be changed; a reassessment adds a new revision.'}
          </p>
          <AssessmentPanel
            session={s}
            readings={existing.readings}
            motor={motor}
            definitions={definitions}
            profiles={profiles.data}
            profileNames={Object.fromEntries((profiles.data ?? []).map((x) => [x.id, x.name]))}
          />
        </div>
      </>
    )
  }

  return (
    <>
      {back}
      {flash && <Notice kind="success">{flash}</Notice>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title={existing ? 'Continue draft test' : 'New test'}
          subtitle="Record manual measurements. Nothing is assessed in this step."
        />
        {existing && <SessionStatusBadge status={existing.session.status} />}
      </div>
      <TestEditor
        key={existing?.session.id ?? 'new'}
        motors={motorList}
        definitions={definitions}
        profiles={profiles.data}
        profilesLoading={profiles.isPending}
        profilesError={profileError}
        existing={existing}
        defaultMotorId={search.get('motor') ?? undefined}
      />
    </>
  )
}
