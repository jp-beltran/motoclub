import {
  CHARGE_KIND,
  CONSUMER_KIND,
  CONSUMPTION_STATUS,
  EVENT_STATUS,
  PAYMENT_TARGET,
  STOCK_MOVEMENT_KIND,
  TAB_KIND,
  TAB_STATUS,
} from '../domain/constants'
import type { BarDatabase } from '../application/bar-repository'

export function createDemoDatabase(): BarDatabase {
  return {
    consumers: [
      { id: 'member-ana', name: 'Ana Paula', kind: CONSUMER_KIND.MEMBER, phone: '(11) 98888-1001', active: true },
      { id: 'member-bruno', name: 'Bruno Santos', kind: CONSUMER_KIND.MEMBER, phone: '(11) 97777-2002', active: true },
      { id: 'member-celia', name: 'Célia Martins', kind: CONSUMER_KIND.MEMBER, active: true },
      { id: 'visitor-rafael', name: 'Rafael Oliveira', kind: CONSUMER_KIND.VISITOR, phone: '(11) 96666-3003', active: true },
      { id: 'visitor-juliana', name: 'Juliana Costa', kind: CONSUMER_KIND.VISITOR, active: true },
    ],
    items: [
      { id: 'item-cerveja', code: 'BEV-001', name: 'Cerveja lata', category: 'Bebidas', unit: 'lata', description: 'Cerveja pilsen 350 ml', active: true, favorite: true, unitCostCents: 350, unitPriceCents: 700, stockQuantity: 42 },
      { id: 'item-agua', code: 'BEV-002', name: 'Água mineral', category: 'Bebidas', unit: 'garrafa', description: 'Sem gás 500 ml', active: true, favorite: true, unitCostCents: 150, unitPriceCents: 400, stockQuantity: 28 },
      { id: 'item-refrigerante', code: 'BEV-003', name: 'Refrigerante', category: 'Bebidas', unit: 'lata', active: true, favorite: true, unitCostCents: 280, unitPriceCents: 600, stockQuantity: 24 },
      { id: 'item-espetinho', code: 'FOO-001', name: 'Espetinho', category: 'Comidas', unit: 'unidade', active: true, favorite: true, unitCostCents: 500, unitPriceCents: 1200, stockQuantity: 15 },
      { id: 'item-porcao', code: 'FOO-002', name: 'Porção de fritas', category: 'Comidas', unit: 'porção', active: true, favorite: false, unitCostCents: 900, unitPriceCents: 2200 },
      { id: 'item-camiseta', code: 'CLB-001', name: 'Camiseta do motoclube', category: 'Clube', unit: 'unidade', active: true, favorite: false, unitCostCents: 3000, unitPriceCents: 5000, stockQuantity: 8 },
    ],
    events: [
      { id: 'event-setembro', name: 'Encontro de setembro', startsAt: '2026-09-19T18:00:00.000Z', status: EVENT_STATUS.ACTIVE },
      { id: 'event-aniversario', name: 'Aniversário do motoclube', startsAt: '2026-09-05T18:00:00.000Z', endsAt: '2026-09-06T02:00:00.000Z', status: EVENT_STATUS.CLOSED },
    ],
    tabs: [
      { id: 'tab-ana-2026-09', kind: TAB_KIND.MONTHLY, status: TAB_STATUS.OPEN, memberId: 'member-ana', month: '2026-09', openedAt: '2026-09-01T12:00:00.000Z' },
      { id: 'tab-bruno-2026-09', kind: TAB_KIND.MONTHLY, status: TAB_STATUS.OPEN, memberId: 'member-bruno', month: '2026-09', openedAt: '2026-09-01T12:00:00.000Z' },
      { id: 'tab-celia-2026-09', kind: TAB_KIND.MONTHLY, status: TAB_STATUS.OPEN, memberId: 'member-celia', month: '2026-09', openedAt: '2026-09-01T12:00:00.000Z' },
      { id: 'tab-rafael-evento', kind: TAB_KIND.EVENT, status: TAB_STATUS.OPEN, eventId: 'event-setembro', visitorId: 'visitor-rafael', openedAt: '2026-09-19T18:10:00.000Z' },
      { id: 'tab-juliana-evento', kind: TAB_KIND.EVENT, status: TAB_STATUS.OPEN, eventId: 'event-setembro', visitorId: 'visitor-juliana', openedAt: '2026-09-19T18:20:00.000Z' },
    ],
    consumptions: [
      { id: 'cons-ana-cerveja', tabId: 'tab-ana-2026-09', consumerId: 'member-ana', itemId: 'item-cerveja', status: CONSUMPTION_STATUS.ACTIVE, chargeKind: CHARGE_KIND.CHARGED, quantity: 3, unitPriceCents: 700, unitCostCents: 350, createdAt: '2026-09-12T20:00:00.000Z', actorId: 'admin-demo' },
      { id: 'cons-bruno-espetinho', tabId: 'tab-bruno-2026-09', consumerId: 'member-bruno', itemId: 'item-espetinho', status: CONSUMPTION_STATUS.ACTIVE, chargeKind: CHARGE_KIND.CHARGED, quantity: 2, unitPriceCents: 1200, unitCostCents: 500, createdAt: '2026-09-15T20:00:00.000Z', actorId: 'admin-demo' },
      { id: 'cons-rafael-refri', tabId: 'tab-rafael-evento', consumerId: 'visitor-rafael', itemId: 'item-refrigerante', status: CONSUMPTION_STATUS.ACTIVE, chargeKind: CHARGE_KIND.CHARGED, quantity: 2, unitPriceCents: 600, unitCostCents: 280, createdAt: '2026-09-19T19:00:00.000Z', actorId: 'admin-demo' },
      { id: 'cons-juliana-agua', tabId: 'tab-juliana-evento', consumerId: 'visitor-juliana', itemId: 'item-agua', status: CONSUMPTION_STATUS.ACTIVE, chargeKind: CHARGE_KIND.COURTESY, quantity: 1, unitPriceCents: 400, unitCostCents: 150, createdAt: '2026-09-19T19:10:00.000Z', actorId: 'admin-demo' },
    ],
    payments: [
      { id: 'payment-rafael', target: PAYMENT_TARGET.TAB, targetId: 'tab-rafael-evento', amountCents: 700, paidAt: '2026-09-19T21:00:00.000Z', actorId: 'admin-demo' },
    ],
    stockMovements: [
      { id: 'movement-entry-cerveja', itemId: 'item-cerveja', kind: STOCK_MOVEMENT_KIND.ENTRY, quantityDelta: 45, occurredAt: '2026-09-01T10:00:00.000Z', actorId: 'admin-demo' },
      { id: 'movement-ana-cerveja', itemId: 'item-cerveja', kind: STOCK_MOVEMENT_KIND.CONSUMPTION, quantityDelta: -3, occurredAt: '2026-09-12T20:00:00.000Z', actorId: 'admin-demo', consumptionId: 'cons-ana-cerveja' },
      { id: 'movement-bruno-espetinho', itemId: 'item-espetinho', kind: STOCK_MOVEMENT_KIND.CONSUMPTION, quantityDelta: -2, occurredAt: '2026-09-15T20:00:00.000Z', actorId: 'admin-demo', consumptionId: 'cons-bruno-espetinho' },
      { id: 'movement-rafael-refri', itemId: 'item-refrigerante', kind: STOCK_MOVEMENT_KIND.CONSUMPTION, quantityDelta: -2, occurredAt: '2026-09-19T19:00:00.000Z', actorId: 'admin-demo', consumptionId: 'cons-rafael-refri' },
      { id: 'movement-juliana-agua', itemId: 'item-agua', kind: STOCK_MOVEMENT_KIND.CONSUMPTION, quantityDelta: -1, occurredAt: '2026-09-19T19:10:00.000Z', actorId: 'admin-demo', consumptionId: 'cons-juliana-agua' },
    ],
    monthlyClosings: [],
    memberStatements: [],
  }
}
