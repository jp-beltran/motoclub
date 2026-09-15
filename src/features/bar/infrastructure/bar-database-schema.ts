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

/**
 * Is this stored document still a `BarDatabase`?
 *
 * Extracted from `local-bar-repository.ts`, which had grown to answer three
 * questions in one file: how a bar operation runs, what a stored document
 * has to look like, and whether its rows still point at each other. Only
 * the first is the repository's job. These guards are the second and third,
 * and they have exactly two callers — `parseEnvelope` (reading) and
 * `update` (revalidating after every mutation).
 *
 * Nothing here enforces a *business* rule: that a payment cannot exceed the
 * balance lives in the domain. This file only answers whether the bytes on
 * disk can be read back as the shape the rest of the code already assumes,
 * which is why it is the one thing standing between a corrupted file and a
 * `TypeError` deep inside a money calculation.
 *
 * `hasValidRelationships` is the part with no SQL counterpart: the database
 * is a single JSON document in one `kv` row (see `server/storage/schema.ts`),
 * so there is no `FOREIGN KEY` to lean on — the schema's own
 * `PRAGMA foreign_keys = ON` protects nothing here, because there are no
 * foreign keys to protect. This function is the referential integrity, and
 * it is re-checked on every single write.
 */
export function isBarDatabase(value: unknown): value is BarDatabase {
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

export function isOneOf(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === 'string' && allowed.includes(value)
}

function hasUniqueIds(values: readonly { readonly id: string }[]): boolean {
  return new Set(values.map(({ id }) => id)).size === values.length
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
