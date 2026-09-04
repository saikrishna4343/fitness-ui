import {
  Apple,
  CalendarDays,
  Dumbbell,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Settings as SettingsIcon,
  Sun,
  Timer,
  TrendingUp,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useProfile } from '@/api/hooks'
import { useAuth } from '@/auth/AuthProvider'
import { useTheme } from '@/components/ThemeProvider'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { fullName } from '@/lib/format'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/food', label: 'Food log', icon: Apple, end: false },
  { to: '/workout', label: "Today's workout", icon: Dumbbell, end: false },
  { to: '/plan', label: 'Weekly plan', icon: CalendarDays, end: false },
  { to: '/timer', label: 'Interval timer', icon: Timer, end: false },
  { to: '/progress', label: 'Progress', icon: TrendingUp, end: false },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, end: false },
]

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { signOut } = useAuth()
  const { data: profile } = useProfile()
  const { theme, toggle } = useTheme()

  const nav = (
    <nav className="flex flex-col gap-1">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={() => setMobileOpen(false)}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                : 'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            )
          }
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  )

  return (
    <div className="min-h-svh bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r bg-sidebar p-4 lg:flex">
        <Brand />
        <Separator className="my-4" />
        {nav}
        <div className="mt-auto space-y-1">
          <Separator className="my-3" />
          <p className="truncate px-3 pb-1 text-xs text-muted-foreground">
            {fullName(profile?.firstName, profile?.lastName) ?? 'Signed in'}
          </p>
          <Button variant="ghost" size="sm" className="w-full justify-start gap-3" onClick={toggle}>
            {theme === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}
            {theme === 'dark' ? 'Dark' : 'Light'} theme
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-3 text-muted-foreground"
            onClick={() => void signOut()}
          >
            <LogOut className="size-4" />
            Sign out
          </Button>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/85 px-4 py-3 backdrop-blur lg:hidden">
        <Button variant="ghost" size="icon" onClick={() => setMobileOpen((open) => !open)}>
          <Menu className="size-5" />
          <span className="sr-only">Toggle navigation</span>
        </Button>
        <Brand />
        <Button variant="ghost" size="icon" className="ml-auto" onClick={toggle}>
          {theme === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}
          <span className="sr-only">Toggle theme</span>
        </Button>
      </header>

      {mobileOpen && (
        <div className="border-b bg-sidebar px-4 py-3 lg:hidden">
          {nav}
          <Separator className="my-3" />
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-3 text-muted-foreground"
            onClick={() => void signOut()}
          >
            <LogOut className="size-4" />
            Sign out
          </Button>
        </div>
      )}

      <main className="lg:pl-64">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:py-10">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Dumbbell className="size-4" />
      </span>
      <span className="text-base font-semibold tracking-tight">Fitness</span>
    </div>
  )
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  )
}
