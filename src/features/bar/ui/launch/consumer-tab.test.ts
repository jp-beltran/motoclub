import { describe, expect, it } from 'vitest'

import type { BarDatabase } from '../../application/bar-repository'
import {
  CONSUMER_KIND,
  EVENT_STATUS,
  TAB_KIND,
  TAB_STATUS,
} from '../../domain/constants'
import type { Consumer, Tab } from '../../domain/entities'
import { createDemoDatabase } from '../../infrastructure/demo-seed'
import { listReassignTargets, resolveConsumerTab } from './consumer-tab'

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

    expect(resolveConsumerTab(snapshot, ANA, '2026-09')).toEqual({
      kind: 'ready',
      tab: snapshot.tabs.find(({ id }) => id === 'tab-ana-2026-09'),
    })
  })

  it('reports a member with no tab in the month as pending, not blocked', () => {
    expect(resolveConsumerTab(createDemoDatabase(), ANA, '2026-10')).toEqual({
      kind: 'pending',
    })
  })

  it('blocks a member whose monthly tab is already closed', () => {
    const snapshot = withTabs([{
      id: 'tab-ana-2026-09', kind: TAB_KIND.MONTHLY, status: TAB_STATUS.CLOSED,
      memberId: 'member-ana', month: '2026-09',
      openedAt: '2026-09-01T12:00:00.000Z', closedAt: '2026-09-30T23:00:00.000Z',
    }])

    expect(resolveConsumerTab(snapshot, ANA, '2026-09')).toEqual({
      kind: 'blocked', reason: 'monthly-tab-closed',
    })
  })

  it('finds the open event tab of a visitor in the active event', () => {
    const snapshot = createDemoDatabase()

    expect(resolveConsumerTab(snapshot, RAFAEL, '2026-09')).toEqual({
      kind: 'ready',
      tab: snapshot.tabs.find(({ id }) => id === 'tab-rafael-evento'),
    })
  })

  it('blocks a visitor when no event is active', () => {
    const snapshot = createDemoDatabase()
    snapshot.events = snapshot.events.map((event) => ({
      ...event, status: EVENT_STATUS.CLOSED,
    }))

    expect(resolveConsumerTab(snapshot, RAFAEL, '2026-09')).toEqual({
      kind: 'blocked', reason: 'no-active-event',
    })
  })

  it('reports a visitor with no tab in the active event as pending', () => {
    expect(resolveConsumerTab(withTabs([]), RAFAEL, '2026-09')).toEqual({ kind: 'pending' })
  })

  it('blocks a visitor whose event tab was closed for payment', () => {
    const snapshot = withTabs([{
      id: 'tab-rafael-evento', kind: TAB_KIND.EVENT, status: TAB_STATUS.CLOSED,
      eventId: 'event-setembro', visitorId: 'visitor-rafael',
      openedAt: '2026-09-19T18:10:00.000Z', closedAt: '2026-09-19T22:00:00.000Z',
    }])

    expect(resolveConsumerTab(snapshot, RAFAEL, '2026-09')).toEqual({
      kind: 'blocked', reason: 'event-tab-closed',
    })
  })
})

describe('listReassignTargets', () => {
  it('offers the other open monthly tabs of the same month', () => {
    const snapshot = createDemoDatabase()
    const consumption = snapshot.consumptions.find(({ id }) => id === 'cons-ana-cerveja')!

    expect(listReassignTargets(snapshot, consumption)).toEqual([
      { tabId: 'tab-bruno-2026-09', consumerName: 'Bruno Santos' },
      { tabId: 'tab-celia-2026-09', consumerName: 'Célia Martins' },
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
      tab.id === 'tab-bruno-2026-09'
        ? { ...tab, status: TAB_STATUS.CLOSED, closedAt: '2026-09-30T23:00:00.000Z' }
        : tab,
    )
    const consumption = snapshot.consumptions.find(({ id }) => id === 'cons-ana-cerveja')!

    expect(listReassignTargets(snapshot, consumption)).toEqual([
      { tabId: 'tab-celia-2026-09', consumerName: 'Célia Martins' },
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
      tab.id === 'tab-celia-2026-09' && tab.kind === TAB_KIND.MONTHLY
        ? { ...tab, month: '2026-08' }
        : tab,
    )
    const consumption = snapshot.consumptions.find(({ id }) => id === 'cons-ana-cerveja')!

    expect(listReassignTargets(snapshot, consumption)).toEqual([
      { tabId: 'tab-bruno-2026-09', consumerName: 'Bruno Santos' },
    ])
  })
})
