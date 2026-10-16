import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { BookMarked, Cog, History, LayoutDashboard, LogOut, Settings2 } from 'lucide-react'
import Notice from '../components/Notice'
import { useAuth } from '../lib/auth'

const links = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/motors', label: 'Motors', icon: Settings2, end: false },
  { to: '/reference', label: 'Reference Data', icon: BookMarked, end: false },
  { to: '/history', label: 'Test History', icon: History, end: false },
]

export default function AppLayout() {
  const { user, signOut } = useAuth()
  const [signOutError, setSignOutError] = useState<string | null>(null)

  async function handleSignOut() {
    setSignOutError(null)
    const message = await signOut()
    if (message) setSignOutError(message)
  }

  return (
    <div className="min-h-screen">
      <header className="bg-slate-900 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <Cog className="h-6 w-6 text-amber-400" aria-hidden />
            <span className="text-lg font-semibold tracking-tight">Motor Health Checker</span>
          </div>
          <nav className="flex flex-wrap gap-1" aria-label="Main">
            {links.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                    isActive ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800'
                  }`
                }
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden max-w-48 truncate text-slate-300 sm:inline" title={user?.email ?? undefined}>
              {user?.email}
            </span>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        {signOutError && <Notice kind="error">{signOutError}</Notice>}
        <Outlet />
      </main>
    </div>
  )
}
