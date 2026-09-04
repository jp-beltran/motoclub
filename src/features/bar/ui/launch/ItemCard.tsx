import { useState } from 'react'

import { isLowStock, isStockDeficit } from '../../application/stock-levels'
import { CHARGE_KIND, type ChargeKind } from '../../domain/constants'
import type { Item } from '../../domain/entities'
import { formatCents, formatQuantity } from '../../../../shared/format'
import { Button } from '../../../../shared/ui/Button'

export interface ItemCardProps {
  readonly item: Item
  readonly onLaunch: (quantity: number, chargeKind: ChargeKind) => void
}

/**
 * The whole card is one big tap target that launches a single unit, because
 * that is the standard path and it must never cost more than one click.
 * Quantity and courtesy live behind a secondary disclosure so they cannot slow
 * it down.
 */
export function ItemCard({ item, onLaunch }: ItemCardProps) {
  const [isAdjusting, setIsAdjusting] = useState(false)
  const [quantity, setQuantity] = useState('1')

  const parsedQuantity = Number.parseInt(quantity, 10)
  const hasValidQuantity = Number.isInteger(parsedQuantity) && parsedQuantity > 0

  function launch(chargeKind: ChargeKind) {
    if (!hasValidQuantity) return
    onLaunch(parsedQuantity, chargeKind)
    setIsAdjusting(false)
    setQuantity('1')
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-raised p-2">
      <button
        type="button"
        aria-label={`Lançar ${item.name}`}
        onClick={() => onLaunch(1, CHARGE_KIND.CHARGED)}
        className="flex min-h-24 flex-col items-start gap-1 rounded-md p-3 text-left transition-colors hover:bg-surface-overlay focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="text-base font-semibold text-content-primary">{item.name}</span>
        <span className="text-lg font-semibold text-content-primary">
          {formatCents(item.unitPriceCents)}
        </span>
        <StockHint item={item} />
      </button>

      <Button
        variant="ghost"
        aria-label={`Quantidade e cortesia de ${item.name}`}
        aria-expanded={isAdjusting}
        onClick={() => setIsAdjusting((current) => !current)}
        className="text-xs"
      >
        Quantidade e cortesia
      </Button>

      {isAdjusting ? (
        <div className="flex flex-col gap-2 rounded-md bg-surface-overlay p-3">
          <label className="flex flex-col gap-1 text-xs text-content-muted">
            {`Quantidade de ${item.name}`}
            <input
              type="number"
              min={1}
              step={1}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="min-h-11 w-full rounded-md border border-border-subtle bg-surface-base px-3 text-sm text-content-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              aria-label={`Confirmar lançamento de ${item.name}`}
              disabled={!hasValidQuantity}
              onClick={() => launch(CHARGE_KIND.CHARGED)}
              className="text-xs"
            >
              Lançar
            </Button>
            <Button
              variant="ghost"
              aria-label={`Lançar cortesia de ${item.name}`}
              disabled={!hasValidQuantity}
              onClick={() => launch(CHARGE_KIND.COURTESY)}
              className="text-xs"
            >
              Cortesia
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * The stock level of the item about to be sold. Both predicates come from
 * `application/stock-levels.ts`, shared with `/estoque` and the dashboard,
 * because this card's own inline `<` used to leave an item sitting exactly
 * on the threshold looking neutral here while both of those called it
 * critical.
 *
 * A negative balance is named as a deficit rather than as "baixo": it means
 * the count itself is wrong, and the launch stays available either way — the
 * shortage warning must never block the record.
 */
function StockHint({ item }: { readonly item: Item }) {
  if (item.stockQuantity === undefined) {
    return <span className="text-xs text-content-muted">Estoque não controlado</span>
  }
  const deficit = isStockDeficit(item.stockQuantity)
  const low = !deficit && isLowStock(item.stockQuantity)
  const tone = deficit ? 'text-accent' : low ? 'text-warning' : 'text-content-muted'
  const suffix = deficit ? ' · déficit, ajuste o estoque' : low ? ' · estoque baixo' : ''

  return (
    <span className={`text-xs ${tone}`}>
      {`Estoque estimado: ${formatQuantity(item.stockQuantity)}${suffix}`}
    </span>
  )
}
