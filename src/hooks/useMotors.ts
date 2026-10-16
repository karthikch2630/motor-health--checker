import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { OVERVIEW_KEY } from './useOverview'
import { createMotor, getMotor, listMotors, updateMotor } from '../lib/motors'
import type { MotorInput } from '../types/motor'

const keys = {
  all: ['motors'] as const,
  one: (id: string) => ['motors', id] as const,
}

export const useMotors = () => useQuery({ queryKey: keys.all, queryFn: listMotors })

export const useMotor = (id: string | undefined) =>
  useQuery({ queryKey: keys.one(id ?? ''), queryFn: () => getMotor(id as string), enabled: !!id })

export function useCreateMotor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: MotorInput) => createMotor(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: OVERVIEW_KEY })
      return qc.invalidateQueries({ queryKey: keys.all })
    },
  })
}

export function useUpdateMotor(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: MotorInput) => updateMotor(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: OVERVIEW_KEY })
      return qc.invalidateQueries({ queryKey: keys.all })
    },
  })
}
