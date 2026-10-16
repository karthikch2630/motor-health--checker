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
  if (e.code === 'user_banned') return 'This account is disabled. Ask the administrator.'
  if (e.code === 'email_provider_disabled') {
    return 'Email and password sign-in is turned off for this project. The administrator must enable the Email provider in Supabase.'
  }
  if (e.code === 'validation_failed' || e.code === 'email_address_invalid') return 'Enter a valid email address and password.'
  if (e.code === 'captcha_failed') return 'The security check (captcha) failed. Reload the page and try again.'
  if (e.code === 'request_timeout' || e.status === 408 || e.status === 504) {
    return 'The sign-in request timed out. Try again.'
  }
  if (e.status === 401 || e.status === 403 || message.includes('invalid api key')) {
    return "The application's Supabase key was rejected. The administrator must check the project URL and anon key in the deployment settings."
  }
  if (e.code === 'unexpected_failure' || (typeof e.status === 'number' && e.status >= 500)) {
    return 'The authentication service reported a server error. Try again shortly; if it persists, the administrator should check the Supabase Auth logs.'
  }
  // Unknown error: show only a short reference (error code / HTTP status), never the server's message text.
  const ref = [e.code, e.status].filter((x) => x !== undefined && x !== null && /^[a-z0-9_]{1,60}$/i.test(String(x)))
  return ref.length > 0
    ? `Sign-in failed. Please try again. If it keeps failing, tell the administrator this reference: ${ref.join(' / ')}.`
    : 'Sign-in failed. Please try again.'
}
