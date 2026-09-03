import { summarizeDashboard } from '../features/bar/application/dashboard-summary'
import { useBarSnapshot } from '../features/bar/application/queries'
import { DashboardStats } from '../features/bar/ui/dashboard/DashboardStats'
import { LowStockItemsCard } from '../features/bar/ui/dashboard/LowStockItemsCard'
import { OpenTabsCard } from '../features/bar/ui/dashboard/OpenTabsCard'
import { formatMonth, getCurrentMonth } from '../shared/date'
import { EmptyState } from '../shared/ui/EmptyState'

export function DashboardPage() {
  const month = getCurrentMonth()
  const { data: snapshot, isPending, isError } = useBarSnapshot()
  const summary = snapshot ? summarizeDashboard(snapshot, month) : undefined

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-content-primary">Painel</h1>
        <p className="mt-1 text-content-muted">{formatMonth(month)}</p>
      </header>

      {isPending ? <p className="text-content-muted">Carregando painel…</p> : null}

      {isError ? (
        <EmptyState
          title="Não foi possível carregar o painel"
          description="Tente novamente em instantes."
        />
      ) : null}

      {summary ? (
        <>
          <DashboardStats summary={summary} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <OpenTabsCard openTabsCount={summary.openTabsCount} />
            <LowStockItemsCard items={summary.lowStockItems} />
          </div>
        </>
      ) : null}
    </div>
  )
}
