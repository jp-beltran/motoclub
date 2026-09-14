import {
  CONSUMPTION_STATUS,
  STOCK_MOVEMENT_KIND,
  STOCK_WARNING,
  TAB_KIND,
  TAB_STATUS,
  type ChargeKind,
  type StockWarning,
} from './constants'
import type {
  ActiveConsumption,
  CancelledConsumption,
  Consumption,
  Item,
  StockMovement,
  Tab,
} from './entities'
import type { DomainDependencies } from './dependencies'
import { BarError } from './errors'
import { assertNonNegativeCents, multiplyCents } from './money'
import { assertPositiveIntegerQuantity } from './quantity'

const CLOSED_TAB_MESSAGE = 'Cannot add consumption to a closed tab'
const INACTIVE_CONSUMPTION_MESSAGE = 'Only active consumption can be cancelled'
const CONSUMPTION_ITEM_MISMATCH_MESSAGE = 'Consumption and item must match'
const STOCK_MOVEMENT_MISMATCH_MESSAGE =
  'Original stock movement must match the consumption and item'

/**
 * The money a consumption is recorded with. Always copied onto the
 * consumption itself (see `ConsumptionBase` in `entities.ts`), never read
 * back off the item afterwards — that copy is what lets a price be edited
 * without rewriting a sale the club already made.
 */
export interface ConsumptionPricing {
  readonly unitPriceCents: number
  readonly unitCostCents: number
}

export interface RecordConsumptionInput {
  readonly tab: Tab
  readonly item: Item
  readonly quantity: number
  readonly chargeKind: ChargeKind
  readonly actorId: string
  /**
   * The price and cost to record this line at, when they are **not** the
   * item's current ones. Absent — the normal case, a real sale — the item's
   * own price and cost are copied, which is what makes an edit in `/itens`
   * apply from the next sale onwards.
   *
   * Present only on a CORRECTION. `editConsumptionQuantity` does not edit a
   * consumption in place: it cancels the line and records a replacement, so
   * without this the replacement would be priced like any new sale, at the
   * item's price *today*. Fixing "3 beers, not 4" after a supplier increase
   * would then silently re-price the whole line and charge a member money
   * the club never sold them. A correction restates a line that already
   * exists; it must carry the money that line was recorded with.
   *
   * This is deliberately NOT reachable from `BarRepository`'s own
   * `CreateConsumptionInput`: a caller who could name its own price on a
   * new sale could charge anything. Only the repository's internal
   * correction path passes it — see `LocalBarRepository#recordConsumption`.
   */
  readonly pricing?: ConsumptionPricing
}

export interface ConsumptionResult {
  readonly consumption: ActiveConsumption
  readonly stockMovement?: StockMovement
  readonly warnings: readonly StockWarning[]
}

export interface CancelConsumptionInput {
  readonly consumption: Consumption
  readonly item: Item
  readonly originalStockMovement?: StockMovement
  readonly actorId: string
}

export interface CancellationResult {
  readonly consumption: CancelledConsumption
  readonly stockMovement?: StockMovement
}

export function recordConsumption(
  input: RecordConsumptionInput,
  dependencies: DomainDependencies,
): ConsumptionResult {
  if (input.tab.status === TAB_STATUS.CLOSED) {
    throw new BarError('tab-closed', CLOSED_TAB_MESSAGE)
  }

  // Resolved once, and every money guard below runs on the resolved values
  // rather than on `input.item` — otherwise a correction could validate the
  // item's current price and then record a different one.
  const pricing = resolvePricing(input)

  assertPositiveIntegerQuantity(input.quantity)
  assertNonNegativeCents(pricing.unitPriceCents)
  assertNonNegativeCents(pricing.unitCostCents)
  multiplyCents(pricing.unitPriceCents, input.quantity)
  multiplyCents(pricing.unitCostCents, input.quantity)

  const consumption = createConsumption(input, pricing, dependencies)

  if (input.item.stockQuantity === undefined) {
    return { consumption, warnings: [] }
  }

  return {
    consumption,
    stockMovement: createStockMovement(input, consumption, dependencies),
    warnings:
      input.quantity > input.item.stockQuantity
        ? [STOCK_WARNING.INSUFFICIENT]
        : [],
  }
}

/**
 * The item's own money, unless the caller is correcting an existing line and
 * supplied the money that line was recorded with. The single place the two
 * cases are told apart, so nothing downstream has to ask again.
 */
function resolvePricing(input: RecordConsumptionInput): ConsumptionPricing {
  return (
    input.pricing ?? {
      unitPriceCents: input.item.unitPriceCents,
      unitCostCents: input.item.unitCostCents,
    }
  )
}

function createConsumption(
  input: RecordConsumptionInput,
  pricing: ConsumptionPricing,
  dependencies: DomainDependencies,
): ActiveConsumption {
  return {
    id: dependencies.nextId(),
    tabId: input.tab.id,
    consumerId:
      input.tab.kind === TAB_KIND.MONTHLY
        ? input.tab.memberId
        : input.tab.visitorId,
    itemId: input.item.id,
    status: CONSUMPTION_STATUS.ACTIVE,
    chargeKind: input.chargeKind,
    quantity: input.quantity,
    unitPriceCents: pricing.unitPriceCents,
    unitCostCents: pricing.unitCostCents,
    createdAt: dependencies.now(),
    actorId: input.actorId,
  }
}

function createStockMovement(
  input: RecordConsumptionInput,
  consumption: ActiveConsumption,
  dependencies: DomainDependencies,
): StockMovement {
  return {
    id: dependencies.nextId(),
    itemId: input.item.id,
    kind: STOCK_MOVEMENT_KIND.CONSUMPTION,
    quantityDelta: -input.quantity,
    occurredAt: consumption.createdAt,
    actorId: input.actorId,
    consumptionId: consumption.id,
  }
}

export function cancelConsumption(
  input: CancelConsumptionInput,
  dependencies: DomainDependencies,
): CancellationResult {
  assertValidCancellation(input)

  const cancelledAt = dependencies.now()
  const consumption: CancelledConsumption = {
    ...input.consumption,
    status: CONSUMPTION_STATUS.CANCELLED,
    cancelledAt,
    cancelledByActorId: input.actorId,
  }

  if (input.originalStockMovement === undefined) return { consumption }

  return {
    consumption,
    stockMovement: {
      id: dependencies.nextId(),
      itemId: input.item.id,
      kind: STOCK_MOVEMENT_KIND.REVERSAL,
      quantityDelta: -input.originalStockMovement.quantityDelta,
      occurredAt: cancelledAt,
      actorId: input.actorId,
      consumptionId: input.consumption.id,
    },
  }
}

function assertValidCancellation(input: CancelConsumptionInput): void {
  if (input.consumption.status !== CONSUMPTION_STATUS.ACTIVE) {
    throw new BarError('consumption-already-cancelled', INACTIVE_CONSUMPTION_MESSAGE)
  }
  if (input.consumption.itemId !== input.item.id) {
    throw new BarError('consumption-item-mismatch', CONSUMPTION_ITEM_MISMATCH_MESSAGE)
  }
  if (input.originalStockMovement === undefined) return
  if (
    input.originalStockMovement.kind !== STOCK_MOVEMENT_KIND.CONSUMPTION ||
    input.originalStockMovement.consumptionId !== input.consumption.id ||
    input.originalStockMovement.itemId !== input.item.id ||
    input.originalStockMovement.quantityDelta !== -input.consumption.quantity
  ) {
    throw new BarError('stock-movement-mismatch', STOCK_MOVEMENT_MISMATCH_MESSAGE)
  }
}
