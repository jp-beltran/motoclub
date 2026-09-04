import { describe, expect, it } from 'vitest'

import { expectRejectedBarErrorCode } from '../../../test/bar-error-assertions'
import type { BarErrorCode } from '../domain/errors'
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
import { getMonthKey } from '../domain/month'
import { getCurrentMonth } from '../../../shared/date'
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

/**
 * The demo seed derives its month from the clock, so everything anchored to
 * it here is derived too: SEED_MONTH is the month the seed populated,
 * DEFAULT_NOW an instant well inside it, and LATER_MONTH one the seed has no
 * tab in. Pinning any of these to a literal month made the suite pass only
 * while today happened to fall in it.
 */
const SEED_MONTH = getCurrentMonth()
const SEED_YEAR = Number(SEED_MONTH.split('-')[0])
const SEED_MONTH_INDEX = Number(SEED_MONTH.split('-')[1]) - 1
const DEFAULT_NOW = new Date(SEED_YEAR, SEED_MONTH_INDEX, 20, 15, 0).toISOString()
const LATER_MONTH_NOW = new Date(SEED_YEAR, SEED_MONTH_INDEX + 1, 4, 15, 0).toISOString()
const LATER_MONTH = getCurrentMonth(new Date(LATER_MONTH_NOW))
const EARLIER_MONTH = getCurrentMonth(new Date(SEED_YEAR, SEED_MONTH_INDEX - 1, 1))

const createRepository = (storage = new MemoryStorage(), now = DEFAULT_NOW) => {
  let id = 0
  const repository = new LocalBarRepository({
    storage,
    storageKey: 'test-bar',
    nextId: () => `new-${++id}`,
    now: () => now,
  })
  return { repository, storage }
}

/**
 * A member with no monthly tab in the seed, so ensureMonthlyTab has to create
 * one instead of reusing a seeded September tab.
 */
const seedWithTablessMember = (storage: MemoryStorage) => {
  const database = createDemoDatabase()
  database.consumers.push({
    id: 'member-novo',
    name: 'Novo Integrante',
    kind: CONSUMER_KIND.MEMBER,
    active: true,
  })
  storage.values.set('test-bar', JSON.stringify({ version: 1, data: database }))
  return storage
}

describe('LocalBarRepository persistence', () => {
  it('initializes missing storage with a realistic versioned demo of the current month', async () => {
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
    ['malformed JSON', '{bad json', 'stored-data-malformed'],
    ['unknown version', JSON.stringify({ version: 2, data: {} }), 'stored-data-unsupported-version'],
    [
      'invalid structure',
      JSON.stringify({ version: 1, data: { consumers: [] } }),
      'stored-data-invalid',
    ],
  ] satisfies readonly (readonly [string, string, BarErrorCode])[])(
    'throws a recoverable error for %s without overwriting bytes',
    async (_name, bytes, code) => {
      const { repository, storage } = createRepository()
      storage.values.set('test-bar', bytes)

      await expect(repository.getSnapshot()).rejects.toBeInstanceOf(BarPersistenceError)
      await expectRejectedBarErrorCode(repository.getSnapshot(), code)
      expect(storage.values.get('test-bar')).toBe(bytes)
      expect(storage.writes).toBe(0)
    },
  )

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
      code: 'stored-data-invalid', recoverable: true,
    })
    expect(storage.values.get('test-bar')).toBe(bytes)
  })

  it('rejects snapshots with orphaned entity references', async () => {
    const { repository, storage } = createRepository()
    const invalid = createDemoDatabase()
    ;(invalid.consumptions[0] as { itemId: string }).itemId = 'missing-item'
    const bytes = JSON.stringify({ version: 1, data: invalid })
    storage.values.set('test-bar', bytes)

    await expect(repository.getSnapshot()).rejects.toMatchObject({
      code: 'stored-data-invalid',
    })
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

  it('opens a monthly tab for a member that has none in the month', async () => {
    const { repository } = createRepository(seedWithTablessMember(new MemoryStorage()))

    const tab = await repository.ensureMonthlyTab({
      memberId: 'member-novo',
      month: getMonthKey(DEFAULT_NOW),
    })

    expect(tab).toEqual({
      id: 'new-1',
      kind: TAB_KIND.MONTHLY,
      status: TAB_STATUS.OPEN,
      memberId: 'member-novo',
      month: SEED_MONTH,
      openedAt: DEFAULT_NOW,
    })
    expect(await repository.listTabs()).toContainEqual(tab)
  })

  /**
   * A monthly closing closes tabs by `tab.month` but attributes consumption by
   * `getMonthKey(consumption.createdAt)`. If the two keys could disagree, a
   * consumption would be consolidated into one month while its tab was stamped
   * with another, so the closing would neither capture it nor close its tab.
   */
  it('stamps a created tab with the same month key attribution uses', async () => {
    const lastLocalEveningOfSeptember = new Date(2026, 8, 30, 22, 0).toISOString()
    const { repository } = createRepository(
      seedWithTablessMember(new MemoryStorage()),
      lastLocalEveningOfSeptember,
    )

    const tab = await repository.ensureMonthlyTab({
      memberId: 'member-novo',
      month: getCurrentMonth(new Date(lastLocalEveningOfSeptember)),
    })

    expect(tab.month).toBe(getMonthKey(lastLocalEveningOfSeptember))
    expect(tab.month).toBe(getCurrentMonth(new Date(lastLocalEveningOfSeptember)))
  })

  it('refuses to open a tab for a month other than the write-time month', async () => {
    const { repository, storage } = createRepository(
      seedWithTablessMember(new MemoryStorage()),
    )
    const bytes = storage.values.get('test-bar')

    await expectRejectedBarErrorCode(
      repository.ensureMonthlyTab({ memberId: 'member-novo', month: LATER_MONTH }),
      'monthly-tab-month-mismatch',
    )
    expect(storage.values.get('test-bar')).toBe(bytes)
  })

  it('still returns an existing tab from a month that is already over', async () => {
    const { repository } = createRepository(new MemoryStorage(), LATER_MONTH_NOW)

    const tab = await repository.ensureMonthlyTab({ memberId: 'member-ana', month: SEED_MONTH })

    expect(tab.id).toBe('tab-ana-mensal')
  })

  it('idempotently reuses the monthly tab already open for the month', async () => {
    const { repository } = createRepository()

    const first = await repository.ensureMonthlyTab({ memberId: 'member-ana', month: SEED_MONTH })
    const second = await repository.ensureMonthlyTab({ memberId: 'member-ana', month: SEED_MONTH })

    expect(first.id).toBe('tab-ana-mensal')
    expect(second).toEqual(first)
    expect((await repository.listTabs()).filter(({ kind }) => kind === TAB_KIND.MONTHLY))
      .toHaveLength(3)
  })

  it('returns a closed monthly tab as it is instead of reopening it', async () => {
    const { repository } = createRepository()
    await repository.createMonthlyClosing({ month: SEED_MONTH, actorId: 'admin' })

    const tab = await repository.ensureMonthlyTab({ memberId: 'member-ana', month: SEED_MONTH })

    expect(tab).toMatchObject({
      id: 'tab-ana-mensal',
      status: TAB_STATUS.CLOSED,
      closedAt: DEFAULT_NOW,
    })
    await expectRejectedBarErrorCode(repository.createConsumption({
      tabId: tab.id, itemId: 'item-cerveja', quantity: 1,
      chargeKind: CHARGE_KIND.CHARGED, actorId: 'admin',
    }), 'tab-closed')
  })

  it.each(['2026-9', '2026/09', '2026-13', 'setembro', '2026-00'])(
    'rejects the malformed month %s without writing',
    async (month) => {
      const { repository, storage } = createRepository()
      await repository.getSnapshot()
      const bytes = storage.values.get('test-bar')

      await expectRejectedBarErrorCode(
        repository.ensureMonthlyTab({ memberId: 'member-ana', month }),
        'month-format-invalid',
      )
      expect(storage.values.get('test-bar')).toBe(bytes)
    },
  )

  it.each([
    ['visitor-rafael', 'a visitor', 'consumer-not-active-member'],
    ['item-cerveja', 'an unknown consumer', 'consumer-not-found'],
  ] satisfies readonly (readonly [string, string, BarErrorCode])[])(
    'rejects a monthly tab for %s (%s)',
    async (memberId, _description, code) => {
      const { repository } = createRepository()

      await expectRejectedBarErrorCode(
        repository.ensureMonthlyTab({ memberId, month: SEED_MONTH }),
        code,
      )
    },
  )

  it('rejects a monthly tab for an inactive member', async () => {
    const { repository, storage } = createRepository()
    const database = createDemoDatabase()
    const index = database.consumers.findIndex(({ id }) => id === 'member-celia')
    database.consumers[index] = { ...database.consumers[index], active: false }
    storage.values.set('test-bar', JSON.stringify({ version: 1, data: database }))

    await expectRejectedBarErrorCode(
      repository.ensureMonthlyTab({ memberId: 'member-celia', month: SEED_MONTH }),
      'consumer-not-active-member',
    )
  })

  it('preserves a closed event tab until it is explicitly reopened', async () => {
    const { repository } = createRepository()
    const existing = (await repository.listTabs()).find(({ kind }) => kind === 'event')!
    await repository.closeVisitorTab(existing.id)

    const ensured = await repository.ensureEventTab({
      eventId: 'event-encontro',
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

    await expectRejectedBarErrorCode(repository.ensureEventTab({
      eventId: 'event-encontro', visitorId: 'visitor-rafael',
    }), 'event-not-active')
    expect(storage.values.get('test-bar')).toBe(bytes)
  })

  it('refuses consumption and status changes on a tab of a closed event', async () => {
    const { repository, storage } = createRepository()
    const database = createDemoDatabase()
    const index = database.events.findIndex(({ id }) => id === 'event-encontro')
    database.events[index] = { ...database.events[index], status: EVENT_STATUS.CLOSED }
    const bytes = JSON.stringify({ version: 1, data: database })
    storage.values.set('test-bar', bytes)

    await expectRejectedBarErrorCode(repository.createConsumption({
      tabId: 'tab-rafael-evento', itemId: 'item-cerveja', quantity: 1,
      chargeKind: CHARGE_KIND.CHARGED, actorId: 'admin',
    }), 'event-not-active')
    await expectRejectedBarErrorCode(
      repository.closeVisitorTab('tab-rafael-evento'),
      'event-not-active',
    )
    await expectRejectedBarErrorCode(
      repository.reopenVisitorTab('tab-rafael-evento'),
      'event-not-active',
    )
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
    await expectRejectedBarErrorCode(repository.cancelConsumption({
      consumptionId: original.id, actorId: 'admin',
    }), 'consumption-already-cancelled')

    expect(cancelled.consumption.status).toBe(CONSUMPTION_STATUS.CANCELLED)
    expect(cancelled.stockMovement?.quantityDelta).toBe(original.quantity)
    expect((await repository.listItems()).find(({ id }) => id === original.itemId)?.stockQuantity)
      .toBe(originalItem.stockQuantity! + original.quantity)
    expect(storage.values.get('test-bar')).not.toBe(beforeBytes)
  })

  it('refuses to cancel consumption a monthly closing already froze', async () => {
    const { repository, storage } = createRepository()
    await repository.createMonthlyClosing({ month: SEED_MONTH, actorId: 'admin' })
    const bytes = storage.values.get('test-bar')

    await expectRejectedBarErrorCode(repository.cancelConsumption({
      consumptionId: 'cons-ana-cerveja', actorId: 'admin',
    }), 'consumption-frozen-in-statement')

    expect(storage.values.get('test-bar')).toBe(bytes)
  })

  /**
   * `assertCancellable` runs on every cancel and every quantity edit, and
   * `findCancellationBlock` totals stored payments to decide. No operator
   * input reaches that sum, so a money invariant broken there is corrupt
   * storage — the same 500, not the 400 a raw `money-*` code would imply.
   */
  it('reports a corrupt stored payment as stored data when cancelling, not as a money fault', async () => {
    const { repository, storage } = createRepository()
    const database = createDemoDatabase()
    // Individually valid (safe, positive), so the envelope check passes; the
    // structural check cannot see that they overflow when summed.
    database.payments.push(
      {
        id: 'payment-huge-1', target: PAYMENT_TARGET.TAB, targetId: 'tab-rafael-evento',
        amountCents: Number.MAX_SAFE_INTEGER, paidAt: DEFAULT_NOW, actorId: 'admin',
      },
      {
        id: 'payment-huge-2', target: PAYMENT_TARGET.TAB, targetId: 'tab-rafael-evento',
        amountCents: Number.MAX_SAFE_INTEGER, paidAt: DEFAULT_NOW, actorId: 'admin',
      },
    )
    storage.values.set('test-bar', JSON.stringify({ version: 1, data: database }))

    await expectRejectedBarErrorCode(repository.cancelConsumption({
      consumptionId: 'cons-rafael-refri', actorId: 'admin',
    }), 'stored-data-invalid')

    // The quantity-edit path goes through the same guard.
    await expectRejectedBarErrorCode(repository.editConsumptionQuantity({
      consumptionId: 'cons-rafael-refri', quantity: 1, actorId: 'admin',
    }), 'stored-data-invalid')
  })

  it('refuses to cancel consumption on a closed tab', async () => {
    const { repository, storage } = createRepository()
    await repository.closeVisitorTab('tab-rafael-evento')
    const bytes = storage.values.get('test-bar')

    await expectRejectedBarErrorCode(repository.cancelConsumption({
      consumptionId: 'cons-rafael-refri', actorId: 'admin',
    }), 'consumption-tab-closed')

    expect(storage.values.get('test-bar')).toBe(bytes)
  })

  it('refuses a cancellation that would leave the tab overpaid', async () => {
    const { repository, storage } = createRepository()
    // Rafael's tab: 2x Refrigerante = R$ 12,00, R$ 7,00 already settled in
    // the seed. Settle the other R$ 5,00 and the tab is square; cancelling
    // the line now would strand the whole R$ 12,00 with the club.
    await repository.recordPayment({
      target: PAYMENT_TARGET.TAB, targetId: 'tab-rafael-evento',
      amountCents: 500, actorId: 'admin',
    })
    const bytes = storage.values.get('test-bar')

    await expectRejectedBarErrorCode(repository.cancelConsumption({
      consumptionId: 'cons-rafael-refri', actorId: 'admin',
    }), 'consumption-covered-by-payment')

    expect(storage.values.get('test-bar')).toBe(bytes)
  })

  it('never lets a settled tab saturate into a silent overpayment', async () => {
    const { repository } = createRepository()
    await repository.recordPayment({
      target: PAYMENT_TARGET.TAB, targetId: 'tab-rafael-evento',
      amountCents: 500, actorId: 'admin',
    })

    await expect(repository.cancelConsumption({
      consumptionId: 'cons-rafael-refri', actorId: 'admin',
    })).rejects.toThrow()

    // The refusal is what keeps the money honest: the tab still owes nothing
    // and still holds exactly the R$ 12,00 it was paid, with the line intact.
    const snapshot = await repository.getSnapshot()
    const line = snapshot.consumptions.find(({ id }) => id === 'cons-rafael-refri')
    expect(line?.status).toBe(CONSUMPTION_STATUS.ACTIVE)
    expect(snapshot.payments
      .filter(({ targetId }) => targetId === 'tab-rafael-evento')
      .reduce((total, { amountCents }) => total + amountCents, 0)).toBe(1200)
  })

  it('refuses to edit the quantity of consumption a closing already froze', async () => {
    const { repository } = createRepository()
    await repository.createMonthlyClosing({ month: SEED_MONTH, actorId: 'admin' })

    await expectRejectedBarErrorCode(repository.editConsumptionQuantity({
      consumptionId: 'cons-ana-cerveja', quantity: 1, actorId: 'admin',
    }), 'consumption-frozen-in-statement')
  })

  it('still cancels a line a partial payment does not yet cover', async () => {
    const { repository } = createRepository()
    // R$ 12,00 due, R$ 7,00 settled in the seed: adding a second line and
    // cancelling it leaves R$ 12,00 due, still above what was paid.
    const added = await repository.createConsumption({
      tabId: 'tab-rafael-evento', itemId: 'item-espetinho', quantity: 1,
      chargeKind: CHARGE_KIND.CHARGED, actorId: 'admin',
    })

    const cancelled = await repository.cancelConsumption({
      consumptionId: added.consumption.id, actorId: 'admin',
    })

    expect(cancelled.consumption.status).toBe(CONSUMPTION_STATUS.CANCELLED)
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

    await expectRejectedBarErrorCode(repository.createConsumption({
      tabId: 'tab-ana-mensal', itemId: 'item-porcao',
      quantity: Number.MAX_SAFE_INTEGER + 1,
      chargeKind: CHARGE_KIND.CHARGED, actorId: 'admin',
    }), 'consumption-quantity-invalid')
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

    await expectRejectedBarErrorCode(repository.createConsumption({
      tabId: 'tab-ana-mensal', itemId: 'item-cerveja', quantity: 1,
      chargeKind: CHARGE_KIND.CHARGED, actorId: 'admin',
    }), 'stock-quantity-overflow')
    expect(storage.values.get('test-bar')).toBe(bytes)

    const overflow = createDemoDatabase()
    overflow.items[itemIndex] = {
      ...overflow.items[itemIndex], stockQuantity: Number.MAX_SAFE_INTEGER,
    }
    bytes = JSON.stringify({ version: 1, data: overflow })
    storage.values.set('test-bar', bytes)

    await expectRejectedBarErrorCode(repository.cancelConsumption({
      consumptionId: 'cons-ana-cerveja', actorId: 'admin',
    }), 'stock-quantity-overflow')
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
    await expectRejectedBarErrorCode(repository.recordPayment({
      target: PAYMENT_TARGET.TAB, targetId: tab.id, amountCents: 0, actorId: 'admin',
    }), 'money-amount-not-positive')
    expect(storage.values.get('test-bar')).toBe(bytes)
  })

  /**
   * `assertPositiveCents` guards both the amount the operator typed and every
   * payment already on disk, and `recordPayment` reaches it both ways in one
   * mutation. The two must not arrive as the same code: one is a bad request,
   * the other is corrupt storage, and a server keying status on the code would
   * answer 400 for a 500.
   */
  it('separates a bad payment amount from a corrupt stored payment by code', async () => {
    const { repository, storage } = createRepository()
    const database = createDemoDatabase()
    const tab = database.tabs.find(({ kind }) => kind === TAB_KIND.EVENT)!
    // Two stored payments that each pass envelope validation (safe, positive)
    // but overflow safe-integer cents when summed. Nothing the operator types
    // can fix these rows, and the structural check cannot see the sum.
    database.payments.push(
      {
        id: 'payment-huge-1', target: PAYMENT_TARGET.TAB, targetId: tab.id,
        amountCents: Number.MAX_SAFE_INTEGER, paidAt: DEFAULT_NOW, actorId: 'admin',
      },
      {
        id: 'payment-huge-2', target: PAYMENT_TARGET.TAB, targetId: tab.id,
        amountCents: Number.MAX_SAFE_INTEGER, paidAt: DEFAULT_NOW, actorId: 'admin',
      },
    )
    storage.values.set('test-bar', JSON.stringify({ version: 1, data: database }))

    await expectRejectedBarErrorCode(repository.recordPayment({
      target: PAYMENT_TARGET.TAB, targetId: tab.id, amountCents: 100, actorId: 'admin',
    }), 'stored-data-invalid')
  })

  it('refuses to pay a monthly tab as if it were a visitor tab', async () => {
    const { repository, storage } = createRepository()
    await repository.getSnapshot()
    const bytes = storage.values.get('test-bar')

    await expectRejectedBarErrorCode(repository.recordPayment({
      target: PAYMENT_TARGET.TAB, targetId: 'tab-ana-mensal',
      amountCents: 2_100, actorId: 'admin',
    }), 'monthly-tab-payment-not-allowed')
    expect(storage.values.get('test-bar')).toBe(bytes)
  })

  it('caps a visitor tab payment at the outstanding balance', async () => {
    const { repository, storage } = createRepository()
    await repository.getSnapshot()
    const bytes = storage.values.get('test-bar')

    await expectRejectedBarErrorCode(repository.recordPayment({
      target: PAYMENT_TARGET.TAB, targetId: 'tab-rafael-evento',
      amountCents: 999_999_900, actorId: 'admin',
    }), 'payment-exceeds-balance')
    await expectRejectedBarErrorCode(repository.recordPayment({
      target: PAYMENT_TARGET.TAB, targetId: 'tab-rafael-evento',
      amountCents: 501, actorId: 'admin',
    }), 'payment-exceeds-balance')
    await expectRejectedBarErrorCode(repository.recordPayment({
      target: PAYMENT_TARGET.TAB, targetId: 'tab-juliana-evento',
      amountCents: 1, actorId: 'admin',
    }), 'payment-exceeds-balance')
    expect(storage.values.get('test-bar')).toBe(bytes)

    const settlement = await repository.recordPayment({
      target: PAYMENT_TARGET.TAB, targetId: 'tab-rafael-evento',
      amountCents: 500, actorId: 'admin',
    })

    expect(settlement.amountCents).toBe(500)
    await expectRejectedBarErrorCode(repository.recordPayment({
      target: PAYMENT_TARGET.TAB, targetId: 'tab-rafael-evento',
      amountCents: 1, actorId: 'admin',
    }), 'payment-exceeds-balance')
  })

  it('rejects a payment aimed at a target that does not exist', async () => {
    const { repository } = createRepository()

    await expectRejectedBarErrorCode(repository.recordPayment({
      target: PAYMENT_TARGET.TAB, targetId: 'missing-tab',
      amountCents: 100, actorId: 'admin',
    }), 'payment-target-not-found')
    await expectRejectedBarErrorCode(repository.recordPayment({
      target: PAYMENT_TARGET.STATEMENT, targetId: 'missing-statement',
      amountCents: 100, actorId: 'admin',
    }), 'payment-target-not-found')
  })

  it('caps a statement payment at the outstanding balance', async () => {
    const { repository } = createRepository()
    const { statements } = await repository.createMonthlyClosing({
      month: SEED_MONTH, actorId: 'admin',
    })
    const statement = statements.find(({ memberId }) => memberId === 'member-ana')!

    await expectRejectedBarErrorCode(repository.recordPayment({
      target: PAYMENT_TARGET.STATEMENT, targetId: statement.id,
      amountCents: 2_101, actorId: 'admin',
    }), 'payment-exceeds-balance')
    const settlement = await repository.recordPayment({
      target: PAYMENT_TARGET.STATEMENT, targetId: statement.id,
      amountCents: 2_100, actorId: 'admin',
    })

    expect(settlement.amountCents).toBe(2_100)
  })

  it('creates a monthly closing once with member statements', async () => {
    const { repository, storage } = createRepository()
    const result = await repository.createMonthlyClosing({ month: SEED_MONTH, actorId: 'admin' })
    const bytes = storage.values.get('test-bar')

    expect(result.closing.month).toBe(SEED_MONTH)
    expect(result.statements.length).toBeGreaterThan(0)
    await expectRejectedBarErrorCode(
      repository.createMonthlyClosing({ month: SEED_MONTH, actorId: 'admin' }),
      'monthly-closing-already-exists',
    )
    expect(storage.values.get('test-bar')).toBe(bytes)
  })

  it('closes the monthly tabs of the closed month so late consumption is refused', async () => {
    const { repository } = createRepository()

    await repository.createMonthlyClosing({ month: SEED_MONTH, actorId: 'admin' })
    const monthlyTabs = (await repository.listTabs())
      .filter(({ kind }) => kind === TAB_KIND.MONTHLY)

    expect(monthlyTabs.map(({ id, status, closedAt }) => ({ id, status, closedAt })))
      .toEqual([
        { id: 'tab-ana-mensal', status: TAB_STATUS.CLOSED, closedAt: DEFAULT_NOW },
        { id: 'tab-bruno-mensal', status: TAB_STATUS.CLOSED, closedAt: DEFAULT_NOW },
        { id: 'tab-celia-mensal', status: TAB_STATUS.CLOSED, closedAt: DEFAULT_NOW },
      ])
    await expectRejectedBarErrorCode(repository.createConsumption({
      tabId: 'tab-ana-mensal', itemId: 'item-cerveja', quantity: 1,
      chargeKind: CHARGE_KIND.CHARGED, actorId: 'admin',
    }), 'tab-closed')
  })

  it('leaves monthly tabs from other months untouched by a closing', async () => {
    const { repository, storage } = createRepository()
    const database = createDemoDatabase()
    const index = database.tabs.findIndex(({ id }) => id === 'tab-celia-mensal')
    ;(database.tabs[index] as { month: string }).month = EARLIER_MONTH
    storage.values.set('test-bar', JSON.stringify({ version: 1, data: database }))

    await repository.createMonthlyClosing({ month: SEED_MONTH, actorId: 'admin' })

    const tabs = await repository.listTabs()
    expect(tabs.find(({ id }) => id === 'tab-celia-mensal')!.status).toBe(TAB_STATUS.OPEN)
    expect(tabs.find(({ id }) => id === 'tab-ana-mensal')!.status).toBe(TAB_STATUS.CLOSED)
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
