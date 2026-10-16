import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addLimit,
  approveProfile,
  createNextVersion,
  createProfile,
  deleteLimit,
  getProfile,
  listParameterDefinitions,
  listProfiles,
  retireProfile,
  updateLimit,
  updateProfile,
} from '../lib/reference'
import type { LimitInput, ProfileInput, ReferenceProfile, ReferenceProfileWithLimits } from '../types/reference'

const keys = {
  profiles: ['reference-profiles'] as const,
  profile: (id: string) => ['reference-profiles', id] as const,
  params: ['parameter-definitions'] as const,
}

// The parameter catalog changes only through migrations, so it can be cached for the session.
export const useParameterDefinitions = () =>
  useQuery({ queryKey: keys.params, queryFn: listParameterDefinitions, staleTime: Infinity })

export const useProfiles = () => useQuery({ queryKey: keys.profiles, queryFn: listProfiles })

export const useProfile = (id: string | undefined) =>
  useQuery({ queryKey: keys.profile(id ?? ''), queryFn: () => getProfile(id as string), enabled: !!id })

/** Invalidate the list and every profile detail after any change. */
function useInvalidate() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: keys.profiles })
}

export function useCreateProfile() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (input: ProfileInput) => createProfile(input), onSuccess: invalidate })
}

export function useUpdateProfile(id: string) {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (input: ProfileInput) => updateProfile(id, input), onSuccess: invalidate })
}

export function useApproveProfile(id: string) {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: () => approveProfile(id), onSuccess: invalidate })
}

export function useRetireProfile() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (p: ReferenceProfile) => retireProfile(p), onSuccess: invalidate })
}

export function useCreateNextVersion() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (v: { source: ReferenceProfileWithLimits; existingVersions: number[] }) =>
      createNextVersion(v.source, v.existingVersions),
    // Refresh even on failure: a draft may have been created before the limits copy failed.
    onSettled: invalidate,
  })
}

export function useAddLimit(profileId: string) {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (input: LimitInput) => addLimit(profileId, input), onSuccess: invalidate })
}

export function useUpdateLimit() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (v: { id: string; input: LimitInput }) => updateLimit(v.id, v.input),
    onSuccess: invalidate,
  })
}

export function useDeleteLimit() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: string) => deleteLimit(id), onSuccess: invalidate })
}
