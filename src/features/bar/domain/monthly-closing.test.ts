import { describe, expect, it } from 'vitest'

import { CHARGE_KIND, CONSUMPTION_STATUS } from './constants'
import type { Consumption } from './entities'
import { consolidateMonth } from './monthly-closing'

const consumption = (
  id: string,
  consumerId: string,
  createdAt: string,
  unitPriceCents = 600,
): Consumption => ({
  id,
  tabId: `tab-${consumerId}`,
  consumerId,
  itemId: 'item-1',
  status: CONSUMPTION_STATUS.ACTIVE,
  chargeKind: CHARGE_KIND.CHARGED,
  quantity: 2,
  unitPriceCents,
  unitCostCents: 300,
  createdAt,
  actorId: 'actor-1',
})

describe('monthly consolidation', () => {
  it('groups only member consumptions from YYYY-MM and preserves IDs and price snapshots', () => {
    const september = consumption(
      'consumption-1',
      'member-1',
      new Date(2026, 8, 30, 23, 59).toISOString(),
    )
    const result = consolidateMonth(
      {
        month: '2026-09',
        memberIds: ['member-1'],
        consumptions: [
          september,
          consumption(
            'visitor-consumption',
            'visitor-1',
            new Date(2026, 8, 2, 12, 0).toISOString(),
          ),
          consumption(
            'october-consumption',
            'member-1',
            new Date(2026, 9, 1, 0, 0).toISOString(),
          ),
        ],
        actorId: 'actor-2',
      },
      {
        nextId: (() => {
          const ids = ['statement-1', 'closing-1']
          return () => ids.shift() ?? 'unexpected-id'
        })(),
        now: () => '2026-10-01T12:00:00.000Z',
      },
    )

    ;(september as { unitPriceCents: number }).unitPriceCents = 999

    expect(result.statements).toEqual([
      {
        id: 'statement-1',
        memberId: 'member-1',
        month: '2026-09',
        consumptions: [{ ...september, unitPriceCents: 600 }],
        createdAt: '2026-10-01T12:00:00.000Z',
      },
    ])
    expect(result.closing).toEqual({
      id: 'closing-1',
      month: '2026-09',
      statementIds: ['statement-1'],
      closedAt: '2026-10-01T12:00:00.000Z',
      actorId: 'actor-2',
    })
  })

  it('assigns consumptions by their local month, not their UTC month', () => {
    const lastLocalMinuteOfSeptember = new Date(2026, 8, 30, 23, 59)
    const firstLocalMinuteOfOctober = new Date(2026, 9, 1, 0, 0)
    const firstLocalMinuteOfSeptember = new Date(2026, 8, 1, 0, 0)
    const lastLocalMinuteOfAugust = new Date(2026, 7, 31, 23, 59)

    const result = consolidateMonth(
      {
        month: '2026-09',
        memberIds: ['member-1'],
        consumptions: [
          consumption('opening', 'member-1', firstLocalMinuteOfSeptember.toISOString()),
          consumption('closing', 'member-1', lastLocalMinuteOfSeptember.toISOString()),
          consumption('october', 'member-1', firstLocalMinuteOfOctober.toISOString()),
          consumption('august', 'member-1', lastLocalMinuteOfAugust.toISOString()),
        ],
        actorId: 'actor-2',
      },
      {
        nextId: (() => {
          const ids = ['statement-1', 'closing-1']
          return () => ids.shift() ?? 'unexpected-id'
        })(),
        now: () => '2026-10-01T12:00:00.000Z',
      },
    )

    expect(result.statements[0].consumptions.map(({ id }) => id)).toEqual([
      'opening',
      'closing',
    ])
  })

  it('rejects a month outside YYYY-MM format', () => {
    expect(() =>
      consolidateMonth(
        {
          month: '09/2026',
          memberIds: ['member-1'],
          consumptions: [],
          actorId: 'actor-1',
        },
        {
          nextId: () => 'closing-1',
          now: () => '2026-10-01T12:00:00.000Z',
        },
      ),
    ).toThrow('Month must use YYYY-MM format')
  })
})
