import { describe, expect, it } from 'vitest'

import { buildChargeMessage } from './charge-message'
import { CHARGE_KIND, CONSUMPTION_STATUS } from './constants'
import type { Consumption } from './entities'
import { getConsumptionLineTotalCents, summarizeTabConsumptions } from './financials'

const BASE_CONSUMPTION = {
  tabId: 'tab-ana-2026-09',
  consumerId: 'member-ana',
  status: CONSUMPTION_STATUS.ACTIVE,
  createdAt: '2026-09-12T20:00:00.000Z',
  actorId: 'admin-demo',
} as const

describe('buildChargeMessage', () => {
  it('lists a single item with quantity, subtotal and the total', () => {
    const message = buildChargeMessage({
      consumerName: 'Ana Paula',
      month: '2026-09',
      lines: [{ itemName: 'Cerveja lata', quantity: 3, subtotalCents: 2100 }],
      totalCents: 2100,
      paidCents: 0,
      remainingCents: 2100,
    })

    expect(message).toContain('Ana Paula')
    expect(message).toContain('setembro de 2026')
    expect(message).toContain('3× Cerveja lata — R$ 21,00')
    expect(message).toContain('Total: R$ 21,00')
    expect(message).not.toContain('Pago:')
  })

  it('lists one line per item, in the order given', () => {
    const message = buildChargeMessage({
      consumerName: 'Bruno Santos',
      month: '2026-09',
      lines: [
        { itemName: 'Espetinho', quantity: 2, subtotalCents: 2400 },
        { itemName: 'Água mineral', quantity: 1, subtotalCents: 400 },
      ],
      totalCents: 2800,
      paidCents: 0,
      remainingCents: 2800,
    })

    const espetinhoIndex = message.indexOf('2× Espetinho — R$ 24,00')
    const aguaIndex = message.indexOf('1× Água mineral — R$ 4,00')
    expect(espetinhoIndex).toBeGreaterThan(-1)
    expect(aguaIndex).toBeGreaterThan(espetinhoIndex)
    expect(message).toContain('Total: R$ 28,00')
  })

  it('keeps a courtesy consumption out of both the lines and the total', () => {
    const charged: Consumption = {
      ...BASE_CONSUMPTION,
      id: 'cons-ana-cerveja',
      itemId: 'item-cerveja',
      chargeKind: CHARGE_KIND.CHARGED,
      quantity: 3,
      unitPriceCents: 700,
      unitCostCents: 350,
    }
    const courtesy: Consumption = {
      ...BASE_CONSUMPTION,
      id: 'cons-ana-agua',
      itemId: 'item-agua',
      chargeKind: CHARGE_KIND.COURTESY,
      quantity: 1,
      unitPriceCents: 400,
      unitCostCents: 150,
    }
    const { totalCents } = summarizeTabConsumptions([charged, courtesy])

    const message = buildChargeMessage({
      consumerName: 'Ana Paula',
      month: '2026-09',
      lines: [
        {
          itemName: 'Cerveja lata',
          quantity: 3,
          subtotalCents: getConsumptionLineTotalCents(charged),
        },
      ],
      totalCents,
      paidCents: 0,
      remainingCents: totalCents,
    })

    expect(message).not.toContain('Água mineral')
    expect(message).toContain('Total: R$ 21,00')
  })

  it('states the amount already paid and what remains for a partial payment', () => {
    const message = buildChargeMessage({
      consumerName: 'Ana Paula',
      month: '2026-09',
      lines: [{ itemName: 'Cerveja lata', quantity: 3, subtotalCents: 2100 }],
      totalCents: 2100,
      paidCents: 1000,
      remainingCents: 1100,
    })

    expect(message).toContain('Total: R$ 21,00')
    expect(message).toContain('Pago: R$ 10,00')
    expect(message).toContain('Restante: R$ 11,00')
  })
})
