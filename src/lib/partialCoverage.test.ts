import { describe, expect, it } from 'vitest'
import { notCheckedParameters } from './partialCoverage'

describe('notCheckedParameters', () => {
  const catalog = ['voltage', 'current', 'frequency']
  it('lists catalog parameters without a finding when a profile was applied', () => {
    expect(notCheckedParameters([{ parameter_code: 'voltage' }, { parameter_code: null }], catalog, true)).toEqual(['current', 'frequency'])
  })
  it('is empty when no profile was applied (that case is already INSUFFICIENT_DATA) or everything has a finding', () => {
    expect(notCheckedParameters([], catalog, false)).toEqual([])
    expect(notCheckedParameters(catalog.map((c) => ({ parameter_code: c })), catalog, true)).toEqual([])
  })
})
