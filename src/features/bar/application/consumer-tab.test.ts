import { describe, expect, it } from 'vitest'

/**
 * The demo seed derives its month from the clock, so the fixtures here do
 * too — `resolveConsumerTab` is asked about the seed's own month and about
 * one it has no tab in, whichever month the suite happens to run in.
 */
const SEED_MONTH = getCurrentMonth()
const OTHER_MONTH = getCurrentMonth(new Date(SEED_YEAR(), SEED_MONTH_INDEX() + 1, 1))

function SEED_YEAR(): number {
  return Number(SEED_MONTH.split('-')[0])
}

function SEED_MONTH_INDEX(): number {
  return Number(SEED_MONTH.split('-')[1]) - 1
}

function inSeedMonth(day: number, hour: number): string {
  return new Date(SEED_YEAR(), SEED_MONTH_INDEX(), day, hour, 0).toISOString()
}

import type { BarDatabase } from './bar-repository'
import {
  CONSUMER_KIND,
  EVENT_STATUS,
  TAB_KIND,
  TAB_STATUS,
} from '../domain/constants'
import type { Consumer, Tab } from '../domain/entities'
import { createDemoDatabase } from '../infrastructure/demo-seed'
import { getCurrentMonth } from '../../../shared/date'
import { hasViewableTab, listReassignTargets, resolveConsumerTab } from './consumer-tab'

const ANA: Consumer = {
  id: 'member-ana', name: 'Ana Paula', kind: CONSUMER_KIND.MEMBER, active: true,
}
const RAFAEL: Consumer = {
  id: 'visitor-rafael', name: 'Rafael Oliveira', kind: CONSUMER_KIND.VISITOR, active: true,
}

function withTabs(tabs: readonly Tab[]): BarDatabase {
  return { ...createDemoDatabase(), tabs: [...tabs], consumptions: [], payments: [] }
}

describe('resolveConsumerTab', () => {
  it('finds the open monthly tab of a member in the month', () => {
    const snapshot = createDemoDatabase()

    expect(resolveConsumerTab(snapshot, ANA, SEED_MONTH)).toEqual({
      kind: 'ready',
      tab: snapshot.tabs.find(({ id }) => id === 'tab-ana-mensal'),
    })
  })

  it('reports a member with no tab in the month as pending, not blocked', () => {
    expect(resolveConsumerTab(createDemoDatabase(), ANA, OTHER_MONTH)).toEqual({
      kind: 'pending',
    })
  })

  it('blocks a member whose monthly tab is already closed', () => {
    const snapshot = withTabs([{
      id: 'tab-ana-mensal', kind: TAB_KIND.MONTHLY, status: TAB_STATUS.CLOSED,
      memberId: 'member-ana', month: SEED_MONTH,
      openedAt: inSeedMonth(1, 12), closedAt: inSeedMonth(28, 23),
    }])

    // The tab comes back with the block: it still holds a real balance, and
    // the panel must be able to show it instead of claiming the tab is empty.
    expect(resolveConsumerTab(snapshot, ANA, SEED_MONTH)).toEqual({
      kind: 'blocked',
      reason: 'monthly-tab-closed',
      tab: snapshot.tabs.find(({ id }) => id === 'tab-ana-mensal'),
    })
  })

  it('finds the open event tab of a visitor in the active event', () => {
    const snapshot = createDemoDatabase()

    expect(resolveConsumerTab(snapshot, RAFAEL, SEED_MONTH)).toEqual({
      kind: 'ready',
      tab: snapshot.tabs.find(({ id }) => id === 'tab-rafael-evento'),
    })
  })

  it('blocks a visitor when no event is active', () => {
    const snapshot = createDemoDatabase()
    snapshot.events = snapshot.events.map((event) => ({
      ...event, status: EVENT_STATUS.CLOSED,
    }))

    expect(resolveConsumerTab(snapshot, RAFAEL, SEED_MONTH)).toEqual({
      kind: 'blocked', reason: 'no-active-event',
    })
  })

  it('reports a visitor with no tab in the active event as pending', () => {
    expect(resolveConsumerTab(withTabs([]), RAFAEL, SEED_MONTH)).toEqual({ kind: 'pending' })
  })

  it('blocks a visitor whose event tab was closed for payment', () => {
    const snapshot = withTabs([{
      id: 'tab-rafael-evento', kind: TAB_KIND.EVENT, status: TAB_STATUS.CLOSED,
      eventId: 'event-encontro', visitorId: 'visitor-rafael',
      openedAt: inSeedMonth(19, 18), closedAt: inSeedMonth(19, 22),
    }])

    expect(resolveConsumerTab(snapshot, RAFAEL, SEED_MONTH)).toEqual({
      kind: 'blocked',
      reason: 'event-tab-closed',
      tab: snapshot.tabs.find(({ id }) => id === 'tab-rafael-evento'),
    })
  })
})

describe('listReassignTargets', () => {
  it('offers the other open monthly tabs of the same month', () => {
    const snapshot = createDemoDatabase()
    const consumption = snapshot.consumptions.find(({ id }) => id === 'cons-ana-cerveja')!

    expect(listReassignTargets(snapshot, consumption)).toEqual([
      { tabId: 'tab-bruno-mensal', consumerName: 'Bruno Santos' },
      { tabId: 'tab-celia-mensal', consumerName: 'Célia Martins' },
    ])
  })

  it('offers the other open event tabs for a visitor consumption', () => {
    const snapshot = createDemoDatabase()
    const consumption = snapshot.consumptions.find(({ id }) => id === 'cons-rafael-refri')!

    expect(listReassignTargets(snapshot, consumption)).toEqual([
      { tabId: 'tab-juliana-evento', consumerName: 'Juliana Costa' },
    ])
  })

  it('never offers a closed tab, the source tab or a tab of the other kind', () => {
    const snapshot = createDemoDatabase()
    snapshot.tabs = snapshot.tabs.map((tab) =>
      tab.id === 'tab-bruno-mensal'
        ? { ...tab, status: TAB_STATUS.CLOSED, closedAt: inSeedMonth(28, 23) }
        : tab,
    )
    const consumption = snapshot.consumptions.find(({ id }) => id === 'cons-ana-cerveja')!

    expect(listReassignTargets(snapshot, consumption)).toEqual([
      { tabId: 'tab-celia-mensal', consumerName: 'Célia Martins' },
    ])
  })

  it('offers nothing when the source tab is gone from the snapshot', () => {
    const snapshot = createDemoDatabase()
    const consumption = snapshot.consumptions.find(({ id }) => id === 'cons-ana-cerveja')!
    snapshot.tabs = snapshot.tabs.filter(({ id }) => id !== consumption.tabId)

    expect(listReassignTargets(snapshot, consumption)).toEqual([])
  })

  it('keeps monthly tabs of another month out of the offer', () => {
    const snapshot = createDemoDatabase()
    snapshot.tabs = snapshot.tabs.map((tab) =>
      tab.id === 'tab-celia-mensal' && tab.kind === TAB_KIND.MONTHLY
        ? { ...tab, month: '2026-08' }
        : tab,
    )
    const consumption = snapshot.consumptions.find(({ id }) => id === 'cons-ana-cerveja')!

    expect(listReassignTargets(snapshot, consumption)).toEqual([
      { tabId: 'tab-bruno-mensal', consumerName: 'Bruno Santos' },
    ])
  })
})

describe('hasViewableTab', () => {
  it('offers the panel for an open tab and for a member with none yet', () => {
    const snapshot = createDemoDatabase()

    expect(hasViewableTab(resolveConsumerTab(snapshot, ANA, SEED_MONTH))).toBe(true)
    expect(hasViewableTab(resolveConsumerTab(snapshot, ANA, OTHER_MONTH))).toBe(true)
  })

  it('still offers the panel for a closed tab, which holds a balance', () => {
    const closedMonthly = withTabs([{
      id: 'tab-ana-mensal', kind: TAB_KIND.MONTHLY, status: TAB_STATUS.CLOSED,
      memberId: 'member-ana', month: SEED_MONTH,
      openedAt: inSeedMonth(1, 12), closedAt: inSeedMonth(28, 23),
    }])
    const closedEvent = withTabs([{
      id: 'tab-rafael-evento', kind: TAB_KIND.EVENT, status: TAB_STATUS.CLOSED,
      eventId: 'event-encontro', visitorId: 'visitor-rafael',
      openedAt: inSeedMonth(19, 18), closedAt: inSeedMonth(19, 22),
    }])

    expect(hasViewableTab(resolveConsumerTab(closedMonthly, ANA, SEED_MONTH))).toBe(true)
    expect(hasViewableTab(resolveConsumerTab(closedEvent, RAFAEL, SEED_MONTH))).toBe(true)
  })

  it('withholds the panel when no event is active, since there is no tab', () => {
    const snapshot = createDemoDatabase()
    snapshot.events = snapshot.events.map((event) => ({
      ...event, status: EVENT_STATUS.CLOSED,
    }))

    expect(hasViewableTab(resolveConsumerTab(snapshot, RAFAEL, SEED_MONTH))).toBe(false)
  })
})
