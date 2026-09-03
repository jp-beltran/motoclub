import { Card } from './Card'

export interface StatTileProps {
  readonly label: string
  readonly value: string
  readonly hint?: string
}

/**
 * Displays a single pre-formatted indicator (label + value). Callers own
 * all formatting (e.g. `formatCents`) — this component only lays it out.
 */
export function StatTile({ label, value, hint }: StatTileProps) {
  return (
    <Card>
      <p className="text-sm text-content-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-content-primary">{value}</p>
      {hint ? <p className="mt-1 text-xs text-content-muted">{hint}</p> : null}
    </Card>
  )
}
