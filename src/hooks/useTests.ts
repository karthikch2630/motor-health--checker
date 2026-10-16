import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSessionWithReadings, listSessions, saveAndSubmit, saveDraft, type SaveDraftInput } from '../lib/tests'

const keys = {
  all: ['test-sessions'] as const,
  one: (id: string) => ['test-sessions', id] as const,
}

export const useSessions = () => useQuery({ queryKey: keys.all, queryFn: listSessions })

export const useTest = (id: string | undefined) =>
  useQuery({ queryKey: keys.one(id ?? ''), queryFn: () => getSessionWithReadings(id as string), enabled: !!id })

/** Refresh even after failures: a draft may have been created before a later step failed. */
function useRefreshTests() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: keys.all })
}

export function useSaveDraft() {
  const refresh = useRefreshTests()
  return useMutation({ mutationFn: (input: SaveDraftInput) => saveDraft(input), onSettled: refresh })
}

export function useSaveAndSubmit() {
  const refresh = useRefreshTests()
  return useMutation({ mutationFn: (input: SaveDraftInput) => saveAndSubmit(input), onSettled: refresh })
}
