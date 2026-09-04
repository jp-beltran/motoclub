import { CURRENT_ACTOR_NAME } from '../../features/bar/application/actor'
import { useResetDemo } from '../../features/bar/application/queries'
import { Button } from '../../shared/ui/Button'

const RESET_DEMO_CONFIRM_MESSAGE =
  'Restaurar os dados de demonstração? Isso substitui os dados salvos neste navegador.'
const RESET_DEMO_ERROR_MESSAGE =
  'Não foi possível restaurar a demonstração. Tente novamente.'

interface TopBarProps {
  readonly activeEventName?: string
}

export function TopBar({ activeEventName }: TopBarProps) {
  const resetDemo = useResetDemo()

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
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">
          Evento ativo
        </p>
        <p className="text-sm font-medium text-content-primary">
          {activeEventName ?? 'Nenhum evento ativo'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <p className="text-sm text-content-muted">
          Operador: <span className="font-medium text-content-primary">{CURRENT_ACTOR_NAME}</span>
        </p>
        <Button variant="ghost" onClick={handleResetDemo} disabled={resetDemo.isPending}>
          Restaurar demonstração
        </Button>
        {resetDemo.isError ? (
          <p role="alert" className="w-full text-right text-sm font-medium text-accent">
            {RESET_DEMO_ERROR_MESSAGE}
          </p>
        ) : null}
      </div>
    </header>
  )
}
