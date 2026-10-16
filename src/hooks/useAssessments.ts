import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listAssessments, runAssessment, type RunAssessmentInput } from '../lib/assessments'

export const useAssessments = (sessionId: string | undefined) =>
  useQuery({
    queryKey: ['assessments', sessionId ?? ''],
    queryFn: () => listAssessments(sessionId as string),
    enabled: !!sessionId,
  })

export function useRunAssessment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: RunAssessmentInput) => runAssessment(input),
    // Refresh on success AND failure so the screen always shows what is really stored.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['assessments'] })
      qc.invalidateQueries({ queryKey: ['test-sessions'] })
    },
  })
}
