import { describe, expect, it } from 'vitest'
import { dataOriginOf } from './dataOrigin'
import { newTestForm, validateSessionMeta } from './testForm'

describe('origin of the readings', () => {
  const base = { ...newTestForm([], 'm1'), timestamp: '2026-01-01T00:00' }

  it('is stored in operating_conditions next to other keys, may be cleared, and rejects unknown values', () => {
    const a = validateSessionMeta({ ...base, data_origin: 'synthetic' }, { keep: 1 })
    expect(a.ok && a.data.operating_conditions).toEqual({ keep: 1, data_origin: 'synthetic' })
    const b = validateSessionMeta({ ...base, data_origin: '' }, { data_origin: 'synthetic' })
    expect(b.ok && b.data.operating_conditions).toEqual({})
    expect(validateSessionMeta({ ...base, data_origin: 'guess' }).ok).toBe(false)
  })

  it('is never assumed: absent or unrecognised means not stated', () => {
    expect(dataOriginOf(undefined)).toBeNull()
    expect(dataOriginOf({})).toBeNull()
    expect(dataOriginOf({ data_origin: 'real' })).toBeNull()
    expect(dataOriginOf({ data_origin: 'measured' })).toBe('measured')
    expect(dataOriginOf({ data_origin: 'synthetic' })).toBe('synthetic')
  })
})
