import { describe, expect, it } from 'vitest'
import { describeAuthError } from './authErrors'
import { describeDbError } from './motors'

describe('describeAuthError', () => {
  it('maps invalid credentials', () => {
    expect(describeAuthError({ message: 'Invalid login credentials', status: 400 })).toBe('Invalid email or password.')
    expect(describeAuthError({ code: 'invalid_credentials' })).toBe('Invalid email or password.')
  })
  it('maps network failures', () => {
    expect(describeAuthError({ name: 'AuthRetryableFetchError', message: 'x' })).toMatch(/Could not reach the server/)
    expect(describeAuthError(new TypeError('Failed to fetch'))).toMatch(/Could not reach the server/)
  })
  it('maps unconfirmed email and rate limiting', () => {
    expect(describeAuthError({ code: 'email_not_confirmed' })).toMatch(/not been confirmed/)
    expect(describeAuthError({ status: 429 })).toMatch(/Too many attempts/)
  })
  it('names the cause for configuration, account and service errors', () => {
    expect(describeAuthError({ code: 'user_banned', status: 400 })).toMatch(/disabled/)
    expect(describeAuthError({ code: 'email_provider_disabled', status: 422 })).toMatch(/Email provider/)
    expect(describeAuthError({ code: 'validation_failed', status: 400 })).toMatch(/valid email/)
    expect(describeAuthError({ status: 401, message: 'Invalid API key' })).toMatch(/key was rejected/)
    expect(describeAuthError({ status: 500, code: 'unexpected_failure' })).toMatch(/server error/)
    expect(describeAuthError({ status: 504 })).toMatch(/timed out/)
  })
  it('an unknown error shows only a safe reference (code / status), never the server message', () => {
    const m = describeAuthError({ code: 'some_new_code', status: 418, message: 'token abc.def.ghi password hunter2' })
    expect(m).toMatch(/reference: some_new_code \/ 418/)
    expect(m).not.toMatch(/hunter2|abc\.def|token/)
    expect(describeAuthError({ code: 'bad code with spaces!' })).toBe('Sign-in failed. Please try again.')
  })
  it('does not leak unknown error text', () => {
    expect(describeAuthError({ message: 'internal secret detail' })).toBe('Sign-in failed. Please try again.')
    expect(describeAuthError(undefined)).toBe('Sign-in failed. Please try again.')
  })
})

describe('describeDbError', () => {
  it('maps duplicate motor tag', () => expect(describeDbError({ code: '23505' })).toMatch(/already exists/))
  it('maps check violations and permission errors', () => {
    expect(describeDbError({ code: '23514' })).toMatch(/check constraint/)
    expect(describeDbError({ code: '42501' })).toMatch(/permission/)
  })
  it('maps network errors', () => expect(describeDbError(new TypeError('Failed to fetch'))).toMatch(/Could not reach/))
  it('hides unknown error details', () => {
    expect(describeDbError({ code: 'XX000', message: 'secret internals' })).toBe(
      'The database request failed. Please try again.',
    )
  })
})
