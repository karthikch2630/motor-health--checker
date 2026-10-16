/** Data access for public.motors. All calls run as the signed-in user, so RLS applies. */
import { supabase } from './supabase'
import type { Motor, MotorInput } from '../types/motor'

/** Error with a user-presentable message. */
export class DataError extends Error {}

interface PgErrorLike {
  code?: string
  message?: string
  details?: string
}

function client() {
  if (!supabase) throw new DataError('Supabase is not configured.')
  return supabase
}

/** Maps Postgres / PostgREST errors to messages without exposing internals. */
export function describeDbError(error: unknown): string {
  const e = (error ?? {}) as PgErrorLike
  switch (e.code) {
    case '23505':
      return 'A motor with this tag already exists. Motor tags must be unique.'
    case '23514':
      return 'The database rejected one of the values (a check constraint failed). Review the specifications.'
    case '23502':
      return 'A required value is missing.'
    case '42501':
      return 'You do not have permission to perform this action.'
    case '42P01':
      return 'The motors table was not found. Apply the database migrations (see the README).'
    case 'PGRST301':
      return 'Your session has expired. Sign in again.'
  }
  if (e instanceof TypeError || /failed to fetch|network/i.test(e.message ?? '')) {
    return 'Could not reach the server. Check your connection and try again.'
  }
  console.error('Unexpected database error:', error)
  return 'The database request failed. Please try again.'
}

export async function listMotors(): Promise<Motor[]> {
  try {
    const { data, error } = await client().from('motors').select('*').order('motor_tag', { ascending: true })
    if (error) throw error
    return (data ?? []) as Motor[]
  } catch (error) {
    throw error instanceof DataError ? error : new DataError(describeDbError(error))
  }
}

/** Returns null when the motor does not exist (or is not visible to this user). */
export async function getMotor(id: string): Promise<Motor | null> {
  try {
    const { data, error } = await client().from('motors').select('*').eq('id', id).maybeSingle()
    if (error) throw error
    return (data as Motor | null) ?? null
  } catch (error) {
    throw error instanceof DataError ? error : new DataError(describeDbError(error))
  }
}

export async function createMotor(input: MotorInput): Promise<Motor> {
  try {
    // owner_id is filled by the database default (auth.uid()); RLS rejects anything else.
    const { data, error } = await client().from('motors').insert(input).select().single()
    if (error) throw error
    return data as Motor
  } catch (error) {
    throw error instanceof DataError ? error : new DataError(describeDbError(error))
  }
}

export async function updateMotor(id: string, input: MotorInput): Promise<Motor> {
  try {
    const { data, error } = await client().from('motors').update(input).eq('id', id).select().maybeSingle()
    if (error) throw error
    if (!data) throw new DataError('The motor could not be updated. It may no longer exist.')
    return data as Motor
  } catch (error) {
    throw error instanceof DataError ? error : new DataError(describeDbError(error))
  }
}
