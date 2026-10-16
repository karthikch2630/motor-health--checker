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
