import { useQuery } from '@tanstack/react-query'
import { getOverview, listReadingsForSessions } from '../lib/overview'

/**
 * Motors, tests and stored results in three requests, shared by the dashboard, test history and motor pages.
 * The key starts with 'test-sessions' so saving a draft, submitting or assessing refreshes it automatically.
 */
export const OVERVIEW_KEY = ['test-sessions', 'overview'] as const

export const useOverview = () => useQuery({ queryKey: OVERVIEW_KEY, queryFn: getOverview })

export const useReadingsFor = (motorId: string, sessionIds: string[]) =>
  useQuery({
    queryKey: ['test-sessions', 'readings', motorId, sessionIds.join(',')],
    queryFn: () => listReadingsForSessions(sessionIds),
    enabled: sessionIds.length > 0,
  })
