import { Link } from 'react-router-dom'

import { formatQuantity } from '../../../../shared/format'
import { Card } from '../../../../shared/ui/Card'
import { EmptyState } from '../../../../shared/ui/EmptyState'
import type { Item } from '../../domain/entities'

export interface LowStockItemsCardProps {
  readonly items: readonly Item[]
}

const LINK_CLASSES =
  'inline-flex min-h-11 items-center text-sm font-medium text-accent underline-offset-4 ' +
  'hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-accent'

/** Support card: items at or below the low-stock threshold, linking to the estoque area. */
export function LowStockItemsCard({ items }: LowStockItemsCardProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="Nenhum item em estoque crítico"
        description="Todos os itens controlados estão com estoque suficiente."
        action={
          <Link to="/estoque" className={LINK_CLASSES}>
            Ver estoque
          </Link>
        }
      />
    )
  }

  return (
    <Card>
      <p className="text-sm text-content-muted">Itens em estoque crítico</p>
      <ul className="mt-2 flex flex-col gap-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-3 text-sm text-content-primary"
          >
            <span>{item.name}</span>
            <span className="text-content-muted">
              {formatQuantity(item.stockQuantity ?? 0)} un.
            </span>
          </li>
        ))}
      </ul>
      <Link to="/estoque" className={`mt-3 ${LINK_CLASSES}`}>
        Ver estoque
      </Link>
    </Card>
  )
}
