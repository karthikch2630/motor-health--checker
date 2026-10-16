/** Whether a test's readings are real instrument measurements or synthetic/demo values. Declared by the operator. */
export const DATA_ORIGIN_KEY = 'data_origin'
export const DATA_ORIGINS = ['measured', 'synthetic'] as const
export type DataOrigin = (typeof DATA_ORIGINS)[number]
export const DATA_ORIGIN_LABELS: Record<DataOrigin, string> = {
  measured: 'Real instrument measurements',
  synthetic: 'Synthetic / demo values (not real measurements)',
}

export function dataOriginOf(operatingConditions: Record<string, unknown> | null | undefined): DataOrigin | null {
  const v = operatingConditions?.[DATA_ORIGIN_KEY]
  return v === 'measured' || v === 'synthetic' ? v : null
}
