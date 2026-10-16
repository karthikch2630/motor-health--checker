// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSingleFlight } from './useSingleFlight'

describe('useSingleFlight', () => {
  it('refuses a second start until the first is done', () => {
    const { result } = renderHook(() => useSingleFlight())
    expect(result.current.start()).toBe(true)
    expect(result.current.start()).toBe(false) // same tick, no re-render in between
    result.current.done()
    expect(result.current.start()).toBe(true) // retry after the action settled
  })

  it('keeps its state across re-renders', () => {
    const { result, rerender } = renderHook(() => useSingleFlight())
    result.current.start()
    rerender()
    expect(result.current.start()).toBe(false)
  })
})
