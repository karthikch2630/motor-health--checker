// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import RequireAuth from './RequireAuth'
import SignInPage from '../pages/SignInPage'
import type { AuthStatus } from '../lib/auth'

// Mock the auth hook: these tests cover UI reactions to auth state, not Supabase itself.
const auth = vi.hoisted(() => ({
  current: { status: 'signed-out', user: null, sessionError: null, signIn: vi.fn(), signOut: vi.fn() } as {
    status: AuthStatus
    user: unknown
    sessionError: string | null
    signIn: ReturnType<typeof vi.fn>
    signOut: ReturnType<typeof vi.fn>
  },
}))
vi.mock('../lib/auth', () => ({ useAuth: () => auth.current }))

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/signin" element={<SignInPage />} />
        <Route element={<RequireAuth />}>
          <Route index element={<p>Dashboard content</p>} />
          <Route path="motors" element={<p>Motors content</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  auth.current.status = 'signed-out'
  auth.current.sessionError = null
  auth.current.signIn = vi.fn()
})

describe('RequireAuth', () => {
  it('redirects unauthenticated users to sign-in', () => {
    renderApp('/motors')
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByText('Motors content')).not.toBeInTheDocument()
  })

  it('shows a loading state while the session is restored, not protected content', () => {
    auth.current.status = 'loading'
    renderApp('/motors')
    expect(screen.getByRole('status')).toHaveTextContent(/checking your session/i)
    expect(screen.queryByText('Motors content')).not.toBeInTheDocument()
  })

  it('renders private routes for a signed-in user', () => {
    auth.current.status = 'signed-in'
    renderApp('/motors')
    expect(screen.getByText('Motors content')).toBeInTheDocument()
  })

  it('treats an unconfigured app as not signed in', () => {
    auth.current.status = 'unconfigured'
    renderApp('/')
    expect(screen.queryByText('Dashboard content')).not.toBeInTheDocument()
    expect(screen.getByText(/Supabase is not configured/)).toBeInTheDocument()
  })
})

describe('SignInPage', () => {
  it('redirects an already signed-in user to the dashboard', () => {
    auth.current.status = 'signed-in'
    renderApp('/signin')
    expect(screen.getByText('Dashboard content')).toBeInTheDocument()
  })

  it('shows the error returned for invalid credentials and re-enables the form', async () => {
    auth.current.signIn = vi.fn().mockResolvedValue('Invalid email or password.')
    renderApp('/signin')
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Email'), 'me@example.com')
    await user.type(screen.getByLabelText('Password'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.')
    expect(auth.current.signIn).toHaveBeenCalledWith('me@example.com', 'wrong')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled())
  })

  it('has no sign-up or registration link', () => {
    renderApp('/signin')
    expect(screen.queryByText(/sign up|register|create account/i)).not.toBeInTheDocument()
  })

  it('keeps the submit button disabled until both fields are filled', () => {
    renderApp('/signin')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
  })
})
