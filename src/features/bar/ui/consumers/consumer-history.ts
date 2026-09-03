import type { BarDatabase } from '../../application/bar-repository'
import type { ConsumptionStatus } from '../../domain/constants'
import { getConsumptionLineTotalCents } from '../../domain/financials'

export interface ConsumerHistoryRow {
  readonly id: string
  readonly itemName: string
  readonly quantity: number
  readonly valueCents: number
  readonly createdAt: string
  readonly status: ConsumptionStatus
}

const UNKNOWN_ITEM_NAME = 'Item removido'

/**
 * Every consumption tied to `consumerId`, newest first. Cancelled entries
 * are included (never dropped) so the detail screen shows the full history —
 * they carry their own `status` for the UI to mark, and their value comes
 * straight from `getConsumptionLineTotalCents`, same as any other row.
 */
export function listConsumerHistory(
  snapshot: BarDatabase,
  consumerId: string,
): readonly ConsumerHistoryRow[] {
  const itemNameById = new Map(snapshot.items.map(({ id, name }) => [id, name]))

  return snapshot.consumptions
    .filter((consumption) => consumption.consumerId === consumerId)
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((consumption) => ({
      id: consumption.id,
      itemName: itemNameById.get(consumption.itemId) ?? UNKNOWN_ITEM_NAME,
      quantity: consumption.quantity,
      valueCents: getConsumptionLineTotalCents(consumption),
      createdAt: consumption.createdAt,
      status: consumption.status,
    }))
}
