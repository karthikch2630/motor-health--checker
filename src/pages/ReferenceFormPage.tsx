import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import LoadingState from '../components/LoadingState'
import Notice from '../components/Notice'
import PageHeader from '../components/PageHeader'
import ProfileForm from '../components/ProfileForm'
import { useMotors } from '../hooks/useMotors'
import { useCreateProfile, useProfile, useUpdateProfile } from '../hooks/useReference'
import { motorTypes } from '../lib/motorFilters'
import { EMPTY_PROFILE_FORM, profileToFormValues } from '../lib/referenceSchema'
import type { ProfileInput } from '../types/reference'

function useMotorTypeSuggestions() {
  const { data } = useMotors()
  return useMemo(() => motorTypes(data ?? []), [data])
}

export function NewProfilePage() {
  const navigate = useNavigate()
  const create = useCreateProfile()
  const suggestions = useMotorTypeSuggestions()

  return (
    <>
      <PageHeader
        title="New draft profile"
        subtitle="The profile is saved as a draft. It cannot be used for assessments until you add limits and approve it."
      />
      <ProfileForm
        initialValues={EMPTY_PROFILE_FORM}
        submitLabel="Create draft"
        cancelTo="/reference"
        submitting={create.isPending}
        serverError={create.error?.message}
        motorTypeSuggestions={suggestions}
        onSubmit={(data: ProfileInput) =>
          create.mutate(data, {
            onSuccess: (p) =>
              navigate(`/reference/${p.id}`, { state: { flash: 'Draft profile created. Add limits next.' } }),
          })
        }
      />
    </>
  )
}

export function EditProfilePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: profile, isPending, error } = useProfile(id)
  const update = useUpdateProfile(id ?? '')
  const suggestions = useMotorTypeSuggestions()

  if (isPending) return <LoadingState label="Loading profile…" />
  if (error) return <Notice kind="error">{error.message}</Notice>
  if (!profile) return <Notice kind="error">This profile was not found.</Notice>

  if (profile.approval_status !== 'draft') {
    return (
      <>
        <Notice kind="error">
          Only draft profiles can be edited. Approved and retired profiles are immutable so that saved assessments stay
          traceable. Create a new version instead.
        </Notice>
        <Link to={`/reference/${profile.id}`} className="text-sm font-medium text-amber-700 hover:underline">
          Back to the profile
        </Link>
      </>
    )
  }

  return (
    <>
      <PageHeader title={`Edit ${profile.name} v${profile.version}`} subtitle="Draft profile" />
      <ProfileForm
        key={profile.id}
        initialValues={profileToFormValues(profile)}
        existingSpecs={profile.applicable_specs}
        submitLabel="Save changes"
        cancelTo={`/reference/${profile.id}`}
        submitting={update.isPending}
        serverError={update.error?.message}
        motorTypeSuggestions={suggestions}
        onSubmit={(data) =>
          update.mutate(data, {
            onSuccess: () => navigate(`/reference/${profile.id}`, { state: { flash: 'Draft profile updated.' } }),
          })
        }
      />
    </>
  )
}
