import { useRef } from 'react'

/**
 * Synchronous "only one at a time" guard for actions that create records.
 *
 * Disabling a button from React state is not enough: a second click can arrive in the same tick, before the next
 * render (mutation state is published asynchronously). A ref changes immediately, so the second call is refused.
 * `start()` returns false if an action is already running; call `done()` when it settles.
 */
export function useSingleFlight() {
  const running = useRef(false)
  return {
    start(): boolean {
      if (running.current) return false
      running.current = true
      return true
    },
    done(): void {
      running.current = false
    },
  }
}
