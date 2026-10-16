import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import LoadingState from '../components/LoadingState'
import MotorForm from '../components/MotorForm'
import Notice from '../components/Notice'
import PageHeader from '../components/PageHeader'
import { useCreateMotor, useMotor, useMotors, useUpdateMotor } from '../hooks/useMotors'
import { EMPTY_MOTOR_FORM, motorToFormValues } from '../lib/motorSchema'
import { motorTypes } from '../lib/motorFilters'
import type { MotorInput } from '../types/motor'

export function AddMotorPage() {
  const navigate = useNavigate()
  const create = useCreateMotor()
  const { data: motors } = useMotors()
  const suggestions = useMemo(() => motorTypes(motors ?? []), [motors])

  function handleSubmit(data: MotorInput) {
    create.mutate(data, {
      onSuccess: (motor) =>
        navigate(`/motors/${motor.id}`, { state: { flash: `Motor ${motor.motor_tag} was registered.` } }),
    })
  }

  return (
    <>
      <PageHeader title="Add motor" subtitle="Register a motor and its nameplate specifications." />
      <MotorForm
        initialValues={EMPTY_MOTOR_FORM}
        submitLabel="Register motor"
        cancelTo="/motors"
        submitting={create.isPending}
        serverError={create.error?.message}
        typeSuggestions={suggestions}
        onSubmit={handleSubmit}
      />
    </>
  )
}

export function EditMotorPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: motor, isPending, error } = useMotor(id)
  const update = useUpdateMotor(id ?? '')
  const { data: motors } = useMotors()
  const suggestions = useMemo(() => motorTypes(motors ?? []), [motors])

  if (isPending) return <LoadingState label="Loading motor…" />
  if (error) return <Notice kind="error">{error.message}</Notice>
  if (!motor) {
    return (
      <>
        <Notice kind="error">This motor was not found.</Notice>
        <Link to="/motors" className="text-sm font-medium text-amber-700 hover:underline">
          Back to motors
        </Link>
      </>
    )
  }

  function handleSubmit(data: MotorInput) {
    update.mutate(data, {
      onSuccess: (updated) =>
        navigate(`/motors/${updated.id}`, { state: { flash: `Motor ${updated.motor_tag} was updated.` } }),
    })
  }

  return (
    <>
      <PageHeader title={`Edit ${motor.motor_tag}`} subtitle="Changing specifications does not alter saved test history." />
      <MotorForm
        // Remount if a refetch delivers a different record version.
        key={motor.updated_at}
        initialValues={motorToFormValues(motor)}
        submitLabel="Save changes"
        cancelTo={`/motors/${motor.id}`}
        submitting={update.isPending}
        serverError={update.error?.message}
        typeSuggestions={suggestions}
        onSubmit={handleSubmit}
      />
    </>
  )
}
