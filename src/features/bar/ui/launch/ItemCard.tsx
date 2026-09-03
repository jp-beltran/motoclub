import { useState } from 'react'

import { LOW_STOCK_THRESHOLD } from '../../application/constants'
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

function StockHint({ item }: { readonly item: Item }) {
  if (item.stockQuantity === undefined) {
    return <span className="text-xs text-content-muted">Estoque não controlado</span>
  }
  const isLow = item.stockQuantity < LOW_STOCK_THRESHOLD
  return (
    <span className={`text-xs ${isLow ? 'text-warning' : 'text-content-muted'}`}>
      {`Estoque estimado: ${formatQuantity(item.stockQuantity)}`}
      {isLow ? ' · estoque baixo' : ''}
    </span>
  )
}
