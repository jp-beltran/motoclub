import type { Item } from '../../domain/entities'
import { describeStockStatus } from './stock-status'

export interface StockStatusBadgeProps {
  readonly item: Item
}

/**
 * Always paired with its pt-BR text — color alone never carries the state. A
 * deficit takes the accent tone rather than the warning one, because it is a
 * different problem from a low balance: the count is wrong, not just small.
 */
export function StockStatusBadge({ item }: StockStatusBadgeProps) {
  const status = describeStockStatus(item)
  return <span className={toneFor(status)}>{status.label}</span>
}

function toneFor(status: ReturnType<typeof describeStockStatus>): string {
  if (status.deficit) return 'font-semibold text-accent'
  return status.critical ? 'font-semibold text-warning' : 'text-content-primary'
}
