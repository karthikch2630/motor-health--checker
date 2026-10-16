// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from '../App'

// Access-control assumption: every test-entry route sits behind the auth guard.
// (Row-level security is what actually protects data; this only checks the UI does not expose the routes.)
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ status: 'signed-out', user: null, sessionError: null, signIn: vi.fn(), signOut: vi.fn() }),
}))

describe('test entry routes require authentication', () => {
  it.each(['/', '/tests/new', '/tests/abc', '/tests/abc/assessments/2', '/history', '/reference', '/motors', '/motors/abc'])('%s redirects to sign-in', (path) => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument()
  })
})
