import { NavLink, Outlet } from 'react-router-dom'
import { logout } from '@/auth/session'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { navItems } from './nav-items'

function linkClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium',
    isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted',
  )
}

export function AppLayout() {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="hidden w-56 shrink-0 border-r border-border p-4 md:block">
        <p className="mb-4 px-3 text-lg font-semibold">Gestión del Hogar</p>
        <nav aria-label="Navegación principal" className="flex flex-col gap-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={linkClass}>
              <Icon aria-hidden className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-2">
          <p className="font-semibold md:invisible">Gestión del Hogar</p>
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            Cerrar sesión
          </Button>
        </header>
        <main className="flex-1 p-4 pb-24 md:pb-4">
          <Outlet />
        </main>
      </div>
      <nav
        aria-label="Navegación inferior"
        className="fixed inset-x-0 bottom-0 grid grid-flow-col auto-cols-fr border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center gap-1 py-2 text-xs font-medium',
                isActive ? 'text-primary' : 'text-muted-foreground',
              )
            }
          >
            <Icon aria-hidden className="size-5" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
