import { LOW_STOCK_THRESHOLD } from '../../application/constants'
import type { Item } from '../../domain/entities'
import { formatQuantity } from '../../../../shared/format'

export interface StockStatus {
  readonly label: string
  readonly critical: boolean
}

export function isLowStock(item: Item): boolean {
  return item.stockQuantity !== undefined && item.stockQuantity <= LOW_STOCK_THRESHOLD
}

export function describeStockStatus(item: Item): StockStatus {
  if (item.stockQuantity === undefined) {
    return { label: 'Não controlado', critical: false }
  }
  const critical = isLowStock(item)
  const quantityLabel = formatQuantity(item.stockQuantity)
  return {
    label: critical ? `${quantityLabel} (estoque crítico)` : quantityLabel,
    critical,
  }
}

export function getTrackedItems(items: readonly Item[]): Item[] {
  return items.filter((item) => item.stockQuantity !== undefined)
}
