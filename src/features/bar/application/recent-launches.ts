import type { BarDatabase } from './bar-repository'
import { RECENT_LAUNCH_LIMIT } from './constants'
import {
  findCancellationBlock,
  type CancellationBlock,
} from '../domain/cancellation'
import { CHARGE_KIND, CONSUMPTION_STATUS } from '../domain/constants'
import type { ActiveConsumption, Tab } from '../domain/entities'
import { getConsumptionLineTotalCents } from '../domain/financials'

export interface RecentLaunch {
  readonly consumption: ActiveConsumption
  readonly tab: Tab
  readonly itemName: string
  readonly consumerName: string
  readonly lineTotalCents: number
  readonly isCourtesy: boolean
  /**
   * Set when the repository would refuse to undo this launch, so the panel
   * can disable the correction actions with the reason instead of offering
   * a click that fails. `undefined` means it is freely correctable.
   */
  readonly cancellationBlock?: CancellationBlock
}

/**
 * The newest launches of the reference day, ready for the correction panel.
 * Cancelled consumption is left out because none of the row actions (edit,
 * move, cancel) apply to it.
 *
 * Each row also carries whichever `findCancellationBlock` reason applies, so
 * the panel offers "Cancelar" and "Editar quantidade" only where the
 * repository would actually accept them — both go through
 * `cancelConsumption`, which refuses a launch already frozen into a
 * statement, sitting on a closed tab, or covered by a settled payment.
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
        cancellationBlock: findCancellationBlock(snapshot, consumption.id),
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
