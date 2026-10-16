import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Cog, Loader2, LogIn } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { missingEnvVars } from '../lib/supabase'
import Notice from '../components/Notice'
import LoadingState from '../components/LoadingState'

export default function SignInPage() {
  const { status, signIn, sessionError } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (status === 'signed-in') return <Navigate to="/" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    setError(null)
    setSubmitting(true)
    const message = await signIn(email.trim(), password)
    setSubmitting(false)
    if (message) setError(message)
    // On success the auth listener flips status to 'signed-in' and we redirect above.
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2 text-white">
          <Cog className="h-8 w-8 text-amber-400" aria-hidden />
          <span className="text-2xl font-semibold tracking-tight">Motor Health Checker</span>
        </div>

        <div className="rounded-lg bg-white p-6 shadow-lg">
          <h1 className="text-lg font-semibold text-slate-900">Sign in</h1>
          <p className="mb-4 mt-1 text-sm text-slate-500">
            Access is limited to the authorized account. There is no public registration.
          </p>

          {status === 'unconfigured' ? (
            <Notice kind="error">
              <p className="font-medium">Supabase is not configured.</p>
              <p className="mt-1">
                Missing: {missingEnvVars.join(', ')}. Copy <code>.env.example</code> to <code>.env</code>, fill in
                your project URL and anon key, then restart the dev server. See the README.
              </p>
            </Notice>
          ) : status === 'loading' ? (
            <LoadingState label="Checking your session…" />
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              {sessionError && <Notice kind="error">{sessionError}</Notice>}
              {error && <Notice kind="error">{error}</Notice>}

              <label htmlFor="email" className="block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mb-4 mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
              />

              <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mb-5 mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
              />

              <button
                type="submit"
                disabled={submitting || email.trim() === '' || password === ''}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <LogIn className="h-4 w-4" aria-hidden />
                )}
                {submitting ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
