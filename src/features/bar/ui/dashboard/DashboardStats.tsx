import { formatCents } from '../../../../shared/format'
import { StatTile } from '../../../../shared/ui/StatTile'
import type { DashboardSummary } from '../../application/dashboard-summary'
import { formatMargin } from './format-margin'

export interface DashboardStatsProps {
  readonly summary: DashboardSummary
}

/** The dashboard's six financial indicator tiles. */
export function DashboardStats({ summary }: DashboardStatsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <StatTile label="Consumo do mês" value={formatCents(summary.revenueCents)} />
      <StatTile label="Recebido" value={formatCents(summary.receivedCents)} />
      {/* "(total)": pendingCents is everything still owed right now, across
          every month — not scoped to the month above, see dashboard-summary.ts */}
      <StatTile label="Pendente (total)" value={formatCents(summary.pendingCents)} />
      <StatTile label="Custo" value={formatCents(summary.costCents)} />
      <StatTile label="Lucro" value={formatCents(summary.profitCents)} />
      <StatTile label="Margem" value={formatMargin(summary.margin)} />
    </div>
  )
}
