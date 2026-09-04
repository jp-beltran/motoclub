import { describe, expect, it } from 'vitest'

import { formatMonthName, getCurrentMonth } from '../../../shared/date'
import {
  CHARGE_KIND,
  CONSUMER_KIND,
  EVENT_STATUS,
  PAYMENT_TARGET,
  TAB_KIND,
  TAB_STATUS,
} from '../domain/constants'
import { getMonthKey } from '../domain/month'
import { createDemoDatabase } from './demo-seed'

/** Every instant the seed writes, whatever entity it belongs to. */
function everyMoment(now: Date): readonly string[] {
  const database = createDemoDatabase(now)
  return [
    ...database.events.flatMap((event) => [event.startsAt, ...(event.endsAt ? [event.endsAt] : [])]),
    ...database.tabs.flatMap((tab) => [tab.openedAt, ...(tab.closedAt ? [tab.closedAt] : [])]),
    ...database.consumptions.map(({ createdAt }) => createdAt),
    ...database.payments.map(({ paidAt }) => paidAt),
    ...database.stockMovements.map(({ occurredAt }) => occurredAt),
  ]
}

/**
 * A month is picked for each case so the seed is exercised where its clamps
 * actually bite: the very first day of a month (everything has to collapse
 * forward into it), an ordinary day, and the last day of a long month.
 */
const REFERENCE_DAYS: readonly [string, Date][] = [
  ['the first day of a month', new Date(2027, 1, 1, 8, 30)],
  ['an ordinary mid-month day', new Date(2026, 9, 14, 19, 0)],
  ['the last day of a long month', new Date(2026, 11, 31, 23, 30)],
  ['the first day of a year', new Date(2028, 0, 1, 0, 30)],
]

describe('createDemoDatabase timeline', () => {
  it.each(REFERENCE_DAYS)('puts every instant inside the current month on %s', (_name, now) => {
    const month = getCurrentMonth(now)

    everyMoment(now).forEach((moment) => {
      expect(getMonthKey(moment)).toBe(month)
    })
  })

  it.each(REFERENCE_DAYS)('never dates the demo in the future on %s', (_name, now) => {
    everyMoment(now).forEach((moment) => {
      expect(new Date(moment).getTime()).toBeLessThanOrEqual(now.getTime())
    })
  })

  it.each(REFERENCE_DAYS)('stamps every monthly tab with that same month on %s', (_name, now) => {
    const database = createDemoDatabase(now)
    const monthlyTabs = database.tabs.filter((tab) => tab.kind === TAB_KIND.MONTHLY)

    expect(monthlyTabs).toHaveLength(3)
    monthlyTabs.forEach((tab) => {
      expect(tab.kind === TAB_KIND.MONTHLY && tab.month).toBe(getCurrentMonth(now))
    })
  })

  it.each(REFERENCE_DAYS)('names the active event after that month on %s', (_name, now) => {
    const active = createDemoDatabase(now).events.find(
      ({ status }) => status === EVENT_STATUS.ACTIVE,
    )

    expect(active?.name).toBe(`Encontro de ${formatMonthName(getCurrentMonth(now))}`)
  })
})

describe('createDemoDatabase narrative', () => {
  const NOW = new Date(2026, 9, 14, 19, 0)
  const database = createDemoDatabase(NOW)

  it('keeps one active event with two open visitor tabs on it', () => {
    const active = database.events.find(({ status }) => status === EVENT_STATUS.ACTIVE)!
    const visitorTabs = database.tabs.filter(
      (tab) => tab.kind === TAB_KIND.EVENT && tab.eventId === active.id,
    )

    expect(visitorTabs).toHaveLength(2)
    visitorTabs.forEach((tab) => expect(tab.status).toBe(TAB_STATUS.OPEN))
  })

  it('keeps a past event closed, so the demo has history behind it', () => {
    expect(database.events.filter(({ status }) => status === EVENT_STATUS.CLOSED)).toHaveLength(1)
  })

  it('gives two of the three members accumulated consumption this month', () => {
    const memberIds = database.consumers
      .filter(({ kind }) => kind === CONSUMER_KIND.MEMBER)
      .map(({ id }) => id)
    const consuming = new Set(
      database.consumptions
        .filter(({ consumerId }) => memberIds.includes(consumerId))
        .map(({ consumerId }) => consumerId),
    )

    expect(memberIds).toHaveLength(3)
    expect(consuming.size).toBe(2)
  })

  it('leaves exactly one visitor tab partially paid', () => {
    expect(database.payments).toHaveLength(1)
    const [payment] = database.payments
    const tabTotalCents = database.consumptions
      .filter(({ tabId, chargeKind }) =>
        tabId === payment.targetId && chargeKind === CHARGE_KIND.CHARGED,
      )
      .reduce((total, { quantity, unitPriceCents }) => total + quantity * unitPriceCents, 0)

    expect(payment.target).toBe(PAYMENT_TARGET.TAB)
    expect(payment.amountCents).toBeGreaterThan(0)
    expect(payment.amountCents).toBeLessThan(tabTotalCents)
  })

  it('keeps a courtesy line, so a zero-total tab is part of the demo', () => {
    expect(
      database.consumptions.filter(({ chargeKind }) => chargeKind === CHARGE_KIND.COURTESY),
    ).toHaveLength(1)
  })

  it('starts with nothing closed, so /fechamento always has a month to run', () => {
    expect(database.monthlyClosings).toEqual([])
    expect(database.memberStatements).toEqual([])
  })
})
