import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReferenceProfile, ReferenceProfileWithLimits } from '../types/reference'

// Chainable stand-in for the Supabase query builder. These tests cover OUR calls and error mapping.
// They do not prove anything about the real database; its triggers were checked in Phase 2 on local Postgres.
const db = vi.hoisted(() => {
  type Call = { op: string; args: unknown[] }
  const calls: Call[] = []
  let results: { data: unknown; error: unknown }[] = []
  const next = () => results.shift() ?? { data: null, error: null }
  const builder: Record<string, unknown> = {}
  for (const op of ['select', 'insert', 'update', 'delete', 'eq', 'order']) {
    builder[op] = (...args: unknown[]) => (calls.push({ op, args }), builder)
  }
  builder.single = () => Promise.resolve(next())
  builder.maybeSingle = () => Promise.resolve(next())
  builder.then = (resolve: (v: unknown) => unknown) => resolve(next())
  return {
    calls,
    queue: (...r: { data: unknown; error: unknown }[]) => (results = r),
    client: { from: (t: string) => (calls.push({ op: 'from', args: [t] }), builder) },
  }
})
vi.mock('./supabase', () => ({ supabase: db.client }))

import {
  addLimit,
  approveProfile,
  createNextVersion,
  createProfile,
  deleteLimit,
  describeReferenceError,
  listProfiles,
  retireProfile,
  updateLimit,
} from './reference'

const ok = (data: unknown) => ({ data, error: null })
const pgError = (code: string, message: string) => ({ data: null, error: { code, message } })
const inserts = () => db.calls.filter((c) => c.op === 'insert').map((c) => c.args[0])

const profileInput = {
  name: 'N', motor_type: 'T', description: null, applicable_specs: {}, source_name: 'S', source_reference: null,
  version: 1, effective_from: null, effective_to: null,
}

beforeEach(() => {
  db.calls.length = 0
  db.queue()
})

describe('describeReferenceError (maps the Phase 2 triggers and constraints)', () => {
  it.each([
    ['Reference profile 1234 has no limits and cannot be approved', /at least one limit/],
    ['Limits of reference profile 1234 cannot be changed because it is approved; create a new profile version', /draft/],
    ['Approved reference profile 1234 is immutable; create a new version instead', /new version/],
    ['Retired reference profile 1234 cannot be modified', /retired profile cannot be modified/],
    ['Only draft reference profiles can be deleted (profile 1234 is approved)', /Only draft/],
    ['new row for relation "reference_limits" violates check constraint "reference_limits_range_order"', /lower limit must not exceed/],
    ['duplicate key value violates unique constraint "reference_limits_profile_parameter_key"', /already has a limit/],
    ['duplicate key value violates unique constraint "reference_profiles_name_version_key"', /name and version already exists/],
  ])('maps %j', (message, expected) => {
    expect(describeReferenceError({ code: '23514', message })).toMatch(expected)
  })

  it('never exposes unknown raw messages or ids', () => {
    const text = describeReferenceError({ code: 'XX000', message: 'internal 0000-secret' })
    expect(text).not.toMatch(/secret/)
  })

  it('falls back to the generic mapping (permission, network)', () => {
    expect(describeReferenceError({ code: '42501', message: 'x' })).toMatch(/permission/)
    expect(describeReferenceError(new TypeError('Failed to fetch'))).toMatch(/Could not reach/)
  })
})

describe('profile lifecycle calls', () => {
  it('createProfile always creates a draft and never sends owner_id', async () => {
    db.queue(ok({ id: '1', ...profileInput, approval_status: 'draft' }))
    await createProfile(profileInput)
    const row = inserts()[0] as Record<string, unknown>
    expect(row.approval_status).toBe('draft')
    expect(row).not.toHaveProperty('owner_id')
  })

  it('approveProfile surfaces the database rejection instead of pretending success', async () => {
    db.queue(pgError('23514', 'Reference profile 1 has no limits and cannot be approved'))
    await expect(approveProfile('1')).rejects.toThrow(/at least one limit/)
  })

  it('approveProfile only sets approval_status', async () => {
    db.queue(ok({ id: '1', approval_status: 'approved' }))
    await approveProfile('1')
    const update = db.calls.find((c) => c.op === 'update')
    expect(update?.args[0]).toEqual({ approval_status: 'approved' })
  })

  it('retireProfile sets status and effective_to, never before effective_from', async () => {
    db.queue(ok({ id: '1' }))
    await retireProfile({ id: '1', effective_from: null } as ReferenceProfile)
    const first = db.calls.find((c) => c.op === 'update')?.args[0] as Record<string, string>
    expect(first.approval_status).toBe('retired')
    expect(Date.parse(first.effective_to)).toBeLessThanOrEqual(Date.now())

    db.calls.length = 0
    db.queue(ok({ id: '1' }))
    const future = '2999-01-01T00:00:00.000Z'
    await retireProfile({ id: '1', effective_from: future } as ReferenceProfile)
    expect((db.calls.find((c) => c.op === 'update')?.args[0] as Record<string, string>).effective_to).toBe(future)
  })

  it('reports an update that matched no row (e.g. hidden by RLS) as an error', async () => {
    db.queue(ok(null))
    await expect(approveProfile('1')).rejects.toThrow(/could not be updated/)
  })
})

describe('limit calls', () => {
  const limit = {
    parameter_code: 'voltage', parameter_name: 'Voltage', unit: 'V', lower_limit: null, upper_limit: 1,
    warning_lower: null, warning_upper: null, applicable_conditions: {}, source_note: 'n',
  }

  it('addLimit links to the profile and never sends owner_id', async () => {
    db.queue(ok({ id: 'l' }))
    await addLimit('p1', limit)
    const row = inserts()[0] as Record<string, unknown>
    expect(row.reference_profile_id).toBe('p1')
    expect(row).not.toHaveProperty('owner_id')
  })

  it('shows the friendly message when an approved profile rejects a limit change', async () => {
    db.queue(pgError('23514', 'Limits of reference profile 1 cannot be changed because it is approved'))
    await expect(updateLimit('l', limit)).rejects.toThrow(/Create a new version/)
    db.queue(pgError('23514', 'Limits of reference profile 1 cannot be changed because it is approved'))
    await expect(deleteLimit('l')).rejects.toThrow(/Create a new version/)
  })

  it('deleteLimit errors when nothing was deleted', async () => {
    db.queue(ok([]))
    await expect(deleteLimit('l')).rejects.toThrow(/could not be removed/)
  })
})

describe('listProfiles', () => {
  it('maps the embedded limit count', async () => {
    db.queue(ok([{ id: '1', name: 'A', reference_limits: [{ count: 3 }] }, { id: '2', name: 'B', reference_limits: [] }]))
    const rows = await listProfiles()
    expect(rows.map((r) => r.limit_count)).toEqual([3, 0])
    expect(rows[0]).not.toHaveProperty('reference_limits')
  })
})

describe('createNextVersion', () => {
  const source = {
    id: 'old', name: 'N', motor_type: 'T', description: null, applicable_specs: { phase_count: 3 },
    source_name: 'S', source_reference: 'ref', version: 2, approval_status: 'approved',
    effective_from: '2026-01-01T00:00:00Z', effective_to: null,
    limits: [
      { id: 'l1', owner_id: 'o', reference_profile_id: 'old', parameter_code: 'voltage', parameter_name: 'Voltage', unit: 'V',
        lower_limit: null, upper_limit: 5, warning_lower: null, warning_upper: null, applicable_conditions: {}, source_note: 'n', created_at: '' },
    ],
  } as unknown as ReferenceProfileWithLimits

  it('creates a DRAFT with the next version and copies limits without ids or owner', async () => {
    db.queue(ok({ id: 'new', version: 4, approval_status: 'draft' }), ok(null))
    const created = await createNextVersion(source, [1, 2, 3])
    expect(created.id).toBe('new')
    const [profileRow, limitRows] = inserts() as [Record<string, unknown>, Record<string, unknown>[]]
    expect(profileRow).toMatchObject({ version: 4, approval_status: 'draft', effective_from: null, name: 'N' })
    expect(limitRows).toHaveLength(1)
    expect(limitRows[0]).toMatchObject({ reference_profile_id: 'new', upper_limit: 5, source_note: 'n' })
    expect(limitRows[0]).not.toHaveProperty('id')
    expect(limitRows[0]).not.toHaveProperty('owner_id')
  })

  it('never modifies the source profile', async () => {
    db.queue(ok({ id: 'new', version: 3 }), ok(null))
    await createNextVersion(source, [])
    expect(db.calls.some((c) => c.op === 'update' || c.op === 'delete')).toBe(false)
  })

  it('tells the user when the limits could not be copied (partial failure)', async () => {
    db.queue(ok({ id: 'new', version: 3 }), pgError('42501', 'denied'))
    await expect(createNextVersion(source, [])).rejects.toThrow(/Draft version 3 was created, but its limits could not be copied/)
  })
})
