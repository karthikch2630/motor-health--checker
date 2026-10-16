/**
 * Data access for test sessions and readings. Runs as the signed-in user (RLS applies).
 *
 * Saving needs several requests (session, then readings). They are not atomic, so failures are explicit:
 *  - If the session row cannot be saved, nothing was written.
 *  - If the session was written but the readings were not, a PartialSaveError carries the session id so the
 *    caller keeps UPDATING that same draft on retry instead of creating a duplicate.
 *  - A session is only marked `submitted` after its readings were saved successfully.
 * This phase never sets status `assessed`.
 */
import { supabase } from './supabase'
import { DataError, describeDbError } from './motors'
import type {
  ReadingInput,
  SessionInput,
  SessionWithReadings,
  TestReading,
  TestSession,
} from '../types/test'

function client() {
  if (!supabase) throw new DataError('Supabase is not configured.')
  return supabase
}

/** Raised when the session exists but a later step failed. `sessionId` is the draft to keep using. */
export class PartialSaveError extends DataError {
  constructor(
    message: string,
    readonly sessionId: string,
  ) {
    super(message)
  }
}

export function describeTestError(error: unknown): string {
  const message = ((error ?? {}) as { message?: string }).message ?? ''
  const rules: [RegExp, string][] = [
    [/Readings of (assessed|submitted) test session .* cannot be changed/i, 'This test has been submitted, so its readings can no longer be changed.'],
    [/(Assessed|Submitted) test session .* is immutable/i, 'This test has been submitted and can no longer be changed.'],
    [/has no readings and cannot be submitted/i, 'Add at least one reading before submitting.'],
    [/test_readings_session_parameter_key/, 'A reading for that parameter already exists in this test.'],
    [/test_readings_normalized_pair/, 'A normalized value must be stored together with its unit.'],
    [/test_sessions_motor_fk|test_readings_session_fk/, 'The motor or test could not be found. It may have been removed.'],
    [/test_readings_parameter_code_fkey/, 'That parameter is not in the parameter catalog.'],
  ]
  for (const [re, text] of rules) if (re.test(message)) return text
  return describeDbError(error)
}

async function run<T>(op: () => PromiseLike<T>): Promise<T> {
  try {
    return await op()
  } catch (error) {
    throw error instanceof DataError ? error : new DataError(describeTestError(error))
  }
}

export const listSessions = () =>
  run(async () => {
    const { data, error } = await client()
      .from('test_sessions')
      .select('*')
      .order('test_timestamp', { ascending: false })
    if (error) throw error
    return (data ?? []) as TestSession[]
  })

/** Returns null when the test does not exist or is not visible to this user. */
export const getSessionWithReadings = (id: string) =>
  run(async (): Promise<SessionWithReadings | null> => {
    const { data: session, error } = await client().from('test_sessions').select('*').eq('id', id).maybeSingle()
    if (error) throw error
    if (!session) return null
    const { data: readings, error: readingsError } = await client()
      .from('test_readings')
      .select('*')
      .eq('test_session_id', id)
    if (readingsError) throw readingsError
    return { session: session as TestSession, readings: (readings ?? []) as TestReading[] }
  })

export interface SaveDraftInput {
  /** Null for the first save; the id of the existing draft otherwise. */
  sessionId: string | null
  session: SessionInput
  readings: ReadingInput[]
  /** Every catalog parameter code, used to remove readings the user has cleared. */
  allParameterCodes: string[]
}

/** Creates or updates a DRAFT session and makes its stored readings match `readings`. Returns the session id. */
export async function saveDraft(input: SaveDraftInput): Promise<string> {
  let id = input.sessionId

  await run(async () => {
    if (id === null) {
      const { data, error } = await client()
        .from('test_sessions')
        .insert({ ...input.session, status: 'draft' })
        .select()
        .single()
      if (error) throw error
      id = (data as TestSession).id
    } else {
      // The motor of an existing test never changes; status stays draft.
      const { motor_id: _motor, ...editable } = input.session
      void _motor
      const { data, error } = await client()
        .from('test_sessions')
        .update(editable)
        .eq('id', id)
        .eq('status', 'draft')
        .select()
        .maybeSingle()
      if (error) throw error
      if (!data) throw new DataError('This test is no longer a draft, so it cannot be edited here.')
    }
  })

  const sessionId = id as string
  try {
    await run(async () => {
      const entered = new Set(input.readings.map((r) => r.parameter_code))
      const cleared = input.allParameterCodes.filter((c) => !entered.has(c))
      if (cleared.length > 0) {
        const { error } = await client()
          .from('test_readings')
          .delete()
          .eq('test_session_id', sessionId)
          .in('parameter_code', cleared)
        if (error) throw error
      }
      if (input.readings.length > 0) {
        const rows = input.readings.map((r) => ({ ...r, test_session_id: sessionId }))
        const { error } = await client()
          .from('test_readings')
          .upsert(rows, { onConflict: 'test_session_id,parameter_code' })
        if (error) throw error
      }
    })
  } catch (error) {
    throw new PartialSaveError(
      `The draft test was created, but its readings were not fully saved (${(error as Error).message}) ` +
        'Press "Save draft" again to retry; it will update the same draft and will not create a duplicate.',
      sessionId,
    )
  }
  return sessionId
}

export interface SubmitResult {
  session: TestSession
  /** True when the test had already been submitted (e.g. a double click or a retry) — nothing changed. */
  alreadySubmitted: boolean
}

/** draft -> submitted. Idempotent: submitting an already-submitted test is reported, not repeated. */
export const submitSession = (id: string) =>
  run(async (): Promise<SubmitResult> => {
    const { data, error } = await client()
      .from('test_sessions')
      .update({ status: 'submitted' })
      .eq('id', id)
      .eq('status', 'draft')
      .select()
      .maybeSingle()
    if (error) throw error
    if (data) return { session: data as TestSession, alreadySubmitted: false }

    const { data: current, error: readError } = await client().from('test_sessions').select('*').eq('id', id).maybeSingle()
    if (readError) throw readError
    if (current && (current as TestSession).status !== 'draft') {
      return { session: current as TestSession, alreadySubmitted: true }
    }
    throw new DataError('The test could not be submitted. It may no longer exist.')
  })

/** Saves readings first, then submits. A failed submit leaves a saved draft and says so. */
export async function saveAndSubmit(input: SaveDraftInput): Promise<SubmitResult> {
  const id = await saveDraft(input)
  try {
    return await submitSession(id)
  } catch (error) {
    throw new PartialSaveError(
      `Your readings were saved as a draft, but the test was NOT submitted (${(error as Error).message}) ` +
        'Press "Submit test" again; it will not create a duplicate.',
      id,
    )
  }
}
