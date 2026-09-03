import { describe, expect, it } from 'vitest'

import type { BarDatabase } from './bar-repository'
import {
  CHARGE_KIND,
  CONSUMPTION_STATUS,
  TAB_KIND,
  TAB_STATUS,
} from '../domain/constants'
import type { Consumption } from '../domain/entities'
import { createDemoDatabase } from '../infrastructure/demo-seed'
import { CANCELLATION_BLOCK } from '../domain/cancellation'
import { RECENT_LAUNCH_LIMIT } from './constants'
import { listRecentLaunches } from './recent-launches'

const TODAY = new Date(2026, 8, 19, 21, 0)

function launch(id: string, createdAt: Date, overrides: Partial<Consumption> = {}): Consumption {
  return {
    id,
    tabId: 'tab-ana-mensal',
    consumerId: 'member-ana',
    itemId: 'item-cerveja',
    status: CONSUMPTION_STATUS.ACTIVE,
    chargeKind: CHARGE_KIND.CHARGED,
    quantity: 1,
    unitPriceCents: 700,
    unitCostCents: 350,
    createdAt: createdAt.toISOString(),
    actorId: 'admin-demo',
    ...overrides,
  } as Consumption
}

function withConsumptions(consumptions: readonly Consumption[]): BarDatabase {
  return { ...createDemoDatabase(), consumptions: [...consumptions], payments: [] }
}

describe('listRecentLaunches', () => {
  it('keeps only the launches of the reference day, newest first', () => {
    const snapshot = withConsumptions([
      launch('yesterday', new Date(2026, 8, 18, 23, 30)),
      launch('early', new Date(2026, 8, 19, 8, 0)),
      launch('late', new Date(2026, 8, 19, 20, 45)),
      launch('tomorrow', new Date(2026, 8, 20, 0, 30)),
    ])

    expect(listRecentLaunches(snapshot, TODAY).map(({ consumption }) => consumption.id))
      .toEqual(['late', 'early'])
  })

  it(`shows at most the ${RECENT_LAUNCH_LIMIT} newest launches of the day`, () => {
    const snapshot = withConsumptions(
      Array.from({ length: RECENT_LAUNCH_LIMIT + 4 }, (_value, index) =>
        launch(`c${index}`, new Date(2026, 8, 19, 10, index)),
      ),
    )

    const recent = listRecentLaunches(snapshot, TODAY)

    expect(recent).toHaveLength(RECENT_LAUNCH_LIMIT)
    expect(recent[0].consumption.id).toBe(`c${RECENT_LAUNCH_LIMIT + 3}`)
  })

  it('leaves cancelled launches out, since none of the row actions apply to them', () => {
    const snapshot = withConsumptions([
      launch('active', new Date(2026, 8, 19, 10, 0)),
      launch('cancelled', new Date(2026, 8, 19, 11, 0), {
        status: CONSUMPTION_STATUS.CANCELLED,
        cancelledAt: new Date(2026, 8, 19, 11, 5).toISOString(),
        cancelledByActorId: 'admin-demo',
      }),
    ])

    expect(listRecentLaunches(snapshot, TODAY).map(({ consumption }) => consumption.id))
      .toEqual(['active'])
  })

  it('describes each launch with its item, consumer and line total from the domain', () => {
    const snapshot = withConsumptions([launch('c1', new Date(2026, 8, 19, 10, 0), {
      quantity: 3,
    })])

    expect(listRecentLaunches(snapshot, TODAY)[0]).toMatchObject({
      itemName: 'Cerveja lata',
      consumerName: 'Ana Paula',
      lineTotalCents: 2100,
      isCourtesy: false,
    })
  })

  it('flags a courtesy launch so the row can say it is not charged', () => {
    const snapshot = withConsumptions([launch('c1', new Date(2026, 8, 19, 10, 0), {
      chargeKind: CHARGE_KIND.COURTESY,
    })])

    expect(listRecentLaunches(snapshot, TODAY)[0].isCourtesy).toBe(true)
  })

  it('reports the tab a launch sits on so it can be moved elsewhere', () => {
    const snapshot = withConsumptions([launch('c1', new Date(2026, 8, 19, 10, 0))])

    expect(listRecentLaunches(snapshot, TODAY)[0].tab).toMatchObject({
      id: 'tab-ana-mensal', kind: TAB_KIND.MONTHLY, status: TAB_STATUS.OPEN,
    })
  })

  it('has nothing to show on a day without launches', () => {
    const snapshot = withConsumptions([launch('c1', new Date(2026, 8, 18, 10, 0))])

    expect(listRecentLaunches(snapshot, TODAY)).toEqual([])
  })
})

describe('listRecentLaunches cancellation blocks', () => {
  it('leaves a launch on a live, unsettled tab freely correctable', () => {
    const snapshot = withConsumptions([launch('cons-live', new Date(2026, 8, 19, 20, 0))])

    expect(listRecentLaunches(snapshot, TODAY)[0].cancellationBlock).toBeUndefined()
  })

  it('marks a launch a monthly closing already froze', () => {
    const frozen = launch('cons-frozen', new Date(2026, 8, 19, 20, 0))
    const snapshot = withConsumptions([frozen])
    snapshot.memberStatements = [{
      id: 'statement-ana', memberId: 'member-ana', month: '2026-09',
      consumptions: [frozen], createdAt: '2026-09-30T23:00:00.000Z',
    }]

    expect(listRecentLaunches(snapshot, TODAY)[0].cancellationBlock).toBe(
      CANCELLATION_BLOCK.CONSOLIDATED,
    )
  })

  it('marks a launch whose tab is already closed', () => {
    const snapshot = withConsumptions([launch('cons-closed', new Date(2026, 8, 19, 20, 0))])
    snapshot.tabs = snapshot.tabs.map((tab) =>
      tab.id === 'tab-ana-mensal'
        ? { ...tab, status: TAB_STATUS.CLOSED, closedAt: '2026-09-30T23:00:00.000Z' }
        : tab,
    )

    expect(listRecentLaunches(snapshot, TODAY)[0].cancellationBlock).toBe(
      CANCELLATION_BLOCK.CLOSED_TAB,
    )
  })
})
