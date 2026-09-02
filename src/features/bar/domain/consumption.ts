import {
  CONSUMPTION_STATUS,
  STOCK_MOVEMENT_KIND,
  STOCK_WARNING,
  TAB_STATUS,
  type ChargeKind,
  type StockWarning,
} from './constants'
import type { Consumption, Item, StockMovement, Tab } from './entities'
import type { DomainDependencies } from './dependencies'
import { assertIntegerCents } from './money'
import { assertPositiveIntegerQuantity } from './quantity'

const CLOSED_TAB_MESSAGE = 'Cannot add consumption to a closed tab'

export interface RecordConsumptionInput {
  readonly tab: Tab
  readonly consumerId: string
  readonly item: Item
  readonly quantity: number
  readonly chargeKind: ChargeKind
  readonly actorId: string
}

export interface ConsumptionResult {
  readonly consumption: Consumption
  readonly stockMovement?: StockMovement
  readonly warnings: readonly StockWarning[]
}

export interface CancelConsumptionInput {
  readonly consumption: Consumption
  readonly item: Item
  readonly actorId: string
}

export interface CancellationResult {
  readonly consumption: Consumption
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
  assertIntegerCents(input.item.unitPriceCents)
  assertIntegerCents(input.item.unitCostCents)

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
): Consumption {
  return {
    id: dependencies.nextId(),
    tabId: input.tab.id,
    consumerId: input.consumerId,
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
  consumption: Consumption,
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
  const cancelledAt = dependencies.now()
  const consumption: Consumption = {
    ...input.consumption,
    status: CONSUMPTION_STATUS.CANCELLED,
    cancelledAt,
    cancelledByActorId: input.actorId,
  }

  if (input.item.stockQuantity === undefined) return { consumption }

  return {
    consumption,
    stockMovement: {
      id: dependencies.nextId(),
      itemId: input.item.id,
      kind: STOCK_MOVEMENT_KIND.REVERSAL,
      quantityDelta: input.consumption.quantity,
      occurredAt: cancelledAt,
      actorId: input.actorId,
      consumptionId: input.consumption.id,
    },
  }
}
