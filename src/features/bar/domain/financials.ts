import { CHARGE_KIND, CONSUMPTION_STATUS } from './constants'
import type { Consumption } from './entities'
import { addCents } from './money'

export function getConsumptionLineTotalCents(consumption: Consumption): number {
  return consumption.quantity * consumption.unitPriceCents
}

export function summarizeTabConsumptions(consumptions: readonly Consumption[]): {
  totalCents: number
  courtesyConsumptions: readonly Consumption[]
} {
  const activeConsumptions = consumptions.filter(
    ({ status }) => status === CONSUMPTION_STATUS.ACTIVE,
  )
  const chargedConsumptions = activeConsumptions.filter(
    ({ chargeKind }) => chargeKind === CHARGE_KIND.CHARGED,
  )

  return {
    totalCents: chargedConsumptions.reduce(
      (total, consumption) =>
        addCents(total, getConsumptionLineTotalCents(consumption)),
      0,
    ),
    courtesyConsumptions: activeConsumptions.filter(
      ({ chargeKind }) => chargeKind === CHARGE_KIND.COURTESY,
    ),
  }
}

export function calculateFinancials(consumptions: readonly Consumption[]): {
  revenueCents: number
  costCents: number
  profitCents: number
  margin: number
} {
  const activeConsumptions = consumptions.filter(
    ({ status }) => status === CONSUMPTION_STATUS.ACTIVE,
  )
  const revenueCents = summarizeTabConsumptions(consumptions).totalCents
  const costCents = activeConsumptions.reduce(
    (total, consumption) =>
      addCents(total, consumption.quantity * consumption.unitCostCents),
    0,
  )
  const profitCents = revenueCents - costCents

  return {
    revenueCents,
    costCents,
    profitCents,
    margin: revenueCents === 0 ? 0 : profitCents / revenueCents,
  }
}
