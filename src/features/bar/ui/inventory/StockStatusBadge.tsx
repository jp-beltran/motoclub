import type { Item } from '../../domain/entities'
import { describeStockStatus } from './stock-status'

export interface StockStatusBadgeProps {
  readonly item: Item
}

export function StockStatusBadge({ item }: StockStatusBadgeProps) {
  const status = describeStockStatus(item)
  return (
    <span className={status.critical ? 'font-semibold text-warning' : 'text-content-primary'}>
      {status.label}
    </span>
  )
}
