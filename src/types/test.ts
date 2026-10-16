/** Row shapes of public.test_sessions and public.test_readings (migrations 005, 006). */
export type SessionStatus = 'draft' | 'submitted' | 'assessed'

export interface TestSession {
  id: string
  owner_id: string
  motor_id: string
  test_timestamp: string
  operating_conditions: Record<string, unknown>
  measurement_method: string | null
  notes: string | null
  status: SessionStatus
  created_at: string
}

/** Writable session columns. `status` is controlled by the save/submit operations, not by form input. */
export type SessionInput = Pick<
  TestSession,
  'motor_id' | 'test_timestamp' | 'operating_conditions' | 'measurement_method' | 'notes'
>

/** One measured value: the original value + unit are preserved; normalized_* is set only after a supported conversion. */
export interface ReadingInput {
  parameter_code: string
  measured_value: number
  measured_unit: string
  normalized_value: number
  normalized_unit: string
  measurement_location: string | null
}

export interface TestReading extends Omit<ReadingInput, 'normalized_value' | 'normalized_unit'> {
  id: string
  owner_id: string
  test_session_id: string
  normalized_value: number | null
  normalized_unit: string | null
  recorded_at: string
}

export interface SessionWithReadings {
  session: TestSession
  readings: TestReading[]
}
