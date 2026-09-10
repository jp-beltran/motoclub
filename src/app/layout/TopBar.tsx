import { HelpCircle } from 'lucide-react'
import { Link } from 'react-router-dom'

import { CURRENT_ACTOR_NAME } from '../../features/bar/application/actor'
import { useResetDemo } from '../../features/bar/application/queries'
import {
  BAR_ERROR_FALLBACKS,
  describeBarError,
} from '../../features/bar/application/error-messages'
import { useTutorial } from '../../features/tutorial/tutorial-context'
import { Button } from '../../shared/ui/Button'

const RESET_DEMO_CONFIRM_MESSAGE =
  'Restaurar os dados de demonstração? Isso substitui os dados salvos neste navegador.'

interface TopBarProps {
  readonly activeEventName?: string
}

export function TopBar({ activeEventName }: TopBarProps) {
  const resetDemo = useResetDemo()
  const tutorial = useTutorial()

  /**
   * Restoring the demo is the app's only way back from broken persisted
   * state, so a failure has to say so: the button re-enables itself the
   * moment the mutation settles, and without this the operator would be left
   * clicking a control that silently does nothing.
   */
  function handleResetDemo() {
    if (window.confirm(RESET_DEMO_CONFIRM_MESSAGE)) {
      resetDemo.reset()
      resetDemo.mutate()
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
        <Button variant="ghost" onClick={handleResetDemo} disabled={resetDemo.isPending}>
          Restaurar demonstração
        </Button>
        {resetDemo.isError ? (
          <p role="alert" className="w-full text-right text-sm font-medium text-accent">
            {describeBarError(resetDemo.error, BAR_ERROR_FALLBACKS.resetDemo)}
          </p>
        ) : null}
      </div>
    </header>
  )
}
