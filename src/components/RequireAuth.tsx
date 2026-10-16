import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import LoadingState from './LoadingState'

/** Route guard: only renders child routes for a signed-in user. */
export default function RequireAuth() {
  const { status } = useAuth()
  if (status === 'loading') {
    return (
      <div className="mx-auto mt-24 max-w-md">
        <LoadingState label="Checking your session…" />
      </div>
    )
  }
  if (status !== 'signed-in') return <Navigate to="/signin" replace />
  return <Outlet />
}
