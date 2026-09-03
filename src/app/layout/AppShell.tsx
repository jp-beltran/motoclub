import { Outlet } from 'react-router-dom'

import { getActiveEvent } from '../../features/bar/application/active-event'
import { useBarSnapshot, useResetDemo } from '../../features/bar/application/queries'
import { Button } from '../../shared/ui/Button'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

const RESET_DEMO_CONFIRM_MESSAGE =
  'Restaurar os dados de demonstração? Isso substitui os dados salvos neste navegador.'

export function AppShell() {
  const snapshotQuery = useBarSnapshot()
  const resetDemo = useResetDemo()

  const activeEventName = snapshotQuery.data
    ? getActiveEvent(snapshotQuery.data.events)?.name
    : undefined

  function handleResetDemo() {
    if (window.confirm(RESET_DEMO_CONFIRM_MESSAGE)) {
      resetDemo.mutate()
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface-base text-content-primary md:flex-row">
      <Sidebar />
      <div className="flex min-h-screen flex-1 flex-col">
        <TopBar activeEventName={activeEventName} />
        <main className="flex-1 p-4 md:p-6">
          {snapshotQuery.isPending && <LoadingState />}
          {snapshotQuery.isError && (
            <PersistenceErrorState
              onRetry={() => snapshotQuery.refetch()}
              onResetDemo={handleResetDemo}
              isResetting={resetDemo.isPending}
            />
          )}
          {snapshotQuery.isSuccess && <Outlet />}
        </main>
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">Carregando dados do bar…</span>
      <div className="h-24 animate-pulse rounded-lg bg-surface-raised" />
      <div className="h-24 animate-pulse rounded-lg bg-surface-raised" />
      <div className="h-24 animate-pulse rounded-lg bg-surface-raised" />
    </div>
  )
}

interface PersistenceErrorStateProps {
  readonly onRetry: () => void
  readonly onResetDemo: () => void
  readonly isResetting: boolean
}

function PersistenceErrorState({ onRetry, onResetDemo, isResetting }: PersistenceErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-4 rounded-lg border border-accent bg-surface-raised p-6"
    >
      <div>
        <p className="text-base font-semibold text-content-primary">
          Não foi possível carregar os dados do bar.
        </p>
        <p className="mt-1 text-sm text-content-muted">
          Os dados salvos podem estar corrompidos ou em um formato não suportado.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" onClick={onRetry}>
          Tentar novamente
        </Button>
        <Button variant="danger" onClick={onResetDemo} disabled={isResetting}>
          Restaurar demonstração
        </Button>
      </div>
    </div>
  )
}
