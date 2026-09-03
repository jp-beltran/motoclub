import { describe, expect, it } from 'vitest'

import {
  CANCELLATION_BLOCK,
  CANCELLATION_BLOCK_REASONS,
  findCancellationBlock,
  type CancellationContext,
} from './cancellation'
import {
  CHARGE_KIND,
  CONSUMPTION_STATUS,
  PAYMENT_TARGET,
  TAB_KIND,
  TAB_STATUS,
} from './constants'
import type { Consumption, MemberStatement, Payment, Tab } from './entities'

const OPEN_EVENT_TAB: Tab = {
  id: 'tab-rafael',
  kind: TAB_KIND.EVENT,
  status: TAB_STATUS.OPEN,
  eventId: 'event-1',
  visitorId: 'visitor-rafael',
  openedAt: '2026-09-19T18:00:00.000Z',
}

const OPEN_MONTHLY_TAB: Tab = {
  id: 'tab-ana',
  kind: TAB_KIND.MONTHLY,
  status: TAB_STATUS.OPEN,
  memberId: 'member-ana',
  month: '2026-09',
  openedAt: '2026-09-01T12:00:00.000Z',
}

function consumption(overrides: Partial<Consumption> = {}): Consumption {
  return {
    id: 'cons-1',
    tabId: OPEN_EVENT_TAB.id,
    consumerId: 'visitor-rafael',
    itemId: 'item-cerveja',
    status: CONSUMPTION_STATUS.ACTIVE,
    chargeKind: CHARGE_KIND.CHARGED,
    quantity: 1,
    unitPriceCents: 700,
    unitCostCents: 350,
    createdAt: '2026-09-19T19:00:00.000Z',
    actorId: 'admin-demo',
    ...overrides,
  } as Consumption
}

function payment(amountCents: number, targetId = OPEN_EVENT_TAB.id): Payment {
  return {
    id: `payment-${amountCents}`,
    target: PAYMENT_TARGET.TAB,
    targetId,
    amountCents,
    paidAt: '2026-09-19T21:00:00.000Z',
    actorId: 'admin-demo',
  }
}

function statementWith(consumptions: readonly Consumption[]): MemberStatement {
  return {
    id: 'statement-ana-2026-09',
    memberId: 'member-ana',
    month: '2026-09',
    consumptions,
    createdAt: '2026-09-30T23:00:00.000Z',
  }
}

function context(overrides: Partial<CancellationContext> = {}): CancellationContext {
  return {
    tabs: [OPEN_EVENT_TAB],
    consumptions: [consumption()],
    payments: [],
    memberStatements: [],
    ...overrides,
  }
}

describe('findCancellationBlock', () => {
  it('allows cancelling an untouched consumption on an open, unpaid tab', () => {
    expect(findCancellationBlock(context(), 'cons-1')).toBeUndefined()
  })

  it('refuses a consumption frozen into a member statement', () => {
    const frozen = consumption({ id: 'cons-ana', tabId: OPEN_MONTHLY_TAB.id, consumerId: 'member-ana' })

    const block = findCancellationBlock(
      context({
        tabs: [OPEN_MONTHLY_TAB],
        consumptions: [frozen],
        memberStatements: [statementWith([frozen])],
      }),
      'cons-ana',
    )

    expect(block).toBe(CANCELLATION_BLOCK.CONSOLIDATED)
  })

  it('refuses a consumption on a closed tab', () => {
    const closedTab: Tab = {
      ...OPEN_EVENT_TAB,
      status: TAB_STATUS.CLOSED,
      closedAt: '2026-09-19T22:00:00.000Z',
    }

    expect(findCancellationBlock(context({ tabs: [closedTab] }), 'cons-1')).toBe(
      CANCELLATION_BLOCK.CLOSED_TAB,
    )
  })

  it('refuses a cancellation that would leave the tab paid beyond what it owes', () => {
    // R$ 7,00 due, R$ 7,00 settled: cancelling it leaves R$ 0,00 due against
    // R$ 7,00 of the club's money, which summarizePayments saturates away.
    const block = findCancellationBlock(context({ payments: [payment(700)] }), 'cons-1')

    expect(block).toBe(CANCELLATION_BLOCK.SETTLED_PAYMENT)
  })

  it('allows a cancellation a partial payment still leaves money owed after', () => {
    // R$ 19,00 due across two lines, R$ 7,00 settled. Cancelling the R$ 7,00
    // line leaves R$ 12,00 due — still above what was paid, so no money is
    // stranded and the correction is legitimate.
    const other = consumption({ id: 'cons-2', itemId: 'item-espetinho', unitPriceCents: 1200 })

    expect(
      findCancellationBlock(
        context({ consumptions: [consumption(), other], payments: [payment(700)] }),
        'cons-1',
      ),
    ).toBeUndefined()
  })

  it('ignores courtesy lines, which never carry money, when weighing payments', () => {
    const courtesy = consumption({ id: 'cons-courtesy', chargeKind: CHARGE_KIND.COURTESY })

    expect(
      findCancellationBlock(
        context({ consumptions: [consumption(), courtesy], payments: [payment(700)] }),
        'cons-courtesy',
      ),
    ).toBeUndefined()
  })

  it('leaves an already cancelled consumption to its own refusal', () => {
    const cancelled = consumption({
      status: CONSUMPTION_STATUS.CANCELLED,
      cancelledAt: '2026-09-19T20:00:00.000Z',
      cancelledByActorId: 'admin-demo',
    })

    expect(
      findCancellationBlock(
        context({ consumptions: [cancelled], memberStatements: [statementWith([cancelled])] }),
        'cons-1',
      ),
    ).toBeUndefined()
  })

  it('has an English reason for every block, for the repository to raise', () => {
    Object.values(CANCELLATION_BLOCK).forEach((block) => {
      expect(CANCELLATION_BLOCK_REASONS[block]).toMatch(/\S/)
    })
    expect(new Set(Object.values(CANCELLATION_BLOCK_REASONS)).size).toBe(
      Object.values(CANCELLATION_BLOCK).length,
    )
  })
})
