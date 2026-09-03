import type { BarDatabase } from '../../application/bar-repository'
import { CHARGE_KIND, CONSUMPTION_STATUS } from '../../domain/constants'
import type { ActiveConsumption, Tab } from '../../domain/entities'
import { getConsumptionLineTotalCents } from '../../domain/financials'

export const RECENT_LAUNCH_LIMIT = 10

export interface RecentLaunch {
  readonly consumption: ActiveConsumption
  readonly tab: Tab
  readonly itemName: string
  readonly consumerName: string
  readonly lineTotalCents: number
  readonly isCourtesy: boolean
}

/**
 * The newest launches of the reference day, ready for the correction panel.
 * Cancelled consumption is left out because none of the row actions (edit,
 * move, cancel) apply to it.
 */
export function listRecentLaunches(
  snapshot: BarDatabase,
  reference: Date,
): readonly RecentLaunch[] {
  const itemNameById = new Map(snapshot.items.map(({ id, name }) => [id, name]))
  const consumerNameById = new Map(snapshot.consumers.map(({ id, name }) => [id, name]))
  const tabById = new Map(snapshot.tabs.map((tab) => [tab.id, tab]))

  return snapshot.consumptions
    .filter(
      (consumption): consumption is ActiveConsumption =>
        consumption.status === CONSUMPTION_STATUS.ACTIVE &&
        isSameLocalDay(new Date(consumption.createdAt), reference),
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, RECENT_LAUNCH_LIMIT)
    .flatMap((consumption) => {
      const tab = tabById.get(consumption.tabId)
      if (!tab) return []
      return [{
        consumption,
        tab,
        itemName: itemNameById.get(consumption.itemId) ?? 'Item removido',
        consumerName: consumerNameById.get(consumption.consumerId) ?? 'Consumidor removido',
        lineTotalCents: getConsumptionLineTotalCents(consumption),
        isCourtesy: consumption.chargeKind === CHARGE_KIND.COURTESY,
      }]
    })
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}
