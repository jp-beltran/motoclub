import { HelpCircle, LogOut } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { CURRENT_ACTOR_NAME } from '../../features/bar/application/actor'
import { useTutorial } from '../../features/tutorial/tutorial-context'
import { Button } from '../../shared/ui/Button'
import { DevResetDemoButton } from './DevResetDemoButton'

interface TopBarProps {
  readonly activeEventName?: string
}

const LOGOUT_FAILED_MESSAGE = 'Não foi possível sair. Tente novamente.'

export function TopBar({ activeEventName }: TopBarProps) {
  const tutorial = useTutorial()
  const [logoutError, setLogoutError] = useState<string>()

  /**
   * O portão é uma ramificação do servidor, não um destino do roteador:
   * depois que o cookie cai, recarregar a mesma URL já devolve a tela de
   * login. Por isso `reload()` e não `navigate('/login')` — rota de login
   * não existe no cliente.
   */
  async function handleLogout() {
    setLogoutError(undefined)
    try {
      const response = await fetch('/api/logout', { method: 'POST' })
      if (!response.ok) {
        setLogoutError(LOGOUT_FAILED_MESSAGE)
        return
      }
      window.location.reload()
    } catch {
      setLogoutError(LOGOUT_FAILED_MESSAGE)
    }
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-surface-raised px-4 py-3 md:px-6">
      {/* The active event is readable from every screen; this makes it
          reachable too. `/comandas` is where the event is opened and where
          its visitor tabs are listed, so the name that says "Nenhum evento
          ativo" is also the way to go and fix that. */}
      <Link
        to="/comandas"
        className="flex min-h-11 flex-col justify-center rounded-md px-2 hover:bg-surface-overlay focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-content-muted">
          Evento ativo
        </span>
        <span className="text-sm font-medium text-content-primary">
          {activeEventName ?? 'Nenhum evento ativo'}
        </span>
      </Link>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <p className="text-sm text-content-muted">
          Operador: <span className="font-medium text-content-primary">{CURRENT_ACTOR_NAME}</span>
        </p>
        {/* Always available, and the closing step of the tour points at it
            so the operator knows where to come back to. */}
        <Button variant="ghost" data-tutorial="botao-tutorial" onClick={tutorial.open}>
          <HelpCircle aria-hidden="true" className="h-4 w-4" />
          Tutorial
        </Button>
        {/* Development only, and gone from the production bundle rather than
            merely hidden — see DevResetDemoButton for why, and for the grep
            that proves it. */}
        {import.meta.env.DEV ? <DevResetDemoButton /> : null}
        <Button variant="ghost" onClick={handleLogout}>
          <LogOut aria-hidden="true" className="h-4 w-4" />
          Sair
        </Button>
        {logoutError ? (
          <p role="alert" className="text-sm text-accent">
            {logoutError}
          </p>
        ) : null}
      </div>
    </header>
  )
}
