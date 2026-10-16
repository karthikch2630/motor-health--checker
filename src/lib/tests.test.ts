import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadingInput, SessionInput } from '../types/test'

// Chainable stand-in for the Supabase query builder: tests OUR request sequence and error handling.
// It proves nothing about the real database (the lifecycle triggers were checked on local Postgres).
const db = vi.hoisted(() => {
  type Call = { table: string; op: string; args: unknown[] }
  const calls: Call[] = []
  let results: { data: unknown; error: unknown }[] = []
  let table = ''
  const next = () => results.shift() ?? { data: null, error: null }
  const builder: Record<string, unknown> = {}
  for (const op of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'order']) {
    builder[op] = (...args: unknown[]) => (calls.push({ table, op, args }), builder)
  }
  builder.single = () => Promise.resolve(next())
  builder.maybeSingle = () => Promise.resolve(next())
  builder.then = (resolve: (v: unknown) => unknown) => resolve(next())
  return {
    calls,
    queue: (...r: { data: unknown; error: unknown }[]) => (results = r),
    client: { from: (t: string) => ((table = t), builder) },
  }
})
vi.mock('./supabase', () => ({ supabase: db.client }))

import { describeTestError, PartialSaveError, saveAndSubmit, saveDraft, submitSession } from './tests'

const ok = (data: unknown = null) => ({ data, error: null })
const fail = (message: string, code = 'XX000') => ({ data: null, error: { code, message } })
const ops = (op: string, table?: string) => db.calls.filter((c) => c.op === op && (!table || c.table === table))

const session: SessionInput = {
  motor_id: 'm1', test_timestamp: '2026-06-01T10:00:00.000Z', measurement_method: null, notes: null, operating_conditions: {},
}
const reading = (code: string, v: number): ReadingInput => ({
  parameter_code: code, measured_value: v, measured_unit: 'V', normalized_value: v, normalized_unit: 'V', measurement_location: null,
})
const codes = ['voltage', 'current', 'temperature']

beforeEach(() => {
  db.calls.length = 0
  db.queue()
})

describe('saveDraft', () => {
  it('first save creates a DRAFT session, then upserts readings keyed by session+parameter', async () => {
    db.queue(ok({ id: 's1' }), ok())
    const id = await saveDraft({ sessionId: null, session, readings: [reading('voltage', 400)], allParameterCodes: codes })
    expect(id).toBe('s1')
    const sessionRow = ops('insert', 'test_sessions')[0].args[0] as Record<string, unknown>
    expect(sessionRow.status).toBe('draft')
    expect(sessionRow).not.toHaveProperty('owner_id')
    const up = ops('upsert', 'test_readings')[0]
    expect((up.args[0] as Record<string, unknown>[])[0]).toMatchObject({ test_session_id: 's1', parameter_code: 'voltage', measured_value: 400 })
    expect(up.args[1]).toEqual({ onConflict: 'test_session_id,parameter_code' })
    expect(ops('upsert', 'test_readings')[0].args[0]).not.toContainEqual(expect.objectContaining({ owner_id: expect.anything() }))
  })

  it('later saves update the same draft (draft-only, motor never changed) instead of inserting', async () => {
    db.queue(ok({ id: 's1' }), ok(), ok())
    await saveDraft({ sessionId: 's1', session, readings: [reading('voltage', 1)], allParameterCodes: codes })
    expect(ops('insert', 'test_sessions')).toHaveLength(0)
    const update = ops('update', 'test_sessions')[0]
    expect(update.args[0]).not.toHaveProperty('motor_id')
    expect(update.args[0]).not.toHaveProperty('status')
    expect(db.calls.filter((c) => c.op === 'eq').map((c) => c.args)).toContainEqual(['status', 'draft'])
  })

  it('deletes readings the user cleared, and never writes cleared ones as zero', async () => {
    db.queue(ok({ id: 's1' }), ok(), ok())
    await saveDraft({ sessionId: 's1', session, readings: [reading('voltage', 1)], allParameterCodes: codes })
    const del = ops('in', 'test_readings')[0]
    expect(del.args).toEqual(['parameter_code', ['current', 'temperature']])
    const rows = ops('upsert', 'test_readings')[0].args[0] as { parameter_code: string }[]
    expect(rows.map((r) => r.parameter_code)).toEqual(['voltage'])
  })

  it('with no readings entered it saves only the session (and clears stored readings)', async () => {
    db.queue(ok({ id: 's1' }), ok())
    await saveDraft({ sessionId: null, session, readings: [], allParameterCodes: codes })
    expect(ops('upsert')).toHaveLength(0)
    expect(ops('in', 'test_readings')[0].args[1]).toEqual(codes)
  })

  it('a session failure writes nothing else and is reported as an ordinary error', async () => {
    db.queue(fail('boom', '42501'))
    const p = saveDraft({ sessionId: null, session, readings: [reading('voltage', 1)], allParameterCodes: codes })
    await expect(p).rejects.toThrow(/permission/)
    await p.catch((e) => expect(e).not.toBeInstanceOf(PartialSaveError))
    expect(ops('upsert')).toHaveLength(0)
  })

  it('a readings failure after the session was created raises PartialSaveError carrying the draft id', async () => {
    db.queue(ok({ id: 's9' }), fail('network', '08006'))
    const err = await saveDraft({ sessionId: null, session, readings: [reading('voltage', 1)], allParameterCodes: codes }).catch((e) => e)
    expect(err).toBeInstanceOf(PartialSaveError)
    expect(err.sessionId).toBe('s9')
    expect(err.message).toMatch(/will not create a duplicate/)
  })

  it('refuses to edit a session that is no longer a draft', async () => {
    db.queue(ok(null)) // update matched no draft row
    await expect(saveDraft({ sessionId: 's1', session, readings: [], allParameterCodes: codes })).rejects.toThrow(/no longer a draft/)
    expect(ops('upsert')).toHaveLength(0)
  })
})

describe('submitSession', () => {
  it('moves draft -> submitted only (never assessed), guarded by status = draft', async () => {
    db.queue(ok({ id: 's1', status: 'submitted' }))
    const r = await submitSession('s1')
    expect(r.alreadySubmitted).toBe(false)
    expect(ops('update')[0].args[0]).toEqual({ status: 'submitted' })
    expect(db.calls.filter((c) => c.op === 'eq').map((c) => c.args)).toContainEqual(['status', 'draft'])
  })

  it('is idempotent: a repeat submit reports "already submitted" without changing anything', async () => {
    db.queue(ok(null), ok({ id: 's1', status: 'submitted' }))
    const r = await submitSession('s1')
    expect(r.alreadySubmitted).toBe(true)
    expect(ops('update')).toHaveLength(1)
  })

  it('errors when the test no longer exists', async () => {
    db.queue(ok(null), ok(null))
    await expect(submitSession('s1')).rejects.toThrow(/could not be submitted/)
  })

  it('surfaces database rejections instead of claiming success', async () => {
    db.queue(fail('denied', '42501'))
    await expect(submitSession('s1')).rejects.toThrow(/permission/)
  })
})

describe('saveAndSubmit', () => {
  const input = { sessionId: null, session, readings: [reading('voltage', 1)], allParameterCodes: codes }

  it('saves readings before submitting', async () => {
    db.queue(ok({ id: 's1' }), ok(), ok(), ok({ id: 's1', status: 'submitted' })) // session, delete cleared, upsert, submit
    const r = await saveAndSubmit(input)
    expect(r.session.status).toBe('submitted')
    const order = db.calls.map((c) => `${c.table}.${c.op}`)
    expect(order.indexOf('test_readings.upsert')).toBeLessThan(order.lastIndexOf('test_sessions.update'))
  })

  it('does not submit when readings failed to save', async () => {
    db.queue(ok({ id: 's1' }), fail('x', '08006'))
    await expect(saveAndSubmit(input)).rejects.toBeInstanceOf(PartialSaveError)
    expect(ops('update', 'test_sessions')).toHaveLength(0)
  })

  it('reports a failed submit as a saved draft that was NOT submitted', async () => {
    db.queue(ok({ id: 's1' }), ok(), ok(), fail('x', '08006')) // session, delete cleared, upsert, submit fails
    const err = await saveAndSubmit(input).catch((e) => e)
    expect(err).toBeInstanceOf(PartialSaveError)
    expect(err.sessionId).toBe('s1')
    expect(err.message).toMatch(/saved as a draft, but the test was NOT submitted/)
  })
})

describe('describeTestError', () => {
  it('maps assessed-session and constraint errors, hiding raw ids', () => {
    expect(describeTestError({ message: 'Readings of submitted test session 123 cannot be changed' })).toMatch(/has been submitted/)
    expect(describeTestError({ message: 'Submitted test session 123 is immutable' })).toMatch(/can no longer be changed/)
    expect(describeTestError({ message: 'Test session 1 has no readings and cannot be submitted' })).toMatch(/at least one reading/)
    expect(describeTestError({ message: 'violates unique constraint "test_readings_session_parameter_key"' })).toMatch(/already exists/)
    expect(describeTestError({ code: 'XX000', message: 'internal 123-secret' })).not.toMatch(/secret/)
    expect(describeTestError(new TypeError('Failed to fetch'))).toMatch(/Could not reach/)
  })
})
