import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { describeAuthError } from './authErrors'

export type AuthStatus = 'loading' | 'unconfigured' | 'signed-out' | 'signed-in'

interface AuthContextValue {
  status: AuthStatus
  user: User | null
  /** Set when restoring the session failed (e.g. network error). */
  sessionError: string | null
  /** Resolves to an error message, or null on success. */
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<string | null>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<AuthStatus>(supabase ? 'loading' : 'unconfigured')
  const [user, setUser] = useState<User | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) return
    let active = true

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return
        if (error) setSessionError(describeAuthError(error))
        setUser(data.session?.user ?? null)
        setStatus(data.session ? 'signed-in' : 'signed-out')
      })
      .catch((error: unknown) => {
        if (!active) return
        setSessionError(describeAuthError(error))
        setStatus('signed-out')
      })

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      setUser(session?.user ?? null)
      setStatus(session ? 'signed-in' : 'signed-out')
      // Never keep one session's data cached after it ends.
      if (event === 'SIGNED_OUT') queryClient.clear()
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [queryClient])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      sessionError,
      async signIn(email, password) {
        if (!supabase) return 'Supabase is not configured.'
        try {
          const { error } = await supabase.auth.signInWithPassword({ email, password })
          if (error) return describeAuthError(error)
          setSessionError(null)
          return null
        } catch (error) {
          return describeAuthError(error)
        }
      },
      async signOut() {
        if (!supabase) return null
        try {
          const { error } = await supabase.auth.signOut()
          queryClient.clear()
          return error ? 'Sign-out failed. Please try again.' : null
        } catch {
          return 'Sign-out failed. Please try again.'
        }
      },
    }),
    [status, user, sessionError, queryClient],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
