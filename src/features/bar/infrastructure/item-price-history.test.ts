import { describe, expect, it } from 'vitest'

import type { StorageLike } from '../application/bar-repository'
import { summarizeDashboard } from '../application/dashboard-summary'
import { listRecentLaunches } from '../application/recent-launches'
import { CHARGE_KIND, CONSUMPTION_STATUS } from '../domain/constants'
import { getConsumptionLineTotalCents } from '../domain/financials'
import { getCurrentMonth } from '../../../shared/date'
import { LocalBarRepository } from './local-bar-repository'

/**
 * WHY THIS FILE EXISTS, AND WHY IT MUST NOT BE "SIMPLIFIED" AWAY
 *
 * Editing a price is only safe because a consumption is not a pointer to an
 * item's current price: `ConsumptionBase` (see `domain/entities.ts`) carries
 * its own `unitPriceCents` and `unitCostCents`, copied at the moment of sale.
 * Every money total in the product — a tab's balance, a member's statement,
 * the month's revenue and margin — is computed from those copies
 * (`domain/financials.ts`), never by looking the item up again.
 *
 * That is what lets the operator fix a wrong price, or follow a supplier's
 * increase, without touching a single number the club already charged
 * somebody. It is also exactly the kind of duplication a future refactor
 * calls redundant: "the item already has the price, why store it twice?"
 * Removing it would silently rewrite the history of money — last month's
 * closed statements would change value retroactively, with nothing on screen
 * to say so.
 *
 * These tests are the tripwire on that refactor. If one of them fails, the
 * fix is never to update the expected number: it is to put the per-sale copy
 * back.
 */

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

const SALE_DAY = new Date()

function createRepository() {
  let id = 0
  return new LocalBarRepository({
    storage: new MemoryStorage(),
    storageKey: 'test-item-price-history',
    nextId: () => `price-${++id}`,
    // Today, so the consumption lands in the current month (the month
    // `summarizeDashboard` is asked about) and in the day
    // `listRecentLaunches` reports on.
    now: () => SALE_DAY.toISOString(),
  })
}

describe('changing an item price never rewrites a sale already recorded', () => {
  it('keeps a R$ 7,00 consumption at R$ 7,00 after the item goes to R$ 9,00', async () => {
    const repository = createRepository()
    const month = getCurrentMonth(SALE_DAY)
    const item = await repository.createItem({
      name: 'Cerveja artesanal',
      unitPriceCents: 700,
      unitCostCents: 350,
      category: 'Bebidas',
    })
    const tab = await repository.ensureMonthlyTab({ memberId: 'member-ana', month })

    const { consumption } = await repository.createConsumption({
      tabId: tab.id,
      itemId: item.id,
      quantity: 1,
      chargeKind: CHARGE_KIND.CHARGED,
      actorId: 'admin',
    })
    expect(consumption.unitPriceCents).toBe(700)
    expect(getConsumptionLineTotalCents(consumption)).toBe(700)

    const before = summarizeDashboard(await repository.getSnapshot(), month)

    const reprised = await repository.updateItem({ id: item.id, unitPriceCents: 900 })
    expect(reprised.unitPriceCents).toBe(900)

    const snapshot = await repository.getSnapshot()
    const stored = snapshot.consumptions.find(({ id }) => id === consumption.id)!
    expect(stored.unitPriceCents).toBe(700)
    expect(getConsumptionLineTotalCents(stored)).toBe(700)

    // The whole month, not just the one row: revenue, cost, profit and
    // margin all have to be byte-identical to what they were before the
    // price changed.
    const after = summarizeDashboard(snapshot, month)
    expect(after.revenueCents).toBe(before.revenueCents)
    expect(after.costCents).toBe(before.costCents)
    expect(after.profitCents).toBe(before.profitCents)
    expect(after.margin).toBe(before.margin)
  })

  it('keeps the cost of a recorded sale, so the margin of the month does not move either', async () => {
    const repository = createRepository()
    const month = getCurrentMonth(SALE_DAY)
    const item = await repository.createItem({
      name: 'Espetinho', unitPriceCents: 1200, unitCostCents: 500,
    })
    const tab = await repository.ensureMonthlyTab({ memberId: 'member-bruno', month })
    const { consumption } = await repository.createConsumption({
      tabId: tab.id, itemId: item.id, quantity: 3,
      chargeKind: CHARGE_KIND.CHARGED, actorId: 'admin',
    })

    const before = summarizeDashboard(await repository.getSnapshot(), month)
    await repository.updateItem({ id: item.id, unitCostCents: 800 })

    const snapshot = await repository.getSnapshot()
    expect(snapshot.consumptions.find(({ id }) => id === consumption.id)!.unitCostCents).toBe(500)
    expect(summarizeDashboard(snapshot, month).costCents).toBe(before.costCents)
  })

  it('prices the next sale with the new price, so the edit is not merely ignored', async () => {
    const repository = createRepository()
    const month = getCurrentMonth(SALE_DAY)
    const item = await repository.createItem({
      name: 'Refrigerante', unitPriceCents: 600, unitCostCents: 280,
    })
    const tab = await repository.ensureMonthlyTab({ memberId: 'member-celia', month })
    // The demo seed already sold things this month, so measure the delta
    // these two sales add rather than the absolute total.
    const seeded = summarizeDashboard(await repository.getSnapshot(), month).revenueCents
    const old = await repository.createConsumption({
      tabId: tab.id, itemId: item.id, quantity: 1,
      chargeKind: CHARGE_KIND.CHARGED, actorId: 'admin',
    })

    await repository.updateItem({ id: item.id, unitPriceCents: 650, unitCostCents: 300 })
    const fresh = await repository.createConsumption({
      tabId: tab.id, itemId: item.id, quantity: 1,
      chargeKind: CHARGE_KIND.CHARGED, actorId: 'admin',
    })

    expect(old.consumption.unitPriceCents).toBe(600)
    expect(fresh.consumption.unitPriceCents).toBe(650)
    expect(fresh.consumption.unitCostCents).toBe(300)
    // 600 + 650 side by side on the same tab: the two prices coexist,
    // which is the whole point.
    expect(summarizeDashboard(await repository.getSnapshot(), month).revenueCents)
      .toBe(seeded + 600 + 650)
  })
})

describe('retiring an item hides it from launching without erasing its sales', () => {
  it('keeps the consumption, the history and the month total after deactivation', async () => {
    const repository = createRepository()
    const month = getCurrentMonth(SALE_DAY)
    const item = await repository.createItem({
      name: 'Cerveja fora de linha', unitPriceCents: 700, unitCostCents: 350,
    })
    const tab = await repository.ensureMonthlyTab({ memberId: 'member-ana', month })
    const { consumption } = await repository.createConsumption({
      tabId: tab.id, itemId: item.id, quantity: 2,
      chargeKind: CHARGE_KIND.CHARGED, actorId: 'admin',
    })
    const before = summarizeDashboard(await repository.getSnapshot(), month)

    const retired = await repository.setItemActive({ id: item.id, active: false })
    expect(retired.active).toBe(false)

    const snapshot = await repository.getSnapshot()
    const stored = snapshot.consumptions.find(({ id }) => id === consumption.id)!
    expect(stored.status).toBe(CONSUMPTION_STATUS.ACTIVE)
    expect(stored.unitPriceCents).toBe(700)
    expect(summarizeDashboard(snapshot, month).revenueCents).toBe(before.revenueCents)

    // Still in the day's history, still naming the item — a sale does not
    // become anonymous because the product left the catalogue.
    expect(listRecentLaunches(snapshot, SALE_DAY).map((launch) => ({
      itemName: launch.itemName, lineTotalCents: launch.lineTotalCents,
    }))).toContainEqual({ itemName: 'Cerveja fora de linha', lineTotalCents: 1400 })

    // And the item itself is still in the catalogue, flagged, not deleted:
    // deleting it would orphan the consumption above.
    expect(snapshot.items.find(({ id }) => id === item.id)).toMatchObject({ active: false })
  })

  it('leaves the item out of the list /lancamentos offers, and in the one /itens shows', async () => {
    const repository = createRepository()
    const item = await repository.createItem({
      name: 'Item aposentado', unitPriceCents: 500, unitCostCents: 200,
    })
    await repository.setItemActive({ id: item.id, active: false })

    const items = await repository.listItems()
    // The exact predicate `LaunchScreen` passes to `ItemStep`.
    expect(items.filter(({ active }) => active !== false).map(({ id }) => id))
      .not.toContain(item.id)
    expect(items.map(({ id }) => id)).toContain(item.id)
  })
})
