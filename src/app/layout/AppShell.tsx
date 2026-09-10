import { Outlet } from 'react-router-dom'

import { getActiveEvent } from '../../features/bar/application/active-event'
import { useBarSnapshot } from '../../features/bar/application/queries'
import { TutorialTour } from '../../features/tutorial/TutorialTour'
import { Button } from '../../shared/ui/Button'
import { DevResetDemoButton } from './DevResetDemoButton'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

export function AppShell() {
  const snapshotQuery = useBarSnapshot()

  const activeEventName = snapshotQuery.data
    ? getActiveEvent(snapshotQuery.data.events)?.name
    : undefined

  return (
    <div className="flex min-h-screen flex-col bg-surface-base text-content-primary md:flex-row">
      <Sidebar />
      <div className="flex min-h-screen flex-1 flex-col">
        <TopBar activeEventName={activeEventName} />
        <main className="flex-1 p-4 md:p-6">
          {snapshotQuery.isPending && <LoadingState />}
          {snapshotQuery.isError && (
            <PersistenceErrorState onRetry={() => snapshotQuery.refetch()} />
          )}
          {snapshotQuery.isSuccess && <Outlet />}
        </main>
      </div>
      {/* Inside the router (it navigates between steps) and outside <main>
          (it floats over whichever screen is showing). */}
      <TutorialTour />
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
}

function PersistenceErrorState({ onRetry }: PersistenceErrorStateProps) {
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
        {/* The restore is destructive and development-only, exactly as in the
            top bar: in production a corrupt database is recovered by whoever
            administers the machine, not by reinstalling the demonstration
            over the month's real data. */}
        {import.meta.env.DEV ? <DevResetDemoButton variant="danger" /> : null}
      </div>
    </div>
  )
}
