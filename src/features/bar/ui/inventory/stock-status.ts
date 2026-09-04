import { isLowStock as isLowQuantity, isStockDeficit } from '../../application/stock-levels'
import type { Item } from '../../domain/entities'
import { formatQuantity } from '../../../../shared/format'

export interface StockStatus {
  readonly label: string
  /** Needs the operator's attention: low, or already in deficit. */
  readonly critical: boolean
  /**
   * Below zero. Kept as a distinct state from `critical` because the two ask
   * for different things: a low item needs restocking, a deficit means the
   * physical count itself is wrong and only an adjustment fixes it.
   */
  readonly deficit: boolean
}

export function isLowStock(item: Item): boolean {
  return item.stockQuantity !== undefined && isLowQuantity(item.stockQuantity)
}

export function describeStockStatus(item: Item): StockStatus {
  if (item.stockQuantity === undefined) {
    return { label: 'Não controlado', critical: false, deficit: false }
  }
  const quantityLabel = formatQuantity(item.stockQuantity)
  if (isStockDeficit(item.stockQuantity)) {
    return {
      label: `${quantityLabel} (déficit — ajuste o estoque)`,
      critical: true,
      deficit: true,
    }
  }
  const critical = isLowStock(item)
  return {
    label: critical ? `${quantityLabel} (estoque crítico)` : quantityLabel,
    critical,
    deficit: false,
  }
}

export function getTrackedItems(items: readonly Item[]): Item[] {
  return items.filter((item) => item.stockQuantity !== undefined)
}
