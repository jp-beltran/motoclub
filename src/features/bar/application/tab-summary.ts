import {
  CHARGE_KIND,
  CONSUMPTION_STATUS,
  PAYMENT_TARGET,
  TAB_KIND,
} from '../domain/constants'
import type { Consumer, Consumption, Tab } from '../domain/entities'
import { getConsumptionLineTotalCents, summarizeTabConsumptions } from '../domain/financials'
import { addCents } from '../domain/money'
import { summarizePayments, type PaymentSummary } from '../domain/payments'
import type { BarDatabase } from './bar-repository'

export interface TabLine {
  readonly itemId: string
  readonly itemName: string
  readonly quantity: number
  readonly unitPriceCents: number
  readonly subtotalCents: number
}

export interface TabSummary {
  readonly tab: Tab
  readonly consumer: Consumer
  /** Charged lines, one per item, in the order each item was first launched. */
  readonly lines: readonly TabLine[]
  /**
   * Courtesy lines, in the same shape, carrying the value that was given away.
   * They are never part of `totalCents`.
   */
  readonly courtesyLines: readonly TabLine[]
  /** Amount due, from `summarizeTabConsumptions` — courtesy excluded. */
  readonly totalCents: number
  /**
   * Settlement of this tab's own payments (`target: 'tab'`). A monthly tab is
   * settled through its member statement after the monthly closing, so it
   * reports the whole total as remaining here.
   */
  readonly payment: PaymentSummary
}

const UNKNOWN_ITEM_NAME = 'Item removido'

/**
 * Pure read model of one tab: its consumption grouped per item, the amount due
 * and how much of it is settled. Every monetary value comes from the domain.
 * Returns `undefined` when the tab or its consumer is not in the snapshot.
 */
export function summarizeTab(
  snapshot: BarDatabase,
  tabId: string,
): TabSummary | undefined {
  const tab = snapshot.tabs.find(({ id }) => id === tabId)
  if (!tab) return undefined

  const consumerId = tab.kind === TAB_KIND.MONTHLY ? tab.memberId : tab.visitorId
  const consumer = snapshot.consumers.find(({ id }) => id === consumerId)
  if (!consumer) return undefined

  const active = snapshot.consumptions.filter(
    (consumption) =>
      consumption.tabId === tab.id &&
      consumption.status === CONSUMPTION_STATUS.ACTIVE,
  )
  const itemNameById = new Map(snapshot.items.map(({ id, name }) => [id, name]))
  const isCharged = (consumption: Consumption) =>
    consumption.chargeKind === CHARGE_KIND.CHARGED
  const totalCents = summarizeTabConsumptions(active).totalCents

  return {
    tab,
    consumer,
    lines: groupIntoLines(active.filter(isCharged), itemNameById),
    courtesyLines: groupIntoLines(
      active.filter((consumption) => !isCharged(consumption)),
      itemNameById,
    ),
    totalCents,
    payment: summarizePayments(
      totalCents,
      snapshot.payments.filter(
        ({ target, targetId }) => target === PAYMENT_TARGET.TAB && targetId === tab.id,
      ),
    ),
  }
}

function groupIntoLines(
  consumptions: readonly Consumption[],
  itemNameById: ReadonlyMap<string, string>,
): readonly TabLine[] {
  const lines = new Map<string, TabLine>()

  consumptions.forEach((consumption) => {
    const current = lines.get(consumption.itemId)
    const lineTotalCents = getConsumptionLineTotalCents(consumption)
    lines.set(consumption.itemId, {
      itemId: consumption.itemId,
      itemName: itemNameById.get(consumption.itemId) ?? UNKNOWN_ITEM_NAME,
      quantity: (current?.quantity ?? 0) + consumption.quantity,
      unitPriceCents: consumption.unitPriceCents,
      subtotalCents: addCents(current?.subtotalCents ?? 0, lineTotalCents),
    })
  })

  return [...lines.values()]
}
