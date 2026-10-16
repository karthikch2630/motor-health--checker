import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MotorInput } from '../types/motor'

// Chainable stand-in for the Supabase query builder. This tests OUR calls and error mapping,
// not Supabase itself (see README: real integration is verified manually).
const db = vi.hoisted(() => {
  const calls: { op: string; args: unknown[] }[] = []
  let result: { data: unknown; error: unknown } = { data: null, error: null }
  const builder: Record<string, unknown> = {}
  for (const op of ['select', 'insert', 'update', 'eq', 'order']) {
    builder[op] = (...args: unknown[]) => (calls.push({ op, args }), builder)
  }
  builder.single = () => Promise.resolve(result)
  builder.maybeSingle = () => Promise.resolve(result)
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result)
  return {
    calls,
    setResult: (r: { data: unknown; error: unknown }) => (result = r),
    client: { from: (t: string) => (calls.push({ op: 'from', args: [t] }), builder) },
  }
})
vi.mock('./supabase', () => ({ supabase: db.client }))

import { createMotor, getMotor, listMotors, updateMotor } from './motors'

const input: MotorInput = {
  motor_tag: 'M-1', name: 'N', motor_type: 'induction', manufacturer: null, model: null, serial_number: null,
  rated_voltage: null, rated_current: null, rated_power: null, power_unit: null, rated_frequency: null,
  rated_rpm: null, phase_count: null, supply_type: null, location: null, notes: null,
}

beforeEach(() => {
  db.calls.length = 0
  db.setResult({ data: null, error: null })
})

describe('motors data access', () => {
  it('createMotor never sends owner_id (database default + RLS decide ownership)', async () => {
    db.setResult({ data: { id: '1', ...input }, error: null })
    await createMotor(input)
    const insert = db.calls.find((c) => c.op === 'insert')
    expect(insert?.args[0]).not.toHaveProperty('owner_id')
    expect(db.calls[0]).toEqual({ op: 'from', args: ['motors'] })
  })

  it('maps a duplicate-tag error to a clear message', async () => {
    db.setResult({ data: null, error: { code: '23505', message: 'duplicate key ...' } })
    await expect(createMotor(input)).rejects.toThrow(/already exists/)
  })

  it('surfaces an RLS/permission failure instead of hiding it', async () => {
    db.setResult({ data: null, error: { code: '42501', message: 'permission denied' } })
    await expect(listMotors()).rejects.toThrow(/permission/)
  })

  it('updateMotor reports a missing row (e.g. not visible under RLS) as an error, not success', async () => {
    db.setResult({ data: null, error: null })
    await expect(updateMotor('x', input)).rejects.toThrow(/could not be updated/)
  })

  it('getMotor returns null when nothing is found', async () => {
    db.setResult({ data: null, error: null })
    await expect(getMotor('x')).resolves.toBeNull()
  })
})
