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
import { formatMonthName, getCurrentMonth } from '../../../shared/date'

/**
 * The demonstration data every fresh browser starts from.
 *
 * The narrative is fixed — three members, two of them with consumption
 * accumulating on a monthly tab; an active event with two visitor tabs, one
 * of them partially paid and one holding only a courtesy; a past event
 * already closed behind it — but the whole timeline is derived from `now`.
 *
 * Hardcoded September 2026 dates used to empty the demo the moment the month
 * turned ("Consumo do mês" R$ 0,00, `/fechamento` with nothing to close,
 * every member at R$ 0,00) and pinned the test suite to a literal month, so
 * five specs failed on 1 October without a line of code changing.
 */
export function createDemoDatabase(now: Date = new Date()): BarDatabase {
  const month = getCurrentMonth(now)
  const at = createSeedClock(now)

  const monthOpened = at(MONTH_START, 9)
  const stockEntry = at(MONTH_START, 10)
  const pastEventStart = at(14, 18)
  const pastEventEnd = at(13, 2)
  const anaConsumption = at(7, 20)
  const brunoConsumption = at(4, 20)
  const eventStart = at(1, 18)
  const rafaelTabOpened = at(1, 18, 10)
  const julianaTabOpened = at(1, 18, 20)
  const rafaelConsumption = at(1, 19)
  const julianaConsumption = at(1, 19, 10)
  const rafaelPayment = at(1, 21)

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
      { id: 'event-encontro', name: `Encontro de ${formatMonthName(month)}`, startsAt: eventStart, status: EVENT_STATUS.ACTIVE },
      { id: 'event-aniversario', name: 'Aniversário do motoclube', startsAt: pastEventStart, endsAt: pastEventEnd, status: EVENT_STATUS.CLOSED },
    ],
    tabs: [
      { id: 'tab-ana-mensal', kind: TAB_KIND.MONTHLY, status: TAB_STATUS.OPEN, memberId: 'member-ana', month, openedAt: monthOpened },
      { id: 'tab-bruno-mensal', kind: TAB_KIND.MONTHLY, status: TAB_STATUS.OPEN, memberId: 'member-bruno', month, openedAt: monthOpened },
      { id: 'tab-celia-mensal', kind: TAB_KIND.MONTHLY, status: TAB_STATUS.OPEN, memberId: 'member-celia', month, openedAt: monthOpened },
      { id: 'tab-rafael-evento', kind: TAB_KIND.EVENT, status: TAB_STATUS.OPEN, eventId: 'event-encontro', visitorId: 'visitor-rafael', openedAt: rafaelTabOpened },
      { id: 'tab-juliana-evento', kind: TAB_KIND.EVENT, status: TAB_STATUS.OPEN, eventId: 'event-encontro', visitorId: 'visitor-juliana', openedAt: julianaTabOpened },
    ],
    consumptions: [
      { id: 'cons-ana-cerveja', tabId: 'tab-ana-mensal', consumerId: 'member-ana', itemId: 'item-cerveja', status: CONSUMPTION_STATUS.ACTIVE, chargeKind: CHARGE_KIND.CHARGED, quantity: 3, unitPriceCents: 700, unitCostCents: 350, createdAt: anaConsumption, actorId: 'admin-demo' },
      { id: 'cons-bruno-espetinho', tabId: 'tab-bruno-mensal', consumerId: 'member-bruno', itemId: 'item-espetinho', status: CONSUMPTION_STATUS.ACTIVE, chargeKind: CHARGE_KIND.CHARGED, quantity: 2, unitPriceCents: 1200, unitCostCents: 500, createdAt: brunoConsumption, actorId: 'admin-demo' },
      { id: 'cons-rafael-refri', tabId: 'tab-rafael-evento', consumerId: 'visitor-rafael', itemId: 'item-refrigerante', status: CONSUMPTION_STATUS.ACTIVE, chargeKind: CHARGE_KIND.CHARGED, quantity: 2, unitPriceCents: 600, unitCostCents: 280, createdAt: rafaelConsumption, actorId: 'admin-demo' },
      { id: 'cons-juliana-agua', tabId: 'tab-juliana-evento', consumerId: 'visitor-juliana', itemId: 'item-agua', status: CONSUMPTION_STATUS.ACTIVE, chargeKind: CHARGE_KIND.COURTESY, quantity: 1, unitPriceCents: 400, unitCostCents: 150, createdAt: julianaConsumption, actorId: 'admin-demo' },
    ],
    payments: [
      { id: 'payment-rafael', target: PAYMENT_TARGET.TAB, targetId: 'tab-rafael-evento', amountCents: 700, paidAt: rafaelPayment, actorId: 'admin-demo' },
    ],
    stockMovements: [
      { id: 'movement-entry-cerveja', itemId: 'item-cerveja', kind: STOCK_MOVEMENT_KIND.ENTRY, quantityDelta: 45, occurredAt: stockEntry, actorId: 'admin-demo' },
      { id: 'movement-ana-cerveja', itemId: 'item-cerveja', kind: STOCK_MOVEMENT_KIND.CONSUMPTION, quantityDelta: -3, occurredAt: anaConsumption, actorId: 'admin-demo', consumptionId: 'cons-ana-cerveja' },
      { id: 'movement-bruno-espetinho', itemId: 'item-espetinho', kind: STOCK_MOVEMENT_KIND.CONSUMPTION, quantityDelta: -2, occurredAt: brunoConsumption, actorId: 'admin-demo', consumptionId: 'cons-bruno-espetinho' },
      { id: 'movement-rafael-refri', itemId: 'item-refrigerante', kind: STOCK_MOVEMENT_KIND.CONSUMPTION, quantityDelta: -2, occurredAt: rafaelConsumption, actorId: 'admin-demo', consumptionId: 'cons-rafael-refri' },
      { id: 'movement-juliana-agua', itemId: 'item-agua', kind: STOCK_MOVEMENT_KIND.CONSUMPTION, quantityDelta: -1, occurredAt: julianaConsumption, actorId: 'admin-demo', consumptionId: 'cons-juliana-agua' },
    ],
    monthlyClosings: [],
    memberStatements: [],
  }
}

/** More days than any month has, so this beat always lands on the 1st. */
const MONTH_START = 40

/**
 * Turns "so many days before today, at this hour" into an instant, under two
 * clamps that keep the demo coherent in any month, on any day of it:
 *
 * - the day never falls below the 1st, so every beat stays inside the month
 *   `/fechamento` and the dashboard scope to (a beat pushed into last month
 *   would drop straight back out of the demo);
 * - the instant never passes `now`, so the demo never shows a launch, a
 *   payment or an event dated in the future.
 *
 * Early in a month both clamps bite and the timeline compresses towards the
 * 1st, which is honest — the month has only just started. Local `Date`
 * constructors throughout, because `getMonthKey` attributes by local month.
 */
function createSeedClock(now: Date): (daysBeforeToday: number, hour: number, minute?: number) => string {
  const year = now.getFullYear()
  const monthIndex = now.getMonth()
  const today = now.getDate()

  return (daysBeforeToday, hour, minute = 0) => {
    const day = Math.max(1, today - daysBeforeToday)
    const moment = new Date(year, monthIndex, day, hour, minute, 0, 0)
    return (moment > now ? now : moment).toISOString()
  }
}
