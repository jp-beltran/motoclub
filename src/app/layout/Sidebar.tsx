import {
  Boxes,
  CalendarCheck,
  CreditCard,
  LayoutDashboard,
  Menu,
  Package,
  PlusCircle,
  Receipt,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { NavLink } from 'react-router-dom'

interface NavItem {
  readonly to: string
  readonly label: string
  readonly icon: LucideIcon
  readonly end?: boolean
}

const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Painel', icon: LayoutDashboard, end: true },
  { to: '/lancamentos', label: 'Lançamentos', icon: PlusCircle },
  { to: '/consumidores', label: 'Consumidores', icon: Users },
  { to: '/itens', label: 'Itens', icon: Package },
  { to: '/comandas', label: 'Comandas', icon: Receipt },
  { to: '/fechamento', label: 'Fechamento', icon: CalendarCheck },
  { to: '/pagamentos', label: 'Pagamentos', icon: CreditCard },
  { to: '/estoque', label: 'Estoque', icon: Boxes },
]

const NAV_ID = 'app-navigation'

export function Sidebar() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <aside className="border-b border-border-subtle bg-surface-raised md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:flex-col md:border-b-0 md:border-r">
      <div className="flex items-center justify-between px-4 py-3 md:px-5 md:py-6">
        <span className="text-lg font-bold tracking-tight text-content-primary">Motoclub</span>
        <button
          type="button"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-content-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:hidden"
          aria-expanded={isOpen}
          aria-controls={NAV_ID}
          onClick={() => setIsOpen((open) => !open)}
        >
          {isOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          <span className="sr-only">{isOpen ? 'Fechar menu' : 'Abrir menu'}</span>
        </button>
      </div>
      <nav
        id={NAV_ID}
        aria-label="Navegação principal"
        className={`${isOpen ? 'block' : 'hidden'} px-3 pb-4 md:block md:flex-1 md:overflow-y-auto`}
      >
        <ul className="flex flex-col gap-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    isActive
                      ? 'bg-surface-overlay text-accent'
                      : 'text-content-muted hover:bg-surface-overlay hover:text-content-primary'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden="true"
                      className={`h-2 w-2 shrink-0 rounded-full ${isActive ? 'bg-accent' : 'bg-transparent'}`}
                    />
                    <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
                    <span>{label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}
