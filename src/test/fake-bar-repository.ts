import { vi } from 'vitest'

import type { BarDatabase, BarRepository } from '../features/bar/application/bar-repository'
import { createDemoDatabase } from '../features/bar/infrastructure/demo-seed'

function notImplemented(method: string): never {
  throw new Error(`FakeBarRepository.${method} is not implemented`)
}

/**
 * In-memory BarRepository test double. Read/reset methods are functional;
 * write methods outside Task 1's scope reject with a clear "not implemented"
 * error so a misused stub fails loudly instead of silently.
 */
export function createFakeBarRepository(
  overrides: Partial<BarRepository> = {},
  initialDatabase: BarDatabase = createDemoDatabase(),
): BarRepository {
  let database = initialDatabase

  const defaults: BarRepository = {
    getSnapshot: vi.fn(async () => structuredClone(database)),
    listConsumers: vi.fn(async () => structuredClone(database.consumers)),
    listItems: vi.fn(async () => structuredClone(database.items)),
    listEvents: vi.fn(async () => structuredClone(database.events)),
    listTabs: vi.fn(async () => structuredClone(database.tabs)),
    listConsumptions: vi.fn(async () => structuredClone(database.consumptions)),
    listPayments: vi.fn(async () => structuredClone(database.payments)),
    listStockMovements: vi.fn(async () => structuredClone(database.stockMovements)),
    listMonthlyClosings: vi.fn(async () => structuredClone(database.monthlyClosings)),
    listMemberStatements: vi.fn(async () => structuredClone(database.memberStatements)),
    resetDemo: vi.fn(async () => {
      database = createDemoDatabase()
      return structuredClone(database)
    }),
    createVisitor: vi.fn(async () => notImplemented('createVisitor')),
    ensureEventTab: vi.fn(async () => notImplemented('ensureEventTab')),
    selectOrCreateActiveEvent: vi.fn(async () => notImplemented('selectOrCreateActiveEvent')),
    createConsumption: vi.fn(async () => notImplemented('createConsumption')),
    cancelConsumption: vi.fn(async () => notImplemented('cancelConsumption')),
    editConsumptionQuantity: vi.fn(async () => notImplemented('editConsumptionQuantity')),
    reassignConsumption: vi.fn(async () => notImplemented('reassignConsumption')),
    closeVisitorTab: vi.fn(async () => notImplemented('closeVisitorTab')),
    reopenVisitorTab: vi.fn(async () => notImplemented('reopenVisitorTab')),
    recordPayment: vi.fn(async () => notImplemented('recordPayment')),
    createMonthlyClosing: vi.fn(async () => notImplemented('createMonthlyClosing')),
    addStockMovement: vi.fn(async () => notImplemented('addStockMovement')),
  }

  return { ...defaults, ...overrides }
}
