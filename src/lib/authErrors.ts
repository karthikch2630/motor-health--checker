/** Turns Supabase Auth / network errors into messages that are safe and useful to show. */
interface ErrorLike {
  message?: string
  name?: string
  status?: number
  code?: string
}

export function describeAuthError(error: unknown): string {
  const e = (error ?? {}) as ErrorLike
  const message = (e.message ?? '').toLowerCase()

  if (e.code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return 'This account has not been confirmed. Confirm it in the Supabase dashboard (Authentication → Users).'
  }
  if (e.code === 'invalid_credentials' || message.includes('invalid login credentials')) {
    return 'Invalid email or password.'
  }
  if (e.status === 429 || e.code === 'over_request_rate_limit') {
    return 'Too many attempts. Wait a few minutes and try again.'
  }
  if (
    e.name === 'AuthRetryableFetchError' ||
    e.name === 'TypeError' ||
    message.includes('failed to fetch') ||
    message.includes('network')
  ) {
    return 'Could not reach the server. Check your internet connection and the Supabase URL, then try again.'
  }
  return 'Sign-in failed. Please try again.'
}
