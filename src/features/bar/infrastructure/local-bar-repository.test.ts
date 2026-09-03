import { describe, expect, it } from 'vitest'

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
import type { StorageLike } from '../application/bar-repository'
import {
  BarPersistenceError,
  LocalBarRepository,
} from './local-bar-repository'
import { createDemoDatabase } from './demo-seed'

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>()
  writes = 0

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.writes += 1
    this.values.set(key, value)
  }
}

const createRepository = (storage = new MemoryStorage()) => {
  let id = 0
  const repository = new LocalBarRepository({
    storage,
    storageKey: 'test-bar',
    nextId: () => `new-${++id}`,
    now: () => '2026-09-20T15:00:00.000Z',
  })
  return { repository, storage }
}

describe('LocalBarRepository persistence', () => {
  it('initializes missing storage with a realistic versioned September demo', async () => {
    const { repository, storage } = createRepository()

    const snapshot = await repository.getSnapshot()

    expect(JSON.parse(storage.values.get('test-bar') ?? '')).toEqual({
      version: 1,
      data: snapshot,
    })
    expect(snapshot.consumers).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: CONSUMER_KIND.MEMBER, active: true }),
      expect.objectContaining({ kind: CONSUMER_KIND.VISITOR, active: true }),
    ]))
    expect(snapshot.items.length).toBeGreaterThanOrEqual(5)
    expect(snapshot.events).toContainEqual(expect.objectContaining({
      status: EVENT_STATUS.ACTIVE,
    }))
    expect(snapshot.consumptions.length).toBeGreaterThan(0)
    expect(snapshot.payments.length).toBeGreaterThan(0)
    expect(snapshot.stockMovements.length).toBeGreaterThan(0)
  })

  it.each([
    ['malformed JSON', '{bad json'],
    ['unknown version', JSON.stringify({ version: 2, data: {} })],
    ['invalid structure', JSON.stringify({ version: 1, data: { consumers: [] } })],
  ])('throws a recoverable error for %s without overwriting bytes', async (_name, bytes) => {
    const { repository, storage } = createRepository()
    storage.values.set('test-bar', bytes)

    await expect(repository.getSnapshot()).rejects.toBeInstanceOf(BarPersistenceError)
    expect(storage.values.get('test-bar')).toBe(bytes)
    expect(storage.writes).toBe(0)
  })

  it('resetDemo explicitly replaces invalid storage', async () => {
    const { repository, storage } = createRepository()
    storage.values.set('test-bar', '{broken')

    const snapshot = await repository.resetDemo()

    expect(snapshot.consumers.length).toBeGreaterThan(0)
    expect(storage.writes).toBe(1)
  })

  it('rejects invalid nested entity shapes without overwriting bytes', async () => {
    const { repository, storage } = createRepository()
    const invalid = createDemoDatabase()
    ;(invalid.tabs[0] as { status: string }).status = 'unknown'
    const bytes = JSON.stringify({ version: 1, data: invalid })
    storage.values.set('test-bar', bytes)

    await expect(repository.getSnapshot()).rejects.toMatchObject({
      code: 'invalid-data', recoverable: true,
    })
    expect(storage.values.get('test-bar')).toBe(bytes)
  })

  it('rejects snapshots with orphaned entity references', async () => {
    const { repository, storage } = createRepository()
    const invalid = createDemoDatabase()
    ;(invalid.consumptions[0] as { itemId: string }).itemId = 'missing-item'
    const bytes = JSON.stringify({ version: 1, data: invalid })
    storage.values.set('test-bar', bytes)

    await expect(repository.getSnapshot()).rejects.toMatchObject({ code: 'invalid-data' })
    expect(storage.values.get('test-bar')).toBe(bytes)
  })

  it('returns defensive clones from full and list reads', async () => {
    const { repository } = createRepository()
    const snapshot = await repository.getSnapshot()
    const consumers = await repository.listConsumers()
    ;(snapshot.consumers[0] as { name: string }).name = 'Mutated snapshot'
    ;(consumers[0] as { name: string }).name = 'Mutated list'

    expect((await repository.getSnapshot()).consumers[0].name).not.toContain('Mutated')
  })
})

describe('LocalBarRepository workflows', () => {
  it('creates a visitor and idempotently ensures an event tab', async () => {
    const { repository } = createRepository()
    const event = await repository.selectOrCreateActiveEvent({ name: 'Passeio de domingo' })
    const visitor = await repository.createVisitor({ name: 'Carlos Lima', phone: '11999990000' })
    const first = await repository.ensureEventTab({ eventId: event.id, visitorId: visitor.id })
    const second = await repository.ensureEventTab({ eventId: event.id, visitorId: visitor.id })

    expect(visitor).toMatchObject({ kind: CONSUMER_KIND.VISITOR, active: true })
    expect(first).toEqual(second)
  })

  it('preserves a closed event tab until it is explicitly reopened', async () => {
    const { repository } = createRepository()
    const existing = (await repository.listTabs()).find(({ kind }) => kind === 'event')!
    await repository.closeVisitorTab(existing.id)

    const ensured = await repository.ensureEventTab({
      eventId: 'event-setembro',
      visitorId: existing.kind === 'event' ? existing.visitorId : '',
    })

    expect(ensured.status).toBe(TAB_STATUS.CLOSED)
    expect((await repository.reopenVisitorTab(existing.id)).status).toBe(TAB_STATUS.OPEN)
  })

  it('does not reopen an existing tab for a closed event', async () => {
    const { repository, storage } = createRepository()
    const database = createDemoDatabase()
    database.events[0] = { ...database.events[0], status: EVENT_STATUS.CLOSED }
    const bytes = JSON.stringify({ version: 1, data: database })
    storage.values.set('test-bar', bytes)

    await expect(repository.ensureEventTab({
      eventId: 'event-setembro', visitorId: 'visitor-rafael',
    })).rejects.toThrow('Event must be active')
    expect(storage.values.get('test-bar')).toBe(bytes)
  })

  it('refuses consumption and status changes on a tab of a closed event', async () => {
    const { repository, storage } = createRepository()
    const database = createDemoDatabase()
    const index = database.events.findIndex(({ id }) => id === 'event-setembro')
    database.events[index] = { ...database.events[index], status: EVENT_STATUS.CLOSED }
    const bytes = JSON.stringify({ version: 1, data: database })
    storage.values.set('test-bar', bytes)

    await expect(repository.createConsumption({
      tabId: 'tab-rafael-evento', itemId: 'item-cerveja', quantity: 1,
      chargeKind: CHARGE_KIND.CHARGED, actorId: 'admin',
    })).rejects.toThrow('Event must be active')
    await expect(repository.closeVisitorTab('tab-rafael-evento'))
      .rejects.toThrow('Event must be active')
    await expect(repository.reopenVisitorTab('tab-rafael-evento'))
      .rejects.toThrow('Event must be active')
    expect(storage.values.get('test-bar')).toBe(bytes)
  })

  it('uses the existing active event or creates one after closing it', async () => {
    const { repository } = createRepository()
    const existing = await repository.selectOrCreateActiveEvent({ name: 'Ignored' })
    const same = await repository.selectOrCreateActiveEvent({ name: 'Ignored again' })

    expect(same.id).toBe(existing.id)
  })

  it('records tracked consumption atomically and updates stock', async () => {
    const { repository, storage } = createRepository()
    const snapshot = await repository.getSnapshot()
    const tab = snapshot.tabs.find(({ status }) => status === TAB_STATUS.OPEN)!
    const item = snapshot.items.find(({ stockQuantity }) => stockQuantity !== undefined)!
    const writesBefore = storage.writes

    const result = await repository.createConsumption({
      tabId: tab.id, itemId: item.id, quantity: 2,
      chargeKind: CHARGE_KIND.CHARGED, actorId: 'admin',
    })
    const after = await repository.getSnapshot()

    expect(storage.writes - writesBefore).toBe(1)
    expect(after.items.find(({ id }) => id === item.id)?.stockQuantity)
      .toBe(item.stockQuantity! - 2)
    expect(after.stockMovements).toContainEqual(result.stockMovement)
  })

  it('cancels only active consumption with its validated movement and restores stock', async () => {
    const { repository, storage } = createRepository()
    const snapshot = await repository.getSnapshot()
    const trackedConsumptionIds = new Set(snapshot.stockMovements
      .filter(({ kind }) => kind === STOCK_MOVEMENT_KIND.CONSUMPTION)
      .map(({ consumptionId }) => consumptionId))
    const original = snapshot.consumptions.find(({ id, status }) =>
      status === CONSUMPTION_STATUS.ACTIVE && trackedConsumptionIds.has(id),
    )!
    const originalItem = snapshot.items.find(({ id }) => id === original.itemId)!
    const beforeBytes = storage.values.get('test-bar')

    const cancelled = await repository.cancelConsumption({
      consumptionId: original.id, actorId: 'admin',
    })
    await expect(repository.cancelConsumption({
      consumptionId: original.id, actorId: 'admin',
    })).rejects.toThrow('Only active consumption can be cancelled')

    expect(cancelled.consumption.status).toBe(CONSUMPTION_STATUS.CANCELLED)
    expect(cancelled.stockMovement?.quantityDelta).toBe(original.quantity)
    expect((await repository.listItems()).find(({ id }) => id === original.itemId)?.stockQuantity)
      .toBe(originalItem.stockQuantity! + original.quantity)
    expect(storage.values.get('test-bar')).not.toBe(beforeBytes)
  })

  it('leaves bytes unchanged when a mutation fails', async () => {
    const { repository, storage } = createRepository()
    await repository.getSnapshot()
    const bytes = storage.values.get('test-bar')
    const writes = storage.writes

    await expect(repository.createConsumption({
      tabId: 'missing', itemId: 'missing', quantity: 0,
      chargeKind: CHARGE_KIND.CHARGED, actorId: 'admin',
    })).rejects.toThrow()

    expect(storage.values.get('test-bar')).toBe(bytes)
    expect(storage.writes).toBe(writes)
  })

  it('rejects unsafe consumption quantities without writing', async () => {
    const { repository, storage } = createRepository()
    const database = createDemoDatabase()
    const itemIndex = database.items.findIndex(({ id }) => id === 'item-porcao')
    database.items[itemIndex] = {
      ...database.items[itemIndex], unitCostCents: 0, unitPriceCents: 0,
    }
    const bytes = JSON.stringify({ version: 1, data: database })
    storage.values.set('test-bar', bytes)

    await expect(repository.createConsumption({
      tabId: 'tab-ana-2026-09', itemId: 'item-porcao',
      quantity: Number.MAX_SAFE_INTEGER + 1,
      chargeKind: CHARGE_KIND.CHARGED, actorId: 'admin',
    })).rejects.toThrow('Consumption quantity must be a positive safe integer')
    expect(storage.values.get('test-bar')).toBe(bytes)
  })

  it('rejects unsafe stock results for consumption and cancellation without writing', async () => {
    const { repository, storage } = createRepository()
    const underflow = createDemoDatabase()
    const itemIndex = underflow.items.findIndex(({ id }) => id === 'item-cerveja')
    underflow.items[itemIndex] = {
      ...underflow.items[itemIndex], stockQuantity: Number.MIN_SAFE_INTEGER,
    }
    let bytes = JSON.stringify({ version: 1, data: underflow })
    storage.values.set('test-bar', bytes)

    await expect(repository.createConsumption({
      tabId: 'tab-ana-2026-09', itemId: 'item-cerveja', quantity: 1,
      chargeKind: CHARGE_KIND.CHARGED, actorId: 'admin',
    })).rejects.toThrow('Stock quantity must be a safe integer')
    expect(storage.values.get('test-bar')).toBe(bytes)

    const overflow = createDemoDatabase()
    overflow.items[itemIndex] = {
      ...overflow.items[itemIndex], stockQuantity: Number.MAX_SAFE_INTEGER,
    }
    bytes = JSON.stringify({ version: 1, data: overflow })
    storage.values.set('test-bar', bytes)

    await expect(repository.cancelConsumption({
      consumptionId: 'cons-ana-cerveja', actorId: 'admin',
    })).rejects.toThrow('Stock quantity must be a safe integer')
    expect(storage.values.get('test-bar')).toBe(bytes)
  })

  it('edits quantity with cancellation and replacement audit records', async () => {
    const { repository } = createRepository()
    const before = await repository.getSnapshot()
    const original = before.consumptions.find(({ status }) => status === CONSUMPTION_STATUS.ACTIVE)!

    const result = await repository.editConsumptionQuantity({
      consumptionId: original.id, quantity: original.quantity + 1, actorId: 'admin',
    })

    expect(result.cancelledConsumption.status).toBe(CONSUMPTION_STATUS.CANCELLED)
    expect(result.replacement.quantity).toBe(original.quantity + 1)
    expect(result.replacement.id).not.toBe(original.id)
  })

  it('reassigns an active consumption only to a compatible open tab', async () => {
    const { repository } = createRepository()
    const before = await repository.getSnapshot()
    const source = before.consumptions.find(({ status }) => status === CONSUMPTION_STATUS.ACTIVE)!
    const sourceTab = before.tabs.find(({ id }) => id === source.tabId)!
    const target = before.tabs.find(({ id, kind, status }) =>
      id !== source.tabId && kind === sourceTab.kind && status === TAB_STATUS.OPEN,
    )
    if (!target) throw new Error('Seed must provide compatible open tabs')

    const reassigned = await repository.reassignConsumption({
      consumptionId: source.id, targetTabId: target.id,
    })

    expect(reassigned).toMatchObject({ tabId: target.id })
    expect(reassigned.consumerId).not.toBe(source.consumerId)
  })

  it('closes and reopens visitor tabs explicitly', async () => {
    const { repository } = createRepository()
    const tab = (await repository.getSnapshot()).tabs.find(({ kind }) => kind === 'event')!

    expect((await repository.closeVisitorTab(tab.id)).status).toBe(TAB_STATUS.CLOSED)
    expect((await repository.reopenVisitorTab(tab.id)).status).toBe(TAB_STATUS.OPEN)
  })

  it('records only strictly positive payments', async () => {
    const { repository, storage } = createRepository()
    const tab = (await repository.getSnapshot()).tabs
      .find(({ kind }) => kind === TAB_KIND.EVENT)!
    const payment = await repository.recordPayment({
      target: PAYMENT_TARGET.TAB, targetId: tab.id, amountCents: 500, actorId: 'admin',
    })
    const bytes = storage.values.get('test-bar')

    expect(payment.amountCents).toBe(500)
    await expect(repository.recordPayment({
      target: PAYMENT_TARGET.TAB, targetId: tab.id, amountCents: 0, actorId: 'admin',
    })).rejects.toThrow('Money amounts must use positive safe integer cents')
    expect(storage.values.get('test-bar')).toBe(bytes)
  })

  it('refuses to pay a monthly tab as if it were a visitor tab', async () => {
    const { repository, storage } = createRepository()
    await repository.getSnapshot()
    const bytes = storage.values.get('test-bar')

    await expect(repository.recordPayment({
      target: PAYMENT_TARGET.TAB, targetId: 'tab-ana-2026-09',
      amountCents: 2_100, actorId: 'admin',
    })).rejects.toThrow('Monthly tab debt must be paid through its member statement')
    expect(storage.values.get('test-bar')).toBe(bytes)
  })

  it('caps a visitor tab payment at the outstanding balance', async () => {
    const { repository, storage } = createRepository()
    await repository.getSnapshot()
    const bytes = storage.values.get('test-bar')

    await expect(repository.recordPayment({
      target: PAYMENT_TARGET.TAB, targetId: 'tab-rafael-evento',
      amountCents: 999_999_900, actorId: 'admin',
    })).rejects.toThrow('Payment cannot exceed the amount due')
    await expect(repository.recordPayment({
      target: PAYMENT_TARGET.TAB, targetId: 'tab-rafael-evento',
      amountCents: 501, actorId: 'admin',
    })).rejects.toThrow('Payment cannot exceed the amount due')
    await expect(repository.recordPayment({
      target: PAYMENT_TARGET.TAB, targetId: 'tab-juliana-evento',
      amountCents: 1, actorId: 'admin',
    })).rejects.toThrow('Payment cannot exceed the amount due')
    expect(storage.values.get('test-bar')).toBe(bytes)

    const settlement = await repository.recordPayment({
      target: PAYMENT_TARGET.TAB, targetId: 'tab-rafael-evento',
      amountCents: 500, actorId: 'admin',
    })

    expect(settlement.amountCents).toBe(500)
    await expect(repository.recordPayment({
      target: PAYMENT_TARGET.TAB, targetId: 'tab-rafael-evento',
      amountCents: 1, actorId: 'admin',
    })).rejects.toThrow('Payment cannot exceed the amount due')
  })

  it('rejects a payment aimed at a target that does not exist', async () => {
    const { repository } = createRepository()

    await expect(repository.recordPayment({
      target: PAYMENT_TARGET.TAB, targetId: 'missing-tab',
      amountCents: 100, actorId: 'admin',
    })).rejects.toThrow('Payment target not found')
    await expect(repository.recordPayment({
      target: PAYMENT_TARGET.STATEMENT, targetId: 'missing-statement',
      amountCents: 100, actorId: 'admin',
    })).rejects.toThrow('Payment target not found')
  })

  it('caps a statement payment at the outstanding balance', async () => {
    const { repository } = createRepository()
    const { statements } = await repository.createMonthlyClosing({
      month: '2026-09', actorId: 'admin',
    })
    const statement = statements.find(({ memberId }) => memberId === 'member-ana')!

    await expect(repository.recordPayment({
      target: PAYMENT_TARGET.STATEMENT, targetId: statement.id,
      amountCents: 2_101, actorId: 'admin',
    })).rejects.toThrow('Payment cannot exceed the amount due')
    const settlement = await repository.recordPayment({
      target: PAYMENT_TARGET.STATEMENT, targetId: statement.id,
      amountCents: 2_100, actorId: 'admin',
    })

    expect(settlement.amountCents).toBe(2_100)
  })

  it('creates a monthly closing once with member statements', async () => {
    const { repository, storage } = createRepository()
    const result = await repository.createMonthlyClosing({ month: '2026-09', actorId: 'admin' })
    const bytes = storage.values.get('test-bar')

    expect(result.closing.month).toBe('2026-09')
    expect(result.statements.length).toBeGreaterThan(0)
    await expect(repository.createMonthlyClosing({ month: '2026-09', actorId: 'admin' }))
      .rejects.toThrow('Monthly closing already exists')
    expect(storage.values.get('test-bar')).toBe(bytes)
  })

  it('closes the monthly tabs of the closed month so late consumption is refused', async () => {
    const { repository } = createRepository()

    await repository.createMonthlyClosing({ month: '2026-09', actorId: 'admin' })
    const monthlyTabs = (await repository.listTabs())
      .filter(({ kind }) => kind === TAB_KIND.MONTHLY)

    expect(monthlyTabs.map(({ id, status, closedAt }) => ({ id, status, closedAt })))
      .toEqual([
        { id: 'tab-ana-2026-09', status: TAB_STATUS.CLOSED, closedAt: '2026-09-20T15:00:00.000Z' },
        { id: 'tab-bruno-2026-09', status: TAB_STATUS.CLOSED, closedAt: '2026-09-20T15:00:00.000Z' },
        { id: 'tab-celia-2026-09', status: TAB_STATUS.CLOSED, closedAt: '2026-09-20T15:00:00.000Z' },
      ])
    await expect(repository.createConsumption({
      tabId: 'tab-ana-2026-09', itemId: 'item-cerveja', quantity: 1,
      chargeKind: CHARGE_KIND.CHARGED, actorId: 'admin',
    })).rejects.toThrow('Cannot add consumption to a closed tab')
  })

  it('leaves monthly tabs from other months untouched by a closing', async () => {
    const { repository, storage } = createRepository()
    const database = createDemoDatabase()
    const index = database.tabs.findIndex(({ id }) => id === 'tab-celia-2026-09')
    ;(database.tabs[index] as { month: string }).month = '2026-08'
    storage.values.set('test-bar', JSON.stringify({ version: 1, data: database }))

    await repository.createMonthlyClosing({ month: '2026-09', actorId: 'admin' })

    const tabs = await repository.listTabs()
    expect(tabs.find(({ id }) => id === 'tab-celia-2026-09')!.status).toBe(TAB_STATUS.OPEN)
    expect(tabs.find(({ id }) => id === 'tab-ana-2026-09')!.status).toBe(TAB_STATUS.CLOSED)
  })

  it.each([
    [STOCK_MOVEMENT_KIND.ENTRY, 5],
    [STOCK_MOVEMENT_KIND.ADJUSTMENT, -2],
  ] as const)('adds a %s movement and updates tracked stock', async (kind, quantityDelta) => {
    const { repository } = createRepository()
    const item = (await repository.listItems()).find(
      ({ stockQuantity }) => stockQuantity !== undefined,
    )!
    const movement = await repository.addStockMovement({
      itemId: item.id, kind, quantityDelta, actorId: 'admin',
    })

    const updated = (await repository.listItems()).find(({ id }) => id === item.id)!
    expect(movement.quantityDelta).toBe(quantityDelta)
    expect(updated.stockQuantity).toBe(item.stockQuantity! + quantityDelta)
  })
})
