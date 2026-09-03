import type {
  AddStockMovementInput,
  BarDatabase,
  BarDatabaseEnvelope,
  BarRepository,
  CancelConsumptionRepositoryInput,
  CreateConsumptionInput,
  CreateMonthlyClosingInput,
  CreateVisitorInput,
  EditConsumptionQuantityInput,
  EditConsumptionQuantityResult,
  EnsureEventTabInput,
  LocalBarRepositoryDependencies,
  ReassignConsumptionInput,
  RecordPaymentInput,
  SelectActiveEventInput,
} from '../application/bar-repository'
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
import { cancelConsumption, recordConsumption } from '../domain/consumption'
import { summarizeTabConsumptions } from '../domain/financials'
import { summarizePayments } from '../domain/payments'
import type {
  Consumption,
  Consumer,
  Event,
  EventTab,
  Item,
  MemberStatement,
  MonthlyClosing,
  Payment,
  StockMovement,
  Tab,
} from '../domain/entities'
import { assertPositiveCents } from '../domain/money'
import { consolidateMonth } from '../domain/monthly-closing'
import { createDemoDatabase } from './demo-seed'

const DEFAULT_STORAGE_KEY = 'motoclub:bar-database'
const INVALID_DATA_MESSAGE = 'Stored bar data is structurally invalid'
const INACTIVE_EVENT_MESSAGE = 'Event must be active'
const EXCESSIVE_PAYMENT_MESSAGE = 'Payment cannot exceed the amount due'
const MONTHLY_TAB_PAYMENT_MESSAGE =
  'Monthly tab debt must be paid through its member statement'

export type BarPersistenceErrorCode =
  | 'malformed-json'
  | 'unsupported-version'
  | 'invalid-data'

export class BarPersistenceError extends Error {
  readonly recoverable = true

  constructor(readonly code: BarPersistenceErrorCode, message: string) {
    super(message)
    this.name = 'BarPersistenceError'
  }
}

export class LocalBarRepository implements BarRepository {
  private readonly storageKey: string

  constructor(private readonly dependencies: LocalBarRepositoryDependencies) {
    this.storageKey = dependencies.storageKey ?? DEFAULT_STORAGE_KEY
  }

  async getSnapshot(): Promise<BarDatabase> {
    return clone(this.load(true))
  }

  async listConsumers(): Promise<Consumer[]> { return this.list('consumers') }
  async listItems(): Promise<Item[]> { return this.list('items') }
  async listEvents(): Promise<Event[]> { return this.list('events') }
  async listTabs(): Promise<Tab[]> { return this.list('tabs') }
  async listConsumptions(): Promise<Consumption[]> { return this.list('consumptions') }
  async listPayments(): Promise<Payment[]> { return this.list('payments') }
  async listStockMovements(): Promise<StockMovement[]> { return this.list('stockMovements') }
  async listMonthlyClosings(): Promise<MonthlyClosing[]> { return this.list('monthlyClosings') }
  async listMemberStatements(): Promise<MemberStatement[]> { return this.list('memberStatements') }

  async resetDemo(): Promise<BarDatabase> {
    const database = createDemoDatabase()
    this.save(database)
    return clone(database)
  }

  async createVisitor(input: CreateVisitorInput): Promise<Consumer> {
    return this.update((database) => {
      const name = input.name.trim()
      if (!name) throw new Error('Visitor name is required')
      const visitor: Consumer = {
        id: this.dependencies.nextId(),
        name,
        kind: CONSUMER_KIND.VISITOR,
        ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}),
        active: true,
      }
      database.consumers.push(visitor)
      return visitor
    })
  }

  async ensureEventTab(input: EnsureEventTabInput): Promise<EventTab> {
    return this.update((database) => {
      const event = findById(database.events, input.eventId, 'Event')
      assertActiveEvent(event)
      const visitor = findById(database.consumers, input.visitorId, 'Visitor')
      if (visitor.kind !== CONSUMER_KIND.VISITOR || visitor.active === false) {
        throw new Error('Consumer must be an active visitor')
      }
      const existingIndex = database.tabs.findIndex((tab) =>
        tab.kind === TAB_KIND.EVENT && tab.eventId === input.eventId &&
        tab.visitorId === input.visitorId,
      )
      const existing = database.tabs[existingIndex]
      if (existing?.kind === TAB_KIND.EVENT) {
        return existing
      }
      const tab: EventTab = {
        id: this.dependencies.nextId(), kind: TAB_KIND.EVENT, status: TAB_STATUS.OPEN,
        eventId: event.id, visitorId: visitor.id, openedAt: this.dependencies.now(),
      }
      database.tabs.push(tab)
      return tab
    })
  }

  async selectOrCreateActiveEvent(input: SelectActiveEventInput): Promise<Event> {
    return this.update((database) => {
      const active = database.events.find(({ status }) => status === EVENT_STATUS.ACTIVE)
      if (active) return active
      const name = input.name.trim()
      if (!name) throw new Error('Event name is required')
      const event: Event = {
        id: this.dependencies.nextId(), name,
        startsAt: input.startsAt ?? this.dependencies.now(), status: EVENT_STATUS.ACTIVE,
      }
      database.events.push(event)
      return event
    })
  }

  async createConsumption(input: CreateConsumptionInput) {
    return this.update((database) => this.recordConsumption(database, input))
  }

  async cancelConsumption(input: CancelConsumptionRepositoryInput) {
    return this.update((database) => this.cancelConsumptionInDatabase(database, input))
  }

  async editConsumptionQuantity(
    input: EditConsumptionQuantityInput,
  ): Promise<EditConsumptionQuantityResult> {
    return this.update((database) => {
      const current = findById(database.consumptions, input.consumptionId, 'Consumption')
      const cancellation = this.cancelConsumptionInDatabase(database, input)
      const replacementResult = this.recordConsumption(database, {
        tabId: current.tabId,
        itemId: current.itemId,
        quantity: input.quantity,
        chargeKind: current.chargeKind,
        actorId: input.actorId,
      })
      return {
        ...replacementResult,
        cancelledConsumption: cancellation.consumption,
        cancellationMovement: cancellation.stockMovement,
        replacement: replacementResult.consumption,
      }
    })
  }

  async reassignConsumption(input: ReassignConsumptionInput): Promise<Consumption> {
    return this.update((database) => {
      const consumptionIndex = findIndexById(database.consumptions, input.consumptionId, 'Consumption')
      const consumption = database.consumptions[consumptionIndex]
      if (consumption.status !== CONSUMPTION_STATUS.ACTIVE) {
        throw new Error('Only active consumption can be reassigned')
      }
      const sourceTab = findById(database.tabs, consumption.tabId, 'Source tab')
      const targetTab = findById(database.tabs, input.targetTabId, 'Target tab')
      if (targetTab.status !== TAB_STATUS.OPEN || targetTab.kind !== sourceTab.kind) {
        throw new Error('Target tab must be open and compatible')
      }
      const reassigned: Consumption = {
        ...consumption,
        tabId: targetTab.id,
        consumerId: targetTab.kind === TAB_KIND.MONTHLY
          ? targetTab.memberId : targetTab.visitorId,
      }
      database.consumptions[consumptionIndex] = reassigned
      return reassigned
    })
  }

  async closeVisitorTab(tabId: string): Promise<EventTab> {
    return this.setVisitorTabStatus(tabId, TAB_STATUS.CLOSED)
  }

  async reopenVisitorTab(tabId: string): Promise<EventTab> {
    return this.setVisitorTabStatus(tabId, TAB_STATUS.OPEN)
  }

  async recordPayment(input: RecordPaymentInput): Promise<Payment> {
    return this.update((database) => {
      assertPositiveCents(input.amountCents)
      const consumptions = resolvePaymentTargetConsumptions(database, input)
      if (input.amountCents > calculateRemainingCents(database, input, consumptions)) {
        throw new Error(EXCESSIVE_PAYMENT_MESSAGE)
      }
      const payment: Payment = {
        id: this.dependencies.nextId(), target: input.target, targetId: input.targetId,
        amountCents: input.amountCents, paidAt: this.dependencies.now(), actorId: input.actorId,
      }
      database.payments.push(payment)
      return payment
    })
  }

  async createMonthlyClosing(input: CreateMonthlyClosingInput) {
    return this.update((database) => {
      if (database.monthlyClosings.some(({ month }) => month === input.month)) {
        throw new Error('Monthly closing already exists')
      }
      const memberIds = database.consumers
        .filter(({ kind, active }) => kind === CONSUMER_KIND.MEMBER && active !== false)
        .map(({ id }) => id)
      const result = consolidateMonth({
        month: input.month, memberIds, consumptions: database.consumptions,
        actorId: input.actorId,
      }, this.dependencies)
      database.monthlyClosings.push(result.closing)
      database.memberStatements.push(...result.statements)
      this.closeMonthlyTabs(database, input.month)
      return result
    })
  }

  async addStockMovement(input: AddStockMovementInput): Promise<StockMovement> {
    return this.update((database) => {
      assertValidManualMovement(input)
      const itemIndex = findIndexById(database.items, input.itemId, 'Item')
      const item = database.items[itemIndex]
      if (item.stockQuantity === undefined) throw new Error('Item does not track stock')
      const stockQuantity = calculateStockQuantity(item.stockQuantity, input.quantityDelta)
      const movement: StockMovement = {
        id: this.dependencies.nextId(), itemId: item.id, kind: input.kind,
        quantityDelta: input.quantityDelta, occurredAt: this.dependencies.now(),
        actorId: input.actorId,
      }
      database.items[itemIndex] = { ...item, stockQuantity }
      database.stockMovements.push(movement)
      return movement
    })
  }

  private async setVisitorTabStatus(
    tabId: string,
    status: typeof TAB_STATUS.OPEN | typeof TAB_STATUS.CLOSED,
  ): Promise<EventTab> {
    return this.update((database) => {
      const index = findIndexById(database.tabs, tabId, 'Tab')
      const tab = database.tabs[index]
      if (tab.kind !== TAB_KIND.EVENT) throw new Error('Tab must belong to a visitor')
      assertActiveEventTab(database, tab)
      const updated: EventTab = status === TAB_STATUS.CLOSED
        ? { ...tab, status, closedAt: this.dependencies.now() }
        : { id: tab.id, kind: tab.kind, status, eventId: tab.eventId,
            visitorId: tab.visitorId, openedAt: tab.openedAt }
      database.tabs[index] = updated
      return updated
    })
  }

  private closeMonthlyTabs(database: BarDatabase, month: string): void {
    const closedAt = this.dependencies.now()
    database.tabs = database.tabs.map((tab) =>
      tab.kind === TAB_KIND.MONTHLY && tab.month === month &&
      tab.status === TAB_STATUS.OPEN
        ? { ...tab, status: TAB_STATUS.CLOSED, closedAt }
        : tab,
    )
  }

  private recordConsumption(database: BarDatabase, input: CreateConsumptionInput) {
    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
      throw new Error('Consumption quantity must be a positive safe integer')
    }
    const tab = findById(database.tabs, input.tabId, 'Tab')
    assertActiveEventTab(database, tab)
    const itemIndex = findIndexById(database.items, input.itemId, 'Item')
    const item = database.items[itemIndex]
    const result = recordConsumption({
      tab, item, quantity: input.quantity, chargeKind: input.chargeKind,
      actorId: input.actorId,
    }, this.dependencies)
    database.consumptions.push(result.consumption)
    if (result.stockMovement) {
      database.stockMovements.push(result.stockMovement)
      database.items[itemIndex] = {
        ...item,
        stockQuantity: calculateStockQuantity(
          item.stockQuantity!, result.stockMovement.quantityDelta,
        ),
      }
    }
    return result
  }

  private cancelConsumptionInDatabase(
    database: BarDatabase,
    input: CancelConsumptionRepositoryInput,
  ) {
    const index = findIndexById(database.consumptions, input.consumptionId, 'Consumption')
    const consumption = database.consumptions[index]
    const itemIndex = findIndexById(database.items, consumption.itemId, 'Item')
    const item = database.items[itemIndex]
    const originalStockMovement = database.stockMovements.find(({ kind, consumptionId }) =>
      kind === STOCK_MOVEMENT_KIND.CONSUMPTION && consumptionId === consumption.id,
    )
    if (item.stockQuantity !== undefined && !originalStockMovement) {
      throw new Error('Tracked consumption must have its original stock movement')
    }
    const result = cancelConsumption({
      consumption, item, originalStockMovement, actorId: input.actorId,
    }, this.dependencies)
    database.consumptions[index] = result.consumption
    if (result.stockMovement) {
      database.stockMovements.push(result.stockMovement)
      database.items[itemIndex] = {
        ...item,
        stockQuantity: calculateStockQuantity(
          item.stockQuantity!, result.stockMovement.quantityDelta,
        ),
      }
    }
    return result
  }

  private async list<Key extends keyof BarDatabase>(key: Key): Promise<BarDatabase[Key]> {
    return clone(this.load(true)[key])
  }

  private update<Result>(mutation: (database: BarDatabase) => Result): Promise<Result> {
    const database = clone(this.load(false))
    const result = mutation(database)
    if (!isBarDatabase(database)) throw new Error('Mutation produced invalid bar data')
    this.save(database)
    return Promise.resolve(clone(result))
  }

  private load(persistMissing: boolean): BarDatabase {
    const stored = this.dependencies.storage.getItem(this.storageKey)
    if (stored === null) {
      const database = createDemoDatabase()
      if (persistMissing) this.save(database)
      return database
    }
    return parseEnvelope(stored).data
  }

  private save(database: BarDatabase): void {
    const envelope: BarDatabaseEnvelope = { version: 1, data: database }
    this.dependencies.storage.setItem(this.storageKey, JSON.stringify(envelope))
  }
}

function parseEnvelope(bytes: string): BarDatabaseEnvelope {
  let value: unknown
  try {
    value = JSON.parse(bytes)
  } catch {
    throw new BarPersistenceError('malformed-json', 'Stored bar data is malformed JSON')
  }
  if (!isRecord(value) || value.version !== 1) {
    throw new BarPersistenceError('unsupported-version', 'Stored bar data uses an unsupported version')
  }
  if (!isBarDatabase(value.data)) {
    throw new BarPersistenceError('invalid-data', INVALID_DATA_MESSAGE)
  }
  return value as unknown as BarDatabaseEnvelope
}

function isBarDatabase(value: unknown): value is BarDatabase {
  if (!isRecord(value)) return false
  const keys: (keyof BarDatabase)[] = [
    'consumers', 'items', 'events', 'tabs', 'consumptions', 'payments',
    'stockMovements', 'monthlyClosings', 'memberStatements',
  ]
  if (!keys.every((key) => Array.isArray(value[key]))) return false
  const data = value as Record<keyof BarDatabase, unknown[]>
  const hasValidEntities = data.consumers.every(isConsumer) && data.items.every(isItem) &&
    data.events.every(isEvent) && data.tabs.every(isTab) &&
    data.consumptions.every(isConsumption) && data.payments.every(isPayment) &&
    data.stockMovements.every(isStockMovement) &&
    data.monthlyClosings.every(isMonthlyClosing) &&
    data.memberStatements.every(isMemberStatement)
  return hasValidEntities && hasValidRelationships(data as unknown as BarDatabase)
}

function hasValidRelationships(database: BarDatabase): boolean {
  const consumerById = new Map(database.consumers.map((entry) => [entry.id, entry]))
  const itemById = new Map(database.items.map((entry) => [entry.id, entry]))
  const eventIds = new Set(database.events.map(({ id }) => id))
  const tabById = new Map(database.tabs.map((entry) => [entry.id, entry]))
  const consumptionById = new Map(database.consumptions.map((entry) => [entry.id, entry]))
  const statementById = new Map(database.memberStatements.map((entry) => [entry.id, entry]))
  if (![database.consumers, database.items, database.events, database.tabs,
        database.consumptions, database.payments, database.stockMovements,
        database.monthlyClosings, database.memberStatements].every(hasUniqueIds)) return false
  const validTabs = database.tabs.every((tab) => tab.kind === TAB_KIND.EVENT
    ? eventIds.has(tab.eventId) && consumerById.get(tab.visitorId)?.kind === CONSUMER_KIND.VISITOR
    : consumerById.get(tab.memberId)?.kind === CONSUMER_KIND.MEMBER)
  const validConsumptions = database.consumptions.every((consumption) => {
    const tab = tabById.get(consumption.tabId)
    const expectedConsumerId = tab?.kind === TAB_KIND.EVENT ? tab.visitorId : tab?.memberId
    return itemById.has(consumption.itemId) && consumerById.has(consumption.consumerId) &&
      expectedConsumerId === consumption.consumerId
  })
  const validPayments = database.payments.every(({ target, targetId }) =>
    target === PAYMENT_TARGET.TAB ? tabById.has(targetId) : statementById.has(targetId))
  const validMovements = database.stockMovements.every((movement) => {
    const item = itemById.get(movement.itemId)
    if (!item) return false
    if (movement.kind !== STOCK_MOVEMENT_KIND.CONSUMPTION &&
        movement.kind !== STOCK_MOVEMENT_KIND.REVERSAL) return movement.consumptionId === undefined
    const consumption = movement.consumptionId
      ? consumptionById.get(movement.consumptionId) : undefined
    return item.stockQuantity !== undefined && consumption?.itemId === movement.itemId
  })
  const validStatements = database.memberStatements.every((statement) =>
    consumerById.get(statement.memberId)?.kind === CONSUMER_KIND.MEMBER &&
    statement.consumptions.every(({ consumerId }) => consumerId === statement.memberId))
  const validClosings = database.monthlyClosings.every((closing) =>
    closing.statementIds.every((id) => statementById.get(id)?.month === closing.month))
  return validTabs && validConsumptions && validPayments && validMovements &&
    validStatements && validClosings
}

function isConsumer(value: unknown): boolean {
  return hasStringIdAndName(value) && isRecord(value) &&
    isOneOf(value.kind, Object.values(CONSUMER_KIND)) &&
    isOptionalString(value.phone) && isOptionalBoolean(value.active)
}

function isItem(value: unknown): boolean {
  return hasStringIdAndName(value) && isRecord(value) && hasSafeCents(value) &&
    isOptionalString(value.code) && isOptionalString(value.category) &&
    isOptionalString(value.unit) && isOptionalString(value.description) &&
    isOptionalBoolean(value.active) && isOptionalBoolean(value.favorite) &&
    (value.stockQuantity === undefined || Number.isSafeInteger(value.stockQuantity))
}

function isEvent(value: unknown): boolean {
  return hasStringIdAndName(value) && isRecord(value) &&
    typeof value.startsAt === 'string' && isOptionalString(value.endsAt) &&
    (value.status === undefined || isOneOf(value.status, Object.values(EVENT_STATUS)))
}

function isTab(value: unknown): boolean {
  if (!hasStringId(value) || !isRecord(value) || typeof value.openedAt !== 'string' ||
      !isOneOf(value.status, Object.values(TAB_STATUS))) return false
  const hasValidLifecycle = value.status === TAB_STATUS.OPEN
    ? value.closedAt === undefined : typeof value.closedAt === 'string'
  if (!hasValidLifecycle) return false
  if (value.kind === TAB_KIND.EVENT) {
    return typeof value.eventId === 'string' && typeof value.visitorId === 'string'
  }
  return value.kind === TAB_KIND.MONTHLY && typeof value.memberId === 'string' &&
    typeof value.month === 'string'
}

function isConsumption(value: unknown): boolean {
  if (!hasStringId(value) || !isRecord(value)) return false
  const validBase = ['tabId', 'consumerId', 'itemId', 'createdAt', 'actorId']
    .every((key) => typeof value[key] === 'string') &&
    isOneOf(value.chargeKind, Object.values(CHARGE_KIND)) &&
    Number.isSafeInteger(value.quantity) && Number(value.quantity) > 0 &&
    hasSafeCents(value)
  if (!validBase) return false
  return value.status === CONSUMPTION_STATUS.ACTIVE
    ? value.cancelledAt === undefined && value.cancelledByActorId === undefined
    : value.status === CONSUMPTION_STATUS.CANCELLED &&
      typeof value.cancelledAt === 'string' && typeof value.cancelledByActorId === 'string'
}

function isPayment(value: unknown): boolean {
  return hasStringId(value) && isRecord(value) &&
    isOneOf(value.target, Object.values(PAYMENT_TARGET)) &&
    typeof value.targetId === 'string' && Number.isSafeInteger(value.amountCents) &&
    Number(value.amountCents) > 0 && typeof value.paidAt === 'string' &&
    typeof value.actorId === 'string'
}

function isStockMovement(value: unknown): boolean {
  return hasStringId(value) && isRecord(value) && typeof value.itemId === 'string' &&
    isOneOf(value.kind, Object.values(STOCK_MOVEMENT_KIND)) &&
    Number.isSafeInteger(value.quantityDelta) && typeof value.occurredAt === 'string' &&
    typeof value.actorId === 'string' && isOptionalString(value.consumptionId)
}

function isMonthlyClosing(value: unknown): boolean {
  return hasStringId(value) && isRecord(value) && typeof value.month === 'string' &&
    Array.isArray(value.statementIds) && value.statementIds.every(isString) &&
    typeof value.closedAt === 'string' && typeof value.actorId === 'string'
}

function isMemberStatement(value: unknown): boolean {
  return hasStringId(value) && isRecord(value) && typeof value.memberId === 'string' &&
    typeof value.month === 'string' && Array.isArray(value.consumptions) &&
    value.consumptions.every(isConsumption) && typeof value.createdAt === 'string'
}

function hasStringId(value: unknown): boolean {
  return isRecord(value) && typeof value.id === 'string'
}

function hasStringIdAndName(value: unknown): boolean {
  return hasStringId(value) && isRecord(value) && typeof value.name === 'string'
}

function hasSafeCents(value: unknown): boolean {
  return isRecord(value) && Number.isSafeInteger(value.unitCostCents) &&
    Number(value.unitCostCents) >= 0 && Number.isSafeInteger(value.unitPriceCents) &&
    Number(value.unitPriceCents) >= 0
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean'
}

function isString(value: unknown): value is string { return typeof value === 'string' }

function isOneOf(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === 'string' && allowed.includes(value)
}

function hasUniqueIds(values: readonly { readonly id: string }[]): boolean {
  return new Set(values.map(({ id }) => id)).size === values.length
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value
}

function findIndexById<Value extends { readonly id: string }>(
  values: readonly Value[], id: string, entity: string,
): number {
  const index = values.findIndex((value) => value.id === id)
  if (index < 0) throw new Error(`${entity} not found`)
  return index
}

function findById<Value extends { readonly id: string }>(
  values: readonly Value[], id: string, entity: string,
): Value {
  return values[findIndexById(values, id, entity)]
}

function assertActiveEvent(event: Event): void {
  if (event.status !== EVENT_STATUS.ACTIVE) throw new Error(INACTIVE_EVENT_MESSAGE)
}

function assertActiveEventTab(database: BarDatabase, tab: Tab): void {
  if (tab.kind !== TAB_KIND.EVENT) return
  assertActiveEvent(findById(database.events, tab.eventId, 'Event'))
}

function resolvePaymentTargetConsumptions(
  database: BarDatabase,
  input: RecordPaymentInput,
): readonly Consumption[] {
  if (input.target !== PAYMENT_TARGET.TAB) {
    return findById(database.memberStatements, input.targetId, 'Payment target').consumptions
  }
  const tab = findById(database.tabs, input.targetId, 'Payment target')
  if (tab.kind !== TAB_KIND.EVENT) throw new Error(MONTHLY_TAB_PAYMENT_MESSAGE)
  return database.consumptions.filter(({ tabId }) => tabId === tab.id)
}

function calculateRemainingCents(
  database: BarDatabase,
  input: RecordPaymentInput,
  consumptions: readonly Consumption[],
): number {
  const settledPayments = database.payments.filter(
    ({ target, targetId }) => target === input.target && targetId === input.targetId,
  )
  return summarizePayments(
    summarizeTabConsumptions(consumptions).totalCents,
    settledPayments,
  ).remainingCents
}

function assertValidManualMovement(input: AddStockMovementInput): void {
  if (!Number.isSafeInteger(input.quantityDelta) || input.quantityDelta === 0) {
    throw new Error('Stock movement quantity must be a non-zero safe integer')
  }
  if (input.kind === STOCK_MOVEMENT_KIND.ENTRY && input.quantityDelta < 0) {
    throw new Error('Stock entry quantity must be positive')
  }
}

function calculateStockQuantity(current: number, delta: number): number {
  const stockQuantity = current + delta
  if (!Number.isSafeInteger(stockQuantity)) {
    throw new Error('Stock quantity must be a safe integer')
  }
  return stockQuantity
}
