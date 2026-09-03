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
import { assertNonNegativeCents, multiplyCents } from './money'
import { assertPositiveIntegerQuantity } from './quantity'

const CLOSED_TAB_MESSAGE = 'Cannot add consumption to a closed tab'
const INACTIVE_CONSUMPTION_MESSAGE = 'Only active consumption can be cancelled'
const CONSUMPTION_ITEM_MISMATCH_MESSAGE = 'Consumption and item must match'
const STOCK_MOVEMENT_MISMATCH_MESSAGE =
  'Original stock movement must match the consumption and item'

export interface RecordConsumptionInput {
  readonly tab: Tab
  readonly item: Item
  readonly quantity: number
  readonly chargeKind: ChargeKind
  readonly actorId: string
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
    throw new Error(CLOSED_TAB_MESSAGE)
  }

  assertPositiveIntegerQuantity(input.quantity)
  assertNonNegativeCents(input.item.unitPriceCents)
  assertNonNegativeCents(input.item.unitCostCents)
  multiplyCents(input.item.unitPriceCents, input.quantity)

  const consumption = createConsumption(input, dependencies)

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

function createConsumption(
  input: RecordConsumptionInput,
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
    unitPriceCents: input.item.unitPriceCents,
    unitCostCents: input.item.unitCostCents,
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
    throw new Error(INACTIVE_CONSUMPTION_MESSAGE)
  }
  if (input.consumption.itemId !== input.item.id) {
    throw new Error(CONSUMPTION_ITEM_MISMATCH_MESSAGE)
  }
  if (input.originalStockMovement === undefined) return
  if (
    input.originalStockMovement.kind !== STOCK_MOVEMENT_KIND.CONSUMPTION ||
    input.originalStockMovement.consumptionId !== input.consumption.id ||
    input.originalStockMovement.itemId !== input.item.id ||
    input.originalStockMovement.quantityDelta !== -input.consumption.quantity
  ) {
    throw new Error(STOCK_MOVEMENT_MISMATCH_MESSAGE)
  }
}
