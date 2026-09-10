// server/main.ts
import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { dirname, join as join3 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// src/features/bar/domain/constants.ts
var CONSUMER_KIND = { MEMBER: "member", VISITOR: "visitor" };
var EVENT_STATUS = { ACTIVE: "active", CLOSED: "closed" };
var TAB_KIND = { EVENT: "event", MONTHLY: "monthly" };
var TAB_STATUS = { OPEN: "open", CLOSED: "closed" };
var CONSUMPTION_STATUS = { ACTIVE: "active", CANCELLED: "cancelled" };
var CHARGE_KIND = { CHARGED: "charged", COURTESY: "courtesy" };
var PAYMENT_TARGET = { TAB: "tab", STATEMENT: "statement" };
var PAYMENT_STATUS = {
  UNPAID: "unpaid",
  PARTIAL: "partial",
  PAID: "paid"
};
var STOCK_MOVEMENT_KIND = {
  ENTRY: "entry",
  CONSUMPTION: "consumption",
  REVERSAL: "reversal",
  ADJUSTMENT: "adjustment"
};
var STOCK_WARNING = { INSUFFICIENT: "insufficient-stock" };

// src/features/bar/domain/errors.ts
var BarError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "BarError";
  }
};
function isBarError(error) {
  return error instanceof BarError;
}

// src/features/bar/domain/money.ts
var INVALID_NON_NEGATIVE_CENTS_MESSAGE = "Money amounts must use non-negative safe integer cents";
var INVALID_POSITIVE_CENTS_MESSAGE = "Money amounts must use positive safe integer cents";
var UNSAFE_CENTS_TOTAL_MESSAGE = "Money total exceeds safe integer cents";
var UNSAFE_CENTS_PRODUCT_MESSAGE = "Money product exceeds safe integer cents";
function assertNonNegativeCents(amountCents) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new BarError("money-amount-invalid", INVALID_NON_NEGATIVE_CENTS_MESSAGE);
  }
}
function assertPositiveCents(amountCents) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new BarError("money-amount-not-positive", INVALID_POSITIVE_CENTS_MESSAGE);
  }
}
function addCents(leftCents, rightCents) {
  const totalCents = leftCents + rightCents;
  if (!Number.isSafeInteger(totalCents)) {
    throw new BarError("money-total-overflow", UNSAFE_CENTS_TOTAL_MESSAGE);
  }
  return totalCents;
}
function multiplyCents(amountCents, quantity) {
  const productCents = amountCents * quantity;
  if (!Number.isSafeInteger(productCents)) {
    throw new BarError("money-product-overflow", UNSAFE_CENTS_PRODUCT_MESSAGE);
  }
  return productCents;
}

// src/features/bar/domain/financials.ts
function getConsumptionLineTotalCents(consumption) {
  return multiplyCents(consumption.unitPriceCents, consumption.quantity);
}
function summarizeTabConsumptions(consumptions) {
  const activeConsumptions = consumptions.filter(
    ({ status }) => status === CONSUMPTION_STATUS.ACTIVE
  );
  const chargedConsumptions = activeConsumptions.filter(
    ({ chargeKind }) => chargeKind === CHARGE_KIND.CHARGED
  );
  return {
    totalCents: chargedConsumptions.reduce(
      (total, consumption) => addCents(total, getConsumptionLineTotalCents(consumption)),
      0
    ),
    courtesyConsumptions: activeConsumptions.filter(
      ({ chargeKind }) => chargeKind === CHARGE_KIND.COURTESY
    )
  };
}

// src/features/bar/domain/cancellation.ts
var CANCELLATION_BLOCK = {
  /** Already frozen into a `MemberStatement` by a monthly closing. */
  CONSOLIDATED: "consolidated",
  /** Its tab is closed, so the tab's total is settled history. */
  CLOSED_TAB: "closed-tab",
  /** Removing it would leave more money settled than the tab owes. */
  SETTLED_PAYMENT: "settled-payment"
};
var CANCELLATION_BLOCK_REASONS = {
  [CANCELLATION_BLOCK.CONSOLIDATED]: "Consumption is frozen in a member statement",
  [CANCELLATION_BLOCK.CLOSED_TAB]: "Consumption belongs to a closed tab",
  [CANCELLATION_BLOCK.SETTLED_PAYMENT]: "Consumption is covered by a settled payment"
};
var CANCELLATION_BLOCK_CODES = {
  [CANCELLATION_BLOCK.CONSOLIDATED]: "consumption-frozen-in-statement",
  [CANCELLATION_BLOCK.CLOSED_TAB]: "consumption-tab-closed",
  [CANCELLATION_BLOCK.SETTLED_PAYMENT]: "consumption-covered-by-payment"
};
function findCancellationBlock(context, consumptionId) {
  const consumption = context.consumptions.find(({ id }) => id === consumptionId);
  if (!consumption || consumption.status !== CONSUMPTION_STATUS.ACTIVE) return void 0;
  const isConsolidated = context.memberStatements.some(
    (statement) => statement.consumptions.some(({ id }) => id === consumption.id)
  );
  if (isConsolidated) return CANCELLATION_BLOCK.CONSOLIDATED;
  const tab = context.tabs.find(({ id }) => id === consumption.tabId);
  if (tab?.status === TAB_STATUS.CLOSED) return CANCELLATION_BLOCK.CLOSED_TAB;
  const dueAfterCents = summarizeTabConsumptions(
    context.consumptions.filter(
      ({ id, tabId }) => tabId === consumption.tabId && id !== consumption.id
    )
  ).totalCents;
  const settledCents = context.payments.filter(
    ({ target, targetId }) => target === PAYMENT_TARGET.TAB && targetId === consumption.tabId
  ).reduce((total, { amountCents }) => addCents(total, amountCents), 0);
  return settledCents > dueAfterCents ? CANCELLATION_BLOCK.SETTLED_PAYMENT : void 0;
}

// src/features/bar/domain/quantity.ts
var INVALID_QUANTITY_MESSAGE = "Quantity must be a positive integer";
function assertPositiveIntegerQuantity(quantity) {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new BarError("quantity-invalid", INVALID_QUANTITY_MESSAGE);
  }
}

// src/features/bar/domain/consumption.ts
var CLOSED_TAB_MESSAGE = "Cannot add consumption to a closed tab";
var INACTIVE_CONSUMPTION_MESSAGE = "Only active consumption can be cancelled";
var CONSUMPTION_ITEM_MISMATCH_MESSAGE = "Consumption and item must match";
var STOCK_MOVEMENT_MISMATCH_MESSAGE = "Original stock movement must match the consumption and item";
function recordConsumption(input, dependencies) {
  if (input.tab.status === TAB_STATUS.CLOSED) {
    throw new BarError("tab-closed", CLOSED_TAB_MESSAGE);
  }
  assertPositiveIntegerQuantity(input.quantity);
  assertNonNegativeCents(input.item.unitPriceCents);
  assertNonNegativeCents(input.item.unitCostCents);
  multiplyCents(input.item.unitPriceCents, input.quantity);
  multiplyCents(input.item.unitCostCents, input.quantity);
  const consumption = createConsumption(input, dependencies);
  if (input.item.stockQuantity === void 0) {
    return { consumption, warnings: [] };
  }
  return {
    consumption,
    stockMovement: createStockMovement(input, consumption, dependencies),
    warnings: input.quantity > input.item.stockQuantity ? [STOCK_WARNING.INSUFFICIENT] : []
  };
}
function createConsumption(input, dependencies) {
  return {
    id: dependencies.nextId(),
    tabId: input.tab.id,
    consumerId: input.tab.kind === TAB_KIND.MONTHLY ? input.tab.memberId : input.tab.visitorId,
    itemId: input.item.id,
    status: CONSUMPTION_STATUS.ACTIVE,
    chargeKind: input.chargeKind,
    quantity: input.quantity,
    unitPriceCents: input.item.unitPriceCents,
    unitCostCents: input.item.unitCostCents,
    createdAt: dependencies.now(),
    actorId: input.actorId
  };
}
function createStockMovement(input, consumption, dependencies) {
  return {
    id: dependencies.nextId(),
    itemId: input.item.id,
    kind: STOCK_MOVEMENT_KIND.CONSUMPTION,
    quantityDelta: -input.quantity,
    occurredAt: consumption.createdAt,
    actorId: input.actorId,
    consumptionId: consumption.id
  };
}
function cancelConsumption(input, dependencies) {
  assertValidCancellation(input);
  const cancelledAt = dependencies.now();
  const consumption = {
    ...input.consumption,
    status: CONSUMPTION_STATUS.CANCELLED,
    cancelledAt,
    cancelledByActorId: input.actorId
  };
  if (input.originalStockMovement === void 0) return { consumption };
  return {
    consumption,
    stockMovement: {
      id: dependencies.nextId(),
      itemId: input.item.id,
      kind: STOCK_MOVEMENT_KIND.REVERSAL,
      quantityDelta: -input.originalStockMovement.quantityDelta,
      occurredAt: cancelledAt,
      actorId: input.actorId,
      consumptionId: input.consumption.id
    }
  };
}
function assertValidCancellation(input) {
  if (input.consumption.status !== CONSUMPTION_STATUS.ACTIVE) {
    throw new BarError("consumption-already-cancelled", INACTIVE_CONSUMPTION_MESSAGE);
  }
  if (input.consumption.itemId !== input.item.id) {
    throw new BarError("consumption-item-mismatch", CONSUMPTION_ITEM_MISMATCH_MESSAGE);
  }
  if (input.originalStockMovement === void 0) return;
  if (input.originalStockMovement.kind !== STOCK_MOVEMENT_KIND.CONSUMPTION || input.originalStockMovement.consumptionId !== input.consumption.id || input.originalStockMovement.itemId !== input.item.id || input.originalStockMovement.quantityDelta !== -input.consumption.quantity) {
    throw new BarError("stock-movement-mismatch", STOCK_MOVEMENT_MISMATCH_MESSAGE);
  }
}

// src/features/bar/domain/payments.ts
function summarizePayments(amountDueCents, payments) {
  assertNonNegativeCents(amountDueCents);
  payments.forEach(({ amountCents }) => assertPositiveCents(amountCents));
  const paidCents = payments.reduce(
    (total, currentPayment) => addCents(total, currentPayment.amountCents),
    0
  );
  const remainingCents = Math.max(amountDueCents - paidCents, 0);
  const status = getPaymentStatus(amountDueCents, paidCents);
  return { paidCents, remainingCents, status };
}
function getPaymentStatus(amountDueCents, paidCents) {
  if (paidCents === 0) return PAYMENT_STATUS.UNPAID;
  if (paidCents < amountDueCents) return PAYMENT_STATUS.PARTIAL;
  return PAYMENT_STATUS.PAID;
}

// src/features/bar/domain/month.ts
var INVALID_TIMESTAMP_MESSAGE = "Timestamp must be a parseable date";
function getMonthKey(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new BarError("timestamp-invalid", INVALID_TIMESTAMP_MESSAGE);
  }
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}`;
}
function pad(value, length) {
  return String(value).padStart(length, "0");
}

// src/features/bar/domain/monthly-closing.ts
var MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
var INVALID_MONTH_MESSAGE = "Month must use YYYY-MM format";
function consolidateMonth(input, dependencies) {
  if (!MONTH_PATTERN.test(input.month)) {
    throw new BarError("month-format-invalid", INVALID_MONTH_MESSAGE);
  }
  const createdAt = dependencies.now();
  const statements = input.memberIds.flatMap((memberId) => {
    const consumptions = input.consumptions.filter(
      (consumption) => consumption.consumerId === memberId && getMonthKey(consumption.createdAt) === input.month
    ).map((consumption) => Object.freeze({ ...consumption }));
    if (consumptions.length === 0) return [];
    return [{
      id: dependencies.nextId(),
      memberId,
      month: input.month,
      consumptions: Object.freeze(consumptions),
      createdAt
    }];
  });
  const closing = {
    id: dependencies.nextId(),
    month: input.month,
    statementIds: statements.map(({ id }) => id),
    closedAt: createdAt,
    actorId: input.actorId
  };
  return { closing, statements };
}

// src/shared/date.ts
var MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "mar\xE7o",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro"
];
function getCurrentMonth(now = /* @__PURE__ */ new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
function formatMonthName(month) {
  return MONTH_NAMES[Number(month.split("-")[1]) - 1];
}

// src/features/bar/infrastructure/demo-seed.ts
function createDemoDatabase(now = /* @__PURE__ */ new Date()) {
  const month = getCurrentMonth(now);
  const at = createSeedClock(now);
  const monthOpened = at(MONTH_START, 9);
  const stockEntry = at(MONTH_START, 10);
  const pastEventStart = at(14, 18);
  const pastEventEnd = at(13, 2);
  const anaConsumption = at(7, 20);
  const brunoConsumption = at(4, 20);
  const eventStart = at(1, 18);
  const rafaelTabOpened = at(1, 18, 10);
  const julianaTabOpened = at(1, 18, 20);
  const rafaelConsumption = at(1, 19);
  const julianaConsumption = at(1, 19, 10);
  const rafaelPayment = at(1, 21);
  return {
    consumers: [
      { id: "member-ana", name: "Ana Paula", kind: CONSUMER_KIND.MEMBER, phone: "(11) 98888-1001", active: true },
      { id: "member-bruno", name: "Bruno Santos", kind: CONSUMER_KIND.MEMBER, phone: "(11) 97777-2002", active: true },
      { id: "member-celia", name: "C\xE9lia Martins", kind: CONSUMER_KIND.MEMBER, active: true },
      { id: "visitor-rafael", name: "Rafael Oliveira", kind: CONSUMER_KIND.VISITOR, phone: "(11) 96666-3003", active: true },
      { id: "visitor-juliana", name: "Juliana Costa", kind: CONSUMER_KIND.VISITOR, active: true }
    ],
    items: [
      { id: "item-cerveja", code: "BEV-001", name: "Cerveja lata", category: "Bebidas", unit: "lata", description: "Cerveja pilsen 350 ml", active: true, favorite: true, unitCostCents: 350, unitPriceCents: 700, stockQuantity: 42 },
      { id: "item-agua", code: "BEV-002", name: "\xC1gua mineral", category: "Bebidas", unit: "garrafa", description: "Sem g\xE1s 500 ml", active: true, favorite: true, unitCostCents: 150, unitPriceCents: 400, stockQuantity: 28 },
      { id: "item-refrigerante", code: "BEV-003", name: "Refrigerante", category: "Bebidas", unit: "lata", active: true, favorite: true, unitCostCents: 280, unitPriceCents: 600, stockQuantity: 24 },
      { id: "item-espetinho", code: "FOO-001", name: "Espetinho", category: "Comidas", unit: "unidade", active: true, favorite: true, unitCostCents: 500, unitPriceCents: 1200, stockQuantity: 15 },
      { id: "item-porcao", code: "FOO-002", name: "Por\xE7\xE3o de fritas", category: "Comidas", unit: "por\xE7\xE3o", active: true, favorite: false, unitCostCents: 900, unitPriceCents: 2200 },
      { id: "item-camiseta", code: "CLB-001", name: "Camiseta do motoclube", category: "Clube", unit: "unidade", active: true, favorite: false, unitCostCents: 3e3, unitPriceCents: 5e3, stockQuantity: 8 }
    ],
    events: [
      { id: "event-encontro", name: `Encontro de ${formatMonthName(month)}`, startsAt: eventStart, status: EVENT_STATUS.ACTIVE },
      { id: "event-aniversario", name: "Anivers\xE1rio do motoclube", startsAt: pastEventStart, endsAt: pastEventEnd, status: EVENT_STATUS.CLOSED }
    ],
    tabs: [
      { id: "tab-ana-mensal", kind: TAB_KIND.MONTHLY, status: TAB_STATUS.OPEN, memberId: "member-ana", month, openedAt: monthOpened },
      { id: "tab-bruno-mensal", kind: TAB_KIND.MONTHLY, status: TAB_STATUS.OPEN, memberId: "member-bruno", month, openedAt: monthOpened },
      { id: "tab-celia-mensal", kind: TAB_KIND.MONTHLY, status: TAB_STATUS.OPEN, memberId: "member-celia", month, openedAt: monthOpened },
      { id: "tab-rafael-evento", kind: TAB_KIND.EVENT, status: TAB_STATUS.OPEN, eventId: "event-encontro", visitorId: "visitor-rafael", openedAt: rafaelTabOpened },
      { id: "tab-juliana-evento", kind: TAB_KIND.EVENT, status: TAB_STATUS.OPEN, eventId: "event-encontro", visitorId: "visitor-juliana", openedAt: julianaTabOpened }
    ],
    consumptions: [
      { id: "cons-ana-cerveja", tabId: "tab-ana-mensal", consumerId: "member-ana", itemId: "item-cerveja", status: CONSUMPTION_STATUS.ACTIVE, chargeKind: CHARGE_KIND.CHARGED, quantity: 3, unitPriceCents: 700, unitCostCents: 350, createdAt: anaConsumption, actorId: "admin-demo" },
      { id: "cons-bruno-espetinho", tabId: "tab-bruno-mensal", consumerId: "member-bruno", itemId: "item-espetinho", status: CONSUMPTION_STATUS.ACTIVE, chargeKind: CHARGE_KIND.CHARGED, quantity: 2, unitPriceCents: 1200, unitCostCents: 500, createdAt: brunoConsumption, actorId: "admin-demo" },
      { id: "cons-rafael-refri", tabId: "tab-rafael-evento", consumerId: "visitor-rafael", itemId: "item-refrigerante", status: CONSUMPTION_STATUS.ACTIVE, chargeKind: CHARGE_KIND.CHARGED, quantity: 2, unitPriceCents: 600, unitCostCents: 280, createdAt: rafaelConsumption, actorId: "admin-demo" },
      { id: "cons-juliana-agua", tabId: "tab-juliana-evento", consumerId: "visitor-juliana", itemId: "item-agua", status: CONSUMPTION_STATUS.ACTIVE, chargeKind: CHARGE_KIND.COURTESY, quantity: 1, unitPriceCents: 400, unitCostCents: 150, createdAt: julianaConsumption, actorId: "admin-demo" }
    ],
    payments: [
      { id: "payment-rafael", target: PAYMENT_TARGET.TAB, targetId: "tab-rafael-evento", amountCents: 700, paidAt: rafaelPayment, actorId: "admin-demo" }
    ],
    stockMovements: [
      { id: "movement-entry-cerveja", itemId: "item-cerveja", kind: STOCK_MOVEMENT_KIND.ENTRY, quantityDelta: 45, occurredAt: stockEntry, actorId: "admin-demo" },
      { id: "movement-ana-cerveja", itemId: "item-cerveja", kind: STOCK_MOVEMENT_KIND.CONSUMPTION, quantityDelta: -3, occurredAt: anaConsumption, actorId: "admin-demo", consumptionId: "cons-ana-cerveja" },
      { id: "movement-bruno-espetinho", itemId: "item-espetinho", kind: STOCK_MOVEMENT_KIND.CONSUMPTION, quantityDelta: -2, occurredAt: brunoConsumption, actorId: "admin-demo", consumptionId: "cons-bruno-espetinho" },
      { id: "movement-rafael-refri", itemId: "item-refrigerante", kind: STOCK_MOVEMENT_KIND.CONSUMPTION, quantityDelta: -2, occurredAt: rafaelConsumption, actorId: "admin-demo", consumptionId: "cons-rafael-refri" },
      { id: "movement-juliana-agua", itemId: "item-agua", kind: STOCK_MOVEMENT_KIND.CONSUMPTION, quantityDelta: -1, occurredAt: julianaConsumption, actorId: "admin-demo", consumptionId: "cons-juliana-agua" }
    ],
    monthlyClosings: [],
    memberStatements: []
  };
}
var MONTH_START = 40;
function createSeedClock(now) {
  const year = now.getFullYear();
  const monthIndex = now.getMonth();
  const today = now.getDate();
  return (daysBeforeToday, hour, minute = 0) => {
    const day = Math.max(1, today - daysBeforeToday);
    const moment = new Date(year, monthIndex, day, hour, minute, 0, 0);
    return (moment > now ? now : moment).toISOString();
  };
}

// src/features/bar/infrastructure/local-bar-repository.ts
var DEFAULT_STORAGE_KEY = "motoclub:bar-database";
var INVALID_DATA_MESSAGE = "Stored bar data is structurally invalid";
var INACTIVE_EVENT_MESSAGE = "Event must be active";
var EXCESSIVE_PAYMENT_MESSAGE = "Payment cannot exceed the amount due";
var MONTHLY_TAB_PAYMENT_MESSAGE = "Monthly tab debt must be paid through its member statement";
var INVALID_MONTH_MESSAGE2 = "Month must use the YYYY-MM format";
var INACTIVE_MEMBER_MESSAGE = "Consumer must be an active member";
var MISMATCHED_MONTH_MESSAGE = "Monthly tab month must match the current month";
var MONTH_PATTERN2 = /^\d{4}-(?:0[1-9]|1[0-2])$/;
var BarPersistenceError = class extends BarError {
  recoverable = true;
  constructor(code, message) {
    super(code, message);
    this.name = "BarPersistenceError";
  }
};
var LocalBarRepository = class {
  constructor(dependencies) {
    this.dependencies = dependencies;
    this.storageKey = dependencies.storageKey ?? DEFAULT_STORAGE_KEY;
  }
  storageKey;
  async getSnapshot() {
    return clone(this.load(true));
  }
  async listConsumers() {
    return this.list("consumers");
  }
  async listItems() {
    return this.list("items");
  }
  async listEvents() {
    return this.list("events");
  }
  async listTabs() {
    return this.list("tabs");
  }
  async listConsumptions() {
    return this.list("consumptions");
  }
  async listPayments() {
    return this.list("payments");
  }
  async listStockMovements() {
    return this.list("stockMovements");
  }
  async listMonthlyClosings() {
    return this.list("monthlyClosings");
  }
  async listMemberStatements() {
    return this.list("memberStatements");
  }
  async resetDemo() {
    const database = createDemoDatabase();
    this.save(database);
    return clone(database);
  }
  async createVisitor(input) {
    return this.update((database) => {
      const name = input.name.trim();
      if (!name) throw new BarError("visitor-name-required", "Visitor name is required");
      const visitor = {
        id: this.dependencies.nextId(),
        name,
        kind: CONSUMER_KIND.VISITOR,
        ...input.phone?.trim() ? { phone: input.phone.trim() } : {},
        active: true
      };
      database.consumers.push(visitor);
      return visitor;
    });
  }
  async ensureEventTab(input) {
    return this.update((database) => {
      const event = findById(database.events, input.eventId, "event-not-found", "Event");
      assertActiveEvent(event);
      const visitor = findById(
        database.consumers,
        input.visitorId,
        "consumer-not-found",
        "Visitor"
      );
      if (visitor.kind !== CONSUMER_KIND.VISITOR || visitor.active === false) {
        throw new BarError("consumer-not-active-visitor", "Consumer must be an active visitor");
      }
      const existingIndex = database.tabs.findIndex(
        (tab2) => tab2.kind === TAB_KIND.EVENT && tab2.eventId === input.eventId && tab2.visitorId === input.visitorId
      );
      const existing = database.tabs[existingIndex];
      if (existing?.kind === TAB_KIND.EVENT) {
        return existing;
      }
      const tab = {
        id: this.dependencies.nextId(),
        kind: TAB_KIND.EVENT,
        status: TAB_STATUS.OPEN,
        eventId: event.id,
        visitorId: visitor.id,
        openedAt: this.dependencies.now()
      };
      database.tabs.push(tab);
      return tab;
    });
  }
  /**
   * Mirrors ensureEventTab: an existing monthly tab is returned as it is, so a
   * tab closed by a monthly closing stays closed and late consumption is
   * refused downstream instead of silently reopening the month.
   *
   * A created tab is stamped with `getMonthKey(now())` — the very function
   * `consolidateMonth` uses to attribute a consumption to a month — because a
   * closing closes tabs by `tab.month` but consolidates consumption by that
   * key. Deriving both from one function makes it structurally impossible for
   * a consumption to land in one month while its tab is stamped with another.
   * Ensuring a month other than the write-time month can therefore only read
   * an existing tab, never open one.
   */
  async ensureMonthlyTab(input) {
    return this.update((database) => {
      if (!MONTH_PATTERN2.test(input.month)) {
        throw new BarError("month-format-invalid", INVALID_MONTH_MESSAGE2);
      }
      const member = findById(
        database.consumers,
        input.memberId,
        "consumer-not-found",
        "Member"
      );
      if (member.kind !== CONSUMER_KIND.MEMBER || member.active === false) {
        throw new BarError("consumer-not-active-member", INACTIVE_MEMBER_MESSAGE);
      }
      const existing = database.tabs.find(
        (tab2) => tab2.kind === TAB_KIND.MONTHLY && tab2.memberId === member.id && tab2.month === input.month
      );
      if (existing?.kind === TAB_KIND.MONTHLY) {
        return existing;
      }
      const openedAt = this.dependencies.now();
      const month = getMonthKey(openedAt);
      if (month !== input.month) {
        throw new BarError("monthly-tab-month-mismatch", MISMATCHED_MONTH_MESSAGE);
      }
      const tab = {
        id: this.dependencies.nextId(),
        kind: TAB_KIND.MONTHLY,
        status: TAB_STATUS.OPEN,
        memberId: member.id,
        month,
        openedAt
      };
      database.tabs.push(tab);
      return tab;
    });
  }
  async selectOrCreateActiveEvent(input) {
    return this.update((database) => {
      const active = database.events.find(({ status }) => status === EVENT_STATUS.ACTIVE);
      if (active) return active;
      const name = input.name.trim();
      if (!name) throw new BarError("event-name-required", "Event name is required");
      const event = {
        id: this.dependencies.nextId(),
        name,
        startsAt: input.startsAt ?? this.dependencies.now(),
        status: EVENT_STATUS.ACTIVE
      };
      database.events.push(event);
      return event;
    });
  }
  /**
   * The guard lives here and not in the private `recordConsumption`
   * deliberately: this is where a *new* charge is created, and a
   * deactivated consumer takes no new charge.
   *
   * The two correction paths are left alone on purpose, because neither
   * creates money — they move or restate a line that already exists, and
   * blocking them would leave a mistake uncorrectable the moment someone is
   * deactivated:
   *   - `editConsumptionQuantity` also goes through `recordConsumption`,
   *     but only to replace a line with the quantity it should have had;
   *   - `reassignConsumption` can still move a line onto a deactivated
   *     member's open tab, because attributing a consumption to whoever
   *     actually drank it is a correction, not a new charge.
   */
  async createConsumption(input) {
    return this.update((database) => {
      assertActiveTabConsumer(
        database,
        findById(database.tabs, input.tabId, "tab-not-found", "Tab")
      );
      return this.recordConsumption(database, input);
    });
  }
  async cancelConsumption(input) {
    return this.update((database) => this.cancelConsumptionInDatabase(database, input));
  }
  async editConsumptionQuantity(input) {
    return this.update((database) => {
      const current = findById(
        database.consumptions,
        input.consumptionId,
        "consumption-not-found",
        "Consumption"
      );
      const cancellation = this.cancelConsumptionInDatabase(database, input);
      const replacementResult = this.recordConsumption(database, {
        tabId: current.tabId,
        itemId: current.itemId,
        quantity: input.quantity,
        chargeKind: current.chargeKind,
        actorId: input.actorId
      });
      return {
        ...replacementResult,
        cancelledConsumption: cancellation.consumption,
        cancellationMovement: cancellation.stockMovement,
        replacement: replacementResult.consumption
      };
    });
  }
  async reassignConsumption(input) {
    return this.update((database) => {
      const consumptionIndex = findIndexById(
        database.consumptions,
        input.consumptionId,
        "consumption-not-found",
        "Consumption"
      );
      const consumption = database.consumptions[consumptionIndex];
      if (consumption.status !== CONSUMPTION_STATUS.ACTIVE) {
        throw new BarError(
          "consumption-not-reassignable",
          "Only active consumption can be reassigned"
        );
      }
      const sourceTab = findById(database.tabs, consumption.tabId, "tab-not-found", "Source tab");
      const targetTab = findById(database.tabs, input.targetTabId, "tab-not-found", "Target tab");
      if (targetTab.status !== TAB_STATUS.OPEN || targetTab.kind !== sourceTab.kind) {
        throw new BarError(
          "reassign-target-tab-invalid",
          "Target tab must be open and compatible"
        );
      }
      const reassigned = {
        ...consumption,
        tabId: targetTab.id,
        consumerId: targetTab.kind === TAB_KIND.MONTHLY ? targetTab.memberId : targetTab.visitorId
      };
      database.consumptions[consumptionIndex] = reassigned;
      return reassigned;
    });
  }
  async closeVisitorTab(tabId) {
    return this.setVisitorTabStatus(tabId, TAB_STATUS.CLOSED);
  }
  async reopenVisitorTab(tabId) {
    return this.setVisitorTabStatus(tabId, TAB_STATUS.OPEN);
  }
  async recordPayment(input) {
    return this.update((database) => {
      assertPositiveCents(input.amountCents);
      const consumptions = resolvePaymentTargetConsumptions(database, input);
      if (input.amountCents > calculateRemainingCents(database, input, consumptions)) {
        throw new BarError("payment-exceeds-balance", EXCESSIVE_PAYMENT_MESSAGE);
      }
      const payment = {
        id: this.dependencies.nextId(),
        target: input.target,
        targetId: input.targetId,
        amountCents: input.amountCents,
        paidAt: this.dependencies.now(),
        actorId: input.actorId
      };
      database.payments.push(payment);
      return payment;
    });
  }
  async createMonthlyClosing(input) {
    return this.update((database) => {
      if (database.monthlyClosings.some(({ month }) => month === input.month)) {
        throw new BarError("monthly-closing-already-exists", "Monthly closing already exists");
      }
      const memberIds = database.consumers.filter(({ kind }) => kind === CONSUMER_KIND.MEMBER).map(({ id }) => id);
      const result = consolidateMonth({
        month: input.month,
        memberIds,
        consumptions: database.consumptions,
        actorId: input.actorId
      }, this.dependencies);
      database.monthlyClosings.push(result.closing);
      database.memberStatements.push(...result.statements);
      this.closeMonthlyTabs(database, input.month);
      return result;
    });
  }
  async addStockMovement(input) {
    return this.update((database) => {
      assertValidManualMovement(input);
      const itemIndex = findIndexById(database.items, input.itemId, "item-not-found", "Item");
      const item = database.items[itemIndex];
      if (item.stockQuantity === void 0) {
        throw new BarError("item-stock-not-tracked", "Item does not track stock");
      }
      const stockQuantity = calculateStockQuantity(item.stockQuantity, input.quantityDelta);
      const movement = {
        id: this.dependencies.nextId(),
        itemId: item.id,
        kind: input.kind,
        quantityDelta: input.quantityDelta,
        occurredAt: this.dependencies.now(),
        actorId: input.actorId
      };
      database.items[itemIndex] = { ...item, stockQuantity };
      database.stockMovements.push(movement);
      return movement;
    });
  }
  /**
   * Registers a member **or** a visitor, with the kind given explicitly —
   * the capability the model always had (`Consumer.kind`) and the system
   * never exposed. Same `update()` transaction as every other write, so a
   * refusal saves nothing; same shape `createVisitor` produces, so the two
   * paths cannot store two different kinds of visitor row.
   */
  async createConsumer(input) {
    return this.update((database) => {
      const name = assertConsumerName(input.name);
      const kind = assertConsumerKind(input.kind);
      if (kind === CONSUMER_KIND.MEMBER) assertMemberNameAvailable(database, name);
      const consumer = {
        id: this.dependencies.nextId(),
        name,
        kind,
        ...input.phone?.trim() ? { phone: input.phone.trim() } : {},
        active: true
      };
      database.consumers.push(consumer);
      return consumer;
    });
  }
  /** Fixes a mistyped name or phone. Nothing else about a consumer moves. */
  async updateConsumer(input) {
    return this.update((database) => {
      const index = findIndexById(
        database.consumers,
        input.id,
        "consumer-not-found",
        "Consumer"
      );
      const current = database.consumers[index];
      const name = input.name === void 0 ? current.name : assertConsumerName(input.name);
      if (current.kind === CONSUMER_KIND.MEMBER && normalizeConsumerName(name) !== normalizeConsumerName(current.name)) {
        assertMemberNameAvailable(database, name, current.id);
      }
      const phone = input.phone === void 0 ? current.phone : input.phone.trim() || void 0;
      const updated = withConsumerContact(current, name, phone);
      database.consumers[index] = updated;
      return updated;
    });
  }
  /**
   * Registers a catalogue item. Same shape as `createVisitor`: validate the
   * caller's fields, build the entity, push it, and let `update`'s
   * clone → mutate → revalidate → save cycle refuse anything that would
   * leave the database inconsistent.
   *
   * Sem `stockQuantity`, o item nasce sem controle de estoque e lê como
   * "Estoque não controlado" em vez de alegar um zero que ninguém contou.
   * COM `stockQuantity`, ele nasce controlado nessa contagem de abertura e
   * já aparece em `/estoque` aceitando movimento — antes disso, um item
   * cadastrado pela tela nunca conseguia ter estoque, porque
   * `getTrackedItems` filtra por esse campo e `addStockMovement` recusava
   * com `item-stock-not-tracked`.
   */
  async createItem(input) {
    return this.update((database) => {
      const item = {
        id: this.dependencies.nextId(),
        name: readItemName(input.name),
        ...optionalText("code", input.code),
        ...optionalText("category", input.category),
        ...optionalText("unit", input.unit),
        active: true,
        favorite: input.favorite ?? false,
        // `?? {}` e não `stockQuantity: undefined`: a diferença entre "o
        // campo não existe" e "existe valendo undefined" é exatamente o que
        // `getTrackedItems` lê para decidir se o item tem controle de estoque.
        ...input.stockQuantity === void 0 ? {} : { stockQuantity: readItemStockQuantity(input.stockQuantity) },
        unitCostCents: readItemCostCents(input.unitCostCents),
        unitPriceCents: readItemPriceCents(input.unitPriceCents)
      };
      database.items.push(item);
      return item;
    });
  }
  /**
   * Rewrites the item, never its history. Changing the price replaces
   * `items[i].unitPriceCents` and nothing else: past consumption keeps the
   * `unitPriceCents` it copied at the moment of sale, so no already-recorded
   * money moves. `item-price-history.test.ts` is the test that keeps this
   * true.
   */
  async updateItem(input) {
    return this.update((database) => {
      const index = findIndexById(database.items, input.id, "item-not-found", "Item");
      const current = database.items[index];
      const updated = normalizeOptionalText({
        ...current,
        ...input.name === void 0 ? {} : { name: readItemName(input.name) },
        ...input.code === void 0 ? {} : { code: input.code },
        ...input.category === void 0 ? {} : { category: input.category },
        ...input.unit === void 0 ? {} : { unit: input.unit },
        ...input.favorite === void 0 ? {} : { favorite: input.favorite },
        ...input.unitCostCents === void 0 ? {} : { unitCostCents: readItemCostCents(input.unitCostCents) },
        ...input.unitPriceCents === void 0 ? {} : { unitPriceCents: readItemPriceCents(input.unitPriceCents) }
      });
      database.items[index] = updated;
      return updated;
    });
  }
  /**
   * Deactivating an integrante who still owes money is allowed — the user's
   * ruling — so this writes one boolean and touches nothing else: no
   * consumption is cancelled, no tab is closed, no statement is dropped.
   * What stops is new consumption (`assertActiveTabConsumer`) and, for a
   * visitor, opening a new event tab (`ensureEventTab`).
   */
  async setConsumerActive(input) {
    return this.update((database) => {
      const index = findIndexById(
        database.consumers,
        input.id,
        "consumer-not-found",
        "Consumer"
      );
      const updated = { ...database.consumers[index], active: input.active };
      database.consumers[index] = updated;
      return updated;
    });
  }
  /**
   * Retiring an item is a flag, never a deletion: `/lancamentos` hides an
   * inactive item (`LaunchScreen` filters `active !== false`) while every
   * consumption that already names it stays exactly where it is, in the
   * history and in the month's totals. Deleting the row instead would break
   * `hasValidRelationships`, which is the structural reason this is a flag.
   */
  async setItemActive(input) {
    return this.update((database) => {
      const index = findIndexById(database.items, input.id, "item-not-found", "Item");
      const updated = { ...database.items[index], active: input.active };
      database.items[index] = updated;
      return updated;
    });
  }
  async setVisitorTabStatus(tabId, status) {
    return this.update((database) => {
      const index = findIndexById(database.tabs, tabId, "tab-not-found", "Tab");
      const tab = database.tabs[index];
      if (tab.kind !== TAB_KIND.EVENT) {
        throw new BarError("tab-not-visitor-tab", "Tab must belong to a visitor");
      }
      assertActiveEventTab(database, tab);
      const updated = status === TAB_STATUS.CLOSED ? { ...tab, status, closedAt: this.dependencies.now() } : {
        id: tab.id,
        kind: tab.kind,
        status,
        eventId: tab.eventId,
        visitorId: tab.visitorId,
        openedAt: tab.openedAt
      };
      database.tabs[index] = updated;
      return updated;
    });
  }
  closeMonthlyTabs(database, month) {
    const closedAt = this.dependencies.now();
    database.tabs = database.tabs.map(
      (tab) => tab.kind === TAB_KIND.MONTHLY && tab.month === month && tab.status === TAB_STATUS.OPEN ? { ...tab, status: TAB_STATUS.CLOSED, closedAt } : tab
    );
  }
  recordConsumption(database, input) {
    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
      throw new BarError(
        "consumption-quantity-invalid",
        "Consumption quantity must be a positive safe integer"
      );
    }
    const tab = findById(database.tabs, input.tabId, "tab-not-found", "Tab");
    assertActiveEventTab(database, tab);
    const itemIndex = findIndexById(database.items, input.itemId, "item-not-found", "Item");
    const item = database.items[itemIndex];
    const result = recordConsumption({
      tab,
      item,
      quantity: input.quantity,
      chargeKind: input.chargeKind,
      actorId: input.actorId
    }, this.dependencies);
    database.consumptions.push(result.consumption);
    if (result.stockMovement) {
      database.stockMovements.push(result.stockMovement);
      database.items[itemIndex] = {
        ...item,
        stockQuantity: calculateStockQuantity(
          item.stockQuantity,
          result.stockMovement.quantityDelta
        )
      };
    }
    return result;
  }
  cancelConsumptionInDatabase(database, input) {
    const index = findIndexById(
      database.consumptions,
      input.consumptionId,
      "consumption-not-found",
      "Consumption"
    );
    const consumption = database.consumptions[index];
    assertCancellable(database, consumption.id);
    const itemIndex = findIndexById(
      database.items,
      consumption.itemId,
      "item-not-found",
      "Item"
    );
    const item = database.items[itemIndex];
    const originalStockMovement = database.stockMovements.find(
      ({ kind, consumptionId }) => kind === STOCK_MOVEMENT_KIND.CONSUMPTION && consumptionId === consumption.id
    );
    if (item.stockQuantity !== void 0 && !originalStockMovement) {
      throw new BarError(
        "consumption-stock-movement-missing",
        "Tracked consumption must have its original stock movement"
      );
    }
    const result = cancelConsumption({
      consumption,
      item,
      originalStockMovement,
      actorId: input.actorId
    }, this.dependencies);
    database.consumptions[index] = result.consumption;
    if (result.stockMovement) {
      database.stockMovements.push(result.stockMovement);
      database.items[itemIndex] = {
        ...item,
        stockQuantity: calculateStockQuantity(
          item.stockQuantity,
          result.stockMovement.quantityDelta
        )
      };
    }
    return result;
  }
  async list(key) {
    return clone(this.load(true)[key]);
  }
  update(mutation) {
    const database = clone(this.load(false));
    const result = mutation(database);
    if (!isBarDatabase(database)) {
      throw new BarError("database-mutation-invalid", "Mutation produced invalid bar data");
    }
    this.save(database);
    return Promise.resolve(clone(result));
  }
  load(persistMissing) {
    const stored = this.dependencies.storage.getItem(this.storageKey);
    if (stored === null) {
      const database = createDemoDatabase();
      if (persistMissing) this.save(database);
      return database;
    }
    return parseEnvelope(stored).data;
  }
  save(database) {
    const envelope = { version: 1, data: database };
    this.dependencies.storage.setItem(this.storageKey, JSON.stringify(envelope));
  }
};
function parseEnvelope(bytes) {
  let value;
  try {
    value = JSON.parse(bytes);
  } catch {
    throw new BarPersistenceError("stored-data-malformed", "Stored bar data is malformed JSON");
  }
  if (!isRecord(value) || value.version !== 1) {
    throw new BarPersistenceError(
      "stored-data-unsupported-version",
      "Stored bar data uses an unsupported version"
    );
  }
  if (!isBarDatabase(value.data)) {
    throw new BarPersistenceError("stored-data-invalid", INVALID_DATA_MESSAGE);
  }
  return value;
}
function isBarDatabase(value) {
  if (!isRecord(value)) return false;
  const keys = [
    "consumers",
    "items",
    "events",
    "tabs",
    "consumptions",
    "payments",
    "stockMovements",
    "monthlyClosings",
    "memberStatements"
  ];
  if (!keys.every((key) => Array.isArray(value[key]))) return false;
  const data = value;
  const hasValidEntities = data.consumers.every(isConsumer) && data.items.every(isItem) && data.events.every(isEvent) && data.tabs.every(isTab) && data.consumptions.every(isConsumption) && data.payments.every(isPayment) && data.stockMovements.every(isStockMovement) && data.monthlyClosings.every(isMonthlyClosing) && data.memberStatements.every(isMemberStatement);
  return hasValidEntities && hasValidRelationships(data);
}
function hasValidRelationships(database) {
  const consumerById = new Map(database.consumers.map((entry) => [entry.id, entry]));
  const itemById = new Map(database.items.map((entry) => [entry.id, entry]));
  const eventIds = new Set(database.events.map(({ id }) => id));
  const tabById = new Map(database.tabs.map((entry) => [entry.id, entry]));
  const consumptionById = new Map(database.consumptions.map((entry) => [entry.id, entry]));
  const statementById = new Map(database.memberStatements.map((entry) => [entry.id, entry]));
  if (![
    database.consumers,
    database.items,
    database.events,
    database.tabs,
    database.consumptions,
    database.payments,
    database.stockMovements,
    database.monthlyClosings,
    database.memberStatements
  ].every(hasUniqueIds)) return false;
  const validTabs = database.tabs.every((tab) => tab.kind === TAB_KIND.EVENT ? eventIds.has(tab.eventId) && consumerById.get(tab.visitorId)?.kind === CONSUMER_KIND.VISITOR : consumerById.get(tab.memberId)?.kind === CONSUMER_KIND.MEMBER);
  const validConsumptions = database.consumptions.every((consumption) => {
    const tab = tabById.get(consumption.tabId);
    const expectedConsumerId = tab?.kind === TAB_KIND.EVENT ? tab.visitorId : tab?.memberId;
    return itemById.has(consumption.itemId) && consumerById.has(consumption.consumerId) && expectedConsumerId === consumption.consumerId;
  });
  const validPayments = database.payments.every(({ target, targetId }) => target === PAYMENT_TARGET.TAB ? tabById.has(targetId) : statementById.has(targetId));
  const validMovements = database.stockMovements.every((movement) => {
    const item = itemById.get(movement.itemId);
    if (!item) return false;
    if (movement.kind !== STOCK_MOVEMENT_KIND.CONSUMPTION && movement.kind !== STOCK_MOVEMENT_KIND.REVERSAL) return movement.consumptionId === void 0;
    const consumption = movement.consumptionId ? consumptionById.get(movement.consumptionId) : void 0;
    return item.stockQuantity !== void 0 && consumption?.itemId === movement.itemId;
  });
  const validStatements = database.memberStatements.every((statement) => consumerById.get(statement.memberId)?.kind === CONSUMER_KIND.MEMBER && statement.consumptions.every(({ consumerId }) => consumerId === statement.memberId));
  const validClosings = database.monthlyClosings.every((closing) => closing.statementIds.every((id) => statementById.get(id)?.month === closing.month));
  return validTabs && validConsumptions && validPayments && validMovements && validStatements && validClosings;
}
function isConsumer(value) {
  return hasStringIdAndName(value) && isRecord(value) && isOneOf(value.kind, Object.values(CONSUMER_KIND)) && isOptionalString(value.phone) && isOptionalBoolean(value.active);
}
function isItem(value) {
  return hasStringIdAndName(value) && isRecord(value) && hasSafeCents(value) && isOptionalString(value.code) && isOptionalString(value.category) && isOptionalString(value.unit) && isOptionalString(value.description) && isOptionalBoolean(value.active) && isOptionalBoolean(value.favorite) && (value.stockQuantity === void 0 || Number.isSafeInteger(value.stockQuantity));
}
function isEvent(value) {
  return hasStringIdAndName(value) && isRecord(value) && typeof value.startsAt === "string" && isOptionalString(value.endsAt) && (value.status === void 0 || isOneOf(value.status, Object.values(EVENT_STATUS)));
}
function isTab(value) {
  if (!hasStringId(value) || !isRecord(value) || typeof value.openedAt !== "string" || !isOneOf(value.status, Object.values(TAB_STATUS))) return false;
  const hasValidLifecycle = value.status === TAB_STATUS.OPEN ? value.closedAt === void 0 : typeof value.closedAt === "string";
  if (!hasValidLifecycle) return false;
  if (value.kind === TAB_KIND.EVENT) {
    return typeof value.eventId === "string" && typeof value.visitorId === "string";
  }
  return value.kind === TAB_KIND.MONTHLY && typeof value.memberId === "string" && typeof value.month === "string";
}
function isConsumption(value) {
  if (!hasStringId(value) || !isRecord(value)) return false;
  const validBase = ["tabId", "consumerId", "itemId", "createdAt", "actorId"].every((key) => typeof value[key] === "string") && isOneOf(value.chargeKind, Object.values(CHARGE_KIND)) && Number.isSafeInteger(value.quantity) && Number(value.quantity) > 0 && hasSafeCents(value);
  if (!validBase) return false;
  return value.status === CONSUMPTION_STATUS.ACTIVE ? value.cancelledAt === void 0 && value.cancelledByActorId === void 0 : value.status === CONSUMPTION_STATUS.CANCELLED && typeof value.cancelledAt === "string" && typeof value.cancelledByActorId === "string";
}
function isPayment(value) {
  return hasStringId(value) && isRecord(value) && isOneOf(value.target, Object.values(PAYMENT_TARGET)) && typeof value.targetId === "string" && Number.isSafeInteger(value.amountCents) && Number(value.amountCents) > 0 && typeof value.paidAt === "string" && typeof value.actorId === "string";
}
function isStockMovement(value) {
  return hasStringId(value) && isRecord(value) && typeof value.itemId === "string" && isOneOf(value.kind, Object.values(STOCK_MOVEMENT_KIND)) && Number.isSafeInteger(value.quantityDelta) && typeof value.occurredAt === "string" && typeof value.actorId === "string" && isOptionalString(value.consumptionId);
}
function isMonthlyClosing(value) {
  return hasStringId(value) && isRecord(value) && typeof value.month === "string" && Array.isArray(value.statementIds) && value.statementIds.every(isString) && typeof value.closedAt === "string" && typeof value.actorId === "string";
}
function isMemberStatement(value) {
  return hasStringId(value) && isRecord(value) && typeof value.memberId === "string" && typeof value.month === "string" && Array.isArray(value.consumptions) && value.consumptions.every(isConsumption) && typeof value.createdAt === "string";
}
function hasStringId(value) {
  return isRecord(value) && typeof value.id === "string";
}
function hasStringIdAndName(value) {
  return hasStringId(value) && isRecord(value) && typeof value.name === "string";
}
function hasSafeCents(value) {
  return isRecord(value) && Number.isSafeInteger(value.unitCostCents) && Number(value.unitCostCents) >= 0 && Number.isSafeInteger(value.unitPriceCents) && Number(value.unitPriceCents) >= 0;
}
function isOptionalString(value) {
  return value === void 0 || typeof value === "string";
}
function isOptionalBoolean(value) {
  return value === void 0 || typeof value === "boolean";
}
function isString(value) {
  return typeof value === "string";
}
function isOneOf(value, allowed) {
  return typeof value === "string" && allowed.includes(value);
}
function hasUniqueIds(values) {
  return new Set(values.map(({ id }) => id)).size === values.length;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function findIndexById(values, id, code, entity) {
  const index = values.findIndex((value) => value.id === id);
  if (index < 0) throw new BarError(code, `${entity} not found`);
  return index;
}
function findById(values, id, code, entity) {
  return values[findIndexById(values, id, code, entity)];
}
function assertCancellable(database, consumptionId) {
  const block = readStoredMoney(() => findCancellationBlock(database, consumptionId));
  if (block) {
    throw new BarError(CANCELLATION_BLOCK_CODES[block], CANCELLATION_BLOCK_REASONS[block]);
  }
}
function assertActiveEvent(event) {
  if (event.status !== EVENT_STATUS.ACTIVE) {
    throw new BarError("event-not-active", INACTIVE_EVENT_MESSAGE);
  }
}
function assertActiveEventTab(database, tab) {
  if (tab.kind !== TAB_KIND.EVENT) return;
  assertActiveEvent(findById(database.events, tab.eventId, "event-not-found", "Event"));
}
function resolvePaymentTargetConsumptions(database, input) {
  if (input.target !== PAYMENT_TARGET.TAB) {
    return findById(
      database.memberStatements,
      input.targetId,
      "payment-target-not-found",
      "Payment target"
    ).consumptions;
  }
  const tab = findById(
    database.tabs,
    input.targetId,
    "payment-target-not-found",
    "Payment target"
  );
  if (tab.kind !== TAB_KIND.EVENT) {
    throw new BarError("monthly-tab-payment-not-allowed", MONTHLY_TAB_PAYMENT_MESSAGE);
  }
  return database.consumptions.filter(({ tabId }) => tabId === tab.id);
}
var MONEY_INVARIANT_CODES = [
  "money-amount-invalid",
  "money-amount-not-positive",
  "money-total-overflow",
  "money-product-overflow"
];
function readStoredMoney(compute) {
  try {
    return compute();
  } catch (error) {
    if (isBarError(error) && MONEY_INVARIANT_CODES.includes(error.code)) {
      throw new BarPersistenceError(
        "stored-data-invalid",
        `Stored bar data breaks a money invariant: ${error.message}`
      );
    }
    throw error;
  }
}
function calculateRemainingCents(database, input, consumptions) {
  const settledPayments = database.payments.filter(
    ({ target, targetId }) => target === input.target && targetId === input.targetId
  );
  return readStoredMoney(() => summarizePayments(
    summarizeTabConsumptions(consumptions).totalCents,
    settledPayments
  ).remainingCents);
}
function assertValidManualMovement(input) {
  if (!Number.isSafeInteger(input.quantityDelta) || input.quantityDelta === 0) {
    throw new BarError(
      "stock-movement-quantity-invalid",
      "Stock movement quantity must be a non-zero safe integer"
    );
  }
  if (input.kind === STOCK_MOVEMENT_KIND.ENTRY && input.quantityDelta < 0) {
    throw new BarError("stock-entry-quantity-invalid", "Stock entry quantity must be positive");
  }
}
function calculateStockQuantity(current, delta) {
  const stockQuantity = current + delta;
  if (!Number.isSafeInteger(stockQuantity)) {
    throw new BarError("stock-quantity-overflow", "Stock quantity must be a safe integer");
  }
  return stockQuantity;
}
function assertConsumerName(value) {
  const name = value.trim();
  if (!name) throw new BarError("consumer-name-required", "Consumer name is required");
  return name;
}
function assertConsumerKind(value) {
  if (!isOneOf(value, Object.values(CONSUMER_KIND))) {
    throw new BarError("consumer-kind-invalid", "Consumer kind must be member or visitor");
  }
  return value;
}
function assertMemberNameAvailable(database, name, exceptId) {
  const wanted = normalizeConsumerName(name);
  const taken = database.consumers.some((consumer) => consumer.kind === CONSUMER_KIND.MEMBER && consumer.id !== exceptId && normalizeConsumerName(consumer.name) === wanted);
  if (taken) {
    throw new BarError("member-name-already-exists", "Member name is already registered");
  }
}
function normalizeConsumerName(name) {
  return name.trim().toLocaleLowerCase("pt-BR");
}
function withConsumerContact(consumer, name, phone) {
  const contact = { id: consumer.id, name, kind: consumer.kind, ...phone ? { phone } : {} };
  return consumer.active === void 0 ? contact : { ...contact, active: consumer.active };
}
function assertActiveTabConsumer(database, tab) {
  if (tab.kind === TAB_KIND.MONTHLY) {
    const member = findById(database.consumers, tab.memberId, "consumer-not-found", "Member");
    if (member.active === false) {
      throw new BarError("consumer-not-active-member", INACTIVE_MEMBER_MESSAGE);
    }
    return;
  }
  const visitor = findById(database.consumers, tab.visitorId, "consumer-not-found", "Visitor");
  if (visitor.active === false) {
    throw new BarError("consumer-not-active-visitor", "Consumer must be an active visitor");
  }
}
function readItemName(name) {
  const trimmed = name.trim();
  if (!trimmed) throw new BarError("item-name-required", "Item name is required");
  return trimmed;
}
function readItemPriceCents(unitPriceCents) {
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) {
    throw new BarError(
      "item-price-invalid",
      "Item price must use non-negative safe integer cents"
    );
  }
  return unitPriceCents;
}
function readItemStockQuantity(stockQuantity) {
  if (!Number.isSafeInteger(stockQuantity) || stockQuantity < 0) {
    throw new BarError(
      "item-stock-quantity-invalid",
      "Item stock quantity must be a non-negative safe integer"
    );
  }
  return stockQuantity;
}
function readItemCostCents(unitCostCents) {
  if (!Number.isSafeInteger(unitCostCents) || unitCostCents < 0) {
    throw new BarError(
      "item-cost-invalid",
      "Item cost must use non-negative safe integer cents"
    );
  }
  return unitCostCents;
}
function optionalText(key, value) {
  const trimmed = value?.trim();
  return trimmed ? { [key]: trimmed } : {};
}
function normalizeOptionalText(item) {
  const { code, category, unit, ...rest } = item;
  return {
    ...rest,
    ...optionalText("code", code),
    ...optionalText("category", category),
    ...optionalText("unit", unit)
  };
}

// server/config.ts
import { homedir } from "node:os";
import { join } from "node:path";
var BootAssertionError = class extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
    this.name = "BootAssertionError";
  }
};
var REQUIRED_TIMEZONE = "America/Sao_Paulo";
var MINIMUM_NODE_VERSION = { major: 22, minor: 5, patch: 0 };
function parseNodeVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) throw new Error(`Unparseable Node version string: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
function isSupportedNodeVersion(version) {
  const [major, minor, patch] = parseNodeVersion(version);
  const required = MINIMUM_NODE_VERSION;
  if (major !== required.major) return major > required.major;
  if (minor !== required.minor) return minor > required.minor;
  return patch >= required.patch;
}
function assertSupportedNodeVersion(version = process.version) {
  if (isSupportedNodeVersion(version)) return;
  const { major, minor, patch } = MINIMUM_NODE_VERSION;
  throw new BootAssertionError(
    `This server needs Node >= ${major}.${minor}.${patch} for the built-in node:sqlite driver; found ${version}. Install the Node 22 LTS tarball at /opt/node (see scripts/install.sh) and point the systemd unit at it.`,
    2
  );
}
function assertTimezone(timezone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  if (timezone === REQUIRED_TIMEZONE) return;
  throw new BootAssertionError(
    `Server timezone must be ${REQUIRED_TIMEZONE} (resolved to ${timezone}). Month attribution (getMonthKey/getCurrentMonth) uses local-time accessors; booting under the wrong zone misfiles consumption at month boundaries. Set TZ=${REQUIRED_TIMEZONE} (systemd Environment=TZ, or \`timedatectl set-timezone\`) and retry.`,
    3
  );
}
function assertForeignKeysEnabled(value) {
  if (value === 1) return;
  throw new BootAssertionError(
    `PRAGMA foreign_keys must report 1 after opening the database (reported ${JSON.stringify(value)}). Refusing to serve with referential integrity unenforced.`,
    3
  );
}
function assertIntegrityOk(value) {
  if (value === "ok") return;
  throw new BootAssertionError(
    `PRAGMA integrity_check did not report "ok" (reported ${JSON.stringify(value)}). Refusing to serve a possibly corrupt database \u2014 restore the latest backup from ~/Backups/motoclub/ with scripts/restore.sh before retrying.`,
    3
  );
}
var DEFAULT_PORT = 8787;
var DEFAULT_HOST = "127.0.0.1";
function firstNonEmpty(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : void 0;
}
function loadEnvConfig(env = process.env, defaults = {}) {
  const dbPath = firstNonEmpty(env.BAR_DB_PATH) ?? join(homedir(), ".local/share/motoclub/bar.sqlite3");
  const staticDir = firstNonEmpty(env.BAR_STATIC_DIR) ?? defaults.staticDir ?? join(process.cwd(), "dist");
  const host = firstNonEmpty(env.BAR_HOST) ?? DEFAULT_HOST;
  if (host === "0.0.0.0") {
    throw new BootAssertionError(
      'BAR_HOST must never be 0.0.0.0 \u2014 "no network" is structural, not configuration. Leave BAR_HOST unset (defaults to 127.0.0.1) or set it explicitly to 127.0.0.1.',
      1
    );
  }
  const portInput = firstNonEmpty(env.BAR_PORT);
  const port = portInput === void 0 ? DEFAULT_PORT : Number(portInput);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new BootAssertionError(
      `BAR_PORT must be an integer TCP port between 1 and 65535 (got ${JSON.stringify(env.BAR_PORT)}).`,
      1
    );
  }
  const pinHash = firstNonEmpty(env.BAR_PIN_HASH);
  const sessionSecret = firstNonEmpty(env.BAR_SESSION_SECRET);
  const missing = [
    !pinHash ? "BAR_PIN_HASH" : void 0,
    !sessionSecret ? "BAR_SESSION_SECRET" : void 0
  ].filter((name) => name !== void 0);
  if (missing.length > 0) {
    throw new BootAssertionError(
      `Missing required environment variable(s): ${missing.join(", ")}.
Generate them and store both in ~/.config/motoclub/env (chmod 600):
  BAR_SESSION_SECRET: node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
  BAR_PIN_HASH (format scrypt$<salt-hex>$<hash-hex>):
    node -e "const c=require('node:crypto');const s=c.randomBytes(16).toString('hex');console.log('scrypt$'+s+'$'+c.scryptSync(process.argv[1],Buffer.from(s,'hex'),64).toString('hex'))" <PIN>`,
      2
    );
  }
  return {
    dbPath,
    pinHash,
    sessionSecret,
    port,
    host,
    staticDir
  };
}
function loadConfig(env = process.env, defaults = {}) {
  assertSupportedNodeVersion();
  assertTimezone();
  return loadEnvConfig(env, defaults);
}

// server/http/rpc.ts
var RPC_METHOD_NAMES = [
  "getSnapshot",
  "listConsumers",
  "listItems",
  "listEvents",
  "listTabs",
  "listConsumptions",
  "listPayments",
  "listStockMovements",
  "listMonthlyClosings",
  "listMemberStatements",
  "resetDemo",
  "createVisitor",
  "ensureEventTab",
  "ensureMonthlyTab",
  "selectOrCreateActiveEvent",
  "createConsumption",
  "cancelConsumption",
  "editConsumptionQuantity",
  "reassignConsumption",
  "closeVisitorTab",
  "reopenVisitorTab",
  "recordPayment",
  "createMonthlyClosing",
  "addStockMovement",
  "createConsumer",
  "updateConsumer",
  "setConsumerActive",
  "createItem",
  "updateItem",
  "setItemActive"
];
var RPC_METHODS = new Set(RPC_METHOD_NAMES);
function isRpcMethod(method) {
  return RPC_METHODS.has(method);
}
var RpcRequestError = class extends Error {
  constructor(code, status, message = code) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "RpcRequestError";
  }
};
var RPC_ARG_SHAPES = {
  getSnapshot: "none",
  listConsumers: "none",
  listItems: "none",
  listEvents: "none",
  listTabs: "none",
  listConsumptions: "none",
  listPayments: "none",
  listStockMovements: "none",
  listMonthlyClosings: "none",
  listMemberStatements: "none",
  resetDemo: "none",
  createVisitor: "object",
  ensureEventTab: "object",
  ensureMonthlyTab: "object",
  selectOrCreateActiveEvent: "object",
  createConsumption: "object",
  cancelConsumption: "object",
  editConsumptionQuantity: "object",
  reassignConsumption: "object",
  closeVisitorTab: "string",
  reopenVisitorTab: "string",
  recordPayment: "object",
  createMonthlyClosing: "object",
  addStockMovement: "object",
  createConsumer: "object",
  updateConsumer: "object",
  setConsumerActive: "object",
  createItem: "object",
  updateItem: "object",
  setItemActive: "object"
};
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validateRpcArgs(method, args) {
  const shape = RPC_ARG_SHAPES[method];
  const expectedCount = shape === "none" ? 0 : 1;
  if (args.length !== expectedCount) {
    throw new RpcRequestError(
      "bad-request",
      400,
      `${method} expects ${expectedCount} argument(s), got ${args.length}`
    );
  }
  if (shape === "string" && typeof args[0] !== "string") {
    throw new RpcRequestError("bad-request", 400, `${method}'s argument must be a string`);
  }
  if (shape === "object" && !isPlainObject(args[0])) {
    throw new RpcRequestError("bad-request", 400, `${method}'s argument must be an object`);
  }
}
async function invokeRpcMethod(repository, method, args) {
  if (!isRpcMethod(method)) {
    throw new RpcRequestError("unknown-method", 400, `Unknown RPC method: ${method}`);
  }
  validateRpcArgs(method, args);
  const fn = repository[method];
  try {
    return await fn.apply(repository, args);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new RpcRequestError(
        "bad-request",
        400,
        `${method}'s argument is missing something it needs: ${error.message}`
      );
    }
    throw error;
  }
}
var BAR_ERROR_STATUS = {
  // Referências que não existem no banco local — 422, não 404: 404 fica só
  // para rota desconhecida (ver o comentário acima).
  "consumer-not-found": 422,
  "event-not-found": 422,
  "item-not-found": 422,
  "tab-not-found": 422,
  "consumption-not-found": 422,
  "payment-target-not-found": 422,
  // Elegibilidade de consumidor e de evento.
  "visitor-name-required": 422,
  "event-name-required": 422,
  "consumer-not-active-member": 422,
  "consumer-not-active-visitor": 422,
  "event-not-active": 422,
  "active-event-required": 422,
  // Ciclo de vida das comandas.
  "tab-closed": 422,
  "tab-not-visitor-tab": 422,
  "monthly-tab-month-mismatch": 422,
  "month-format-invalid": 422,
  // Lançamentos de consumo.
  "quantity-invalid": 422,
  "consumption-quantity-invalid": 422,
  "consumption-already-cancelled": 422,
  "consumption-not-reassignable": 422,
  "consumption-item-mismatch": 422,
  "reassign-target-tab-invalid": 422,
  "consumption-frozen-in-statement": 422,
  "consumption-tab-closed": 422,
  "consumption-covered-by-payment": 422,
  // Estoque.
  "item-stock-not-tracked": 422,
  "stock-movement-quantity-invalid": 422,
  "stock-entry-quantity-invalid": 422,
  "stock-quantity-overflow": 422,
  "stock-movement-mismatch": 422,
  "consumption-stock-movement-missing": 422,
  // Dinheiro e pagamentos — validação de entrada do operador, ainda 422:
  // a variante que envolve dado *guardado* corrompido já chega aqui como
  // `stored-data-invalid` (ver `readStoredMoney`), nunca com um destes
  // quatro códigos.
  "money-amount-invalid": 422,
  "money-amount-not-positive": 422,
  "money-total-overflow": 422,
  "money-product-overflow": 422,
  "payment-exceeds-balance": 422,
  "monthly-tab-payment-not-allowed": 422,
  // Fechamento mensal.
  "monthly-closing-already-exists": 409,
  "timestamp-invalid": 422,
  // Persistência: dado guardado corrompido, nunca 4xx.
  "stored-data-malformed": 500,
  "stored-data-unsupported-version": 500,
  "stored-data-invalid": 500,
  "database-mutation-invalid": 500,
  // Cadastro de consumidores: validação de entrada do operador (422), e a
  // unicidade do nome de integrante na mesma família 409 de
  // `monthly-closing-already-exists` — o pedido não é malformado, ele
  // conflita com uma linha que já existe.
  "consumer-name-required": 422,
  "consumer-kind-invalid": 422,
  "member-name-already-exists": 409,
  // Cadastro de itens — recusa de domínio sobre o que o cliente mandou
  // (nome vazio, preço/custo negativo ou fracionário), então 422 como as
  // outras validações de entrada.
  "item-name-required": 422,
  "item-price-invalid": 422,
  "item-cost-invalid": 422,
  "item-stock-quantity-invalid": 422
};
function statusForRpcError(error) {
  if (error instanceof BarError) {
    return { status: BAR_ERROR_STATUS[error.code], code: error.code };
  }
  if (error instanceof RpcRequestError) {
    return { status: error.status, code: error.code };
  }
  return { status: 500, code: "internal-error" };
}

// server/http/session.ts
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
var HEX_PATTERN = /^[0-9a-f]+$/i;
function verifyPin(pin, pinHash) {
  const parts = pinHash.split("$");
  if (parts.length !== 3) return false;
  const [tag, saltHex, hashHex] = parts;
  if (tag !== "scrypt") return false;
  if (!HEX_PATTERN.test(saltHex) || !HEX_PATTERN.test(hashHex)) return false;
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    if (expected.length === 0) return false;
    const actual = scryptSync(pin, salt, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
var SESSION_TTL_MS = 12 * 60 * 60 * 1e3;
var SESSION_COOKIE_NAME = "motoclub_session";
function createSessionToken(secret, now = Date.now(), ttlMs = SESSION_TTL_MS) {
  const expiresAt = String(now + ttlMs);
  const payload = Buffer.from(expiresAt, "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(expiresAt).digest("base64url");
  return `${payload}.${signature}`;
}
function verifySessionToken(token, secret, now = Date.now()) {
  if (!token) return false;
  const separatorIndex = token.indexOf(".");
  if (separatorIndex < 0) return false;
  const payload = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);
  if (!payload || !signature) return false;
  let expiresAtText;
  try {
    expiresAtText = Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return false;
  }
  const expiresAt = Number(expiresAtText);
  if (!Number.isFinite(expiresAt)) return false;
  const expectedSignature = createHmac("sha256", secret).update(expiresAtText).digest("base64url");
  const actual = Buffer.from(signature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (actual.length !== expected.length) return false;
  if (!timingSafeEqual(actual, expected)) return false;
  return expiresAt > now;
}
function buildSessionCookieHeader(token, maxAgeSeconds) {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}
function buildLogoutCookieHeader() {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}
function readSessionToken(cookieHeader) {
  if (!cookieHeader) return void 0;
  for (const pair of cookieHeader.split(";")) {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex < 0) continue;
    const name = pair.slice(0, separatorIndex).trim();
    if (name === SESSION_COOKIE_NAME) return pair.slice(separatorIndex + 1).trim();
  }
  return void 0;
}
var LOGIN_FAILURE_THRESHOLD = 5;
var LOGIN_DELAY_STEP_MS = 500;
var LOGIN_MAX_DELAY_MS = 3e4;
function createLoginThrottle() {
  return { failures: 0, queue: Promise.resolve() };
}
function defaultSleep(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}
function guardLoginAttempt(throttle, sleep = defaultSleep) {
  const attempt = throttle.queue.then(async () => {
    if (throttle.failures >= LOGIN_FAILURE_THRESHOLD) {
      const delay = Math.min(throttle.failures * LOGIN_DELAY_STEP_MS, LOGIN_MAX_DELAY_MS);
      await sleep(delay);
    }
  });
  throttle.queue = attempt.catch(() => {
  });
  return attempt;
}
function recordLoginFailure(throttle) {
  throttle.failures += 1;
}
function recordLoginSuccess(throttle) {
  throttle.failures = 0;
}

// server/http/static.ts
import { readFile } from "node:fs/promises";
import { extname, join as join2, resolve, sep } from "node:path";
function isAssetPath(pathname) {
  return pathname.startsWith("/assets/") && pathname.length > "/assets/".length;
}
function isApiPath(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/");
}
function hasDottedLastSegment(pathname) {
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  return lastSegment.includes(".");
}
var MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8"
};
var DEFAULT_CONTENT_TYPE = "application/octet-stream";
function contentTypeFor(path) {
  return MIME_TYPES[extname(path).toLowerCase()] ?? DEFAULT_CONTENT_TYPE;
}
function resolveStaticAssetPath(staticDir, requestPath) {
  const root = resolve(staticDir);
  const relative = requestPath.replace(/^\/+/, "");
  const resolved = resolve(root, relative);
  const rootWithTrailingSep = root.endsWith(sep) ? root : root + sep;
  if (resolved !== root && !resolved.startsWith(rootWithTrailingSep)) return void 0;
  return resolved;
}
async function sendFileIfPresent(res, staticDir, pathname, cacheControl) {
  const resolved = resolveStaticAssetPath(staticDir, pathname);
  if (!resolved) return false;
  let data;
  try {
    data = await readFile(resolved);
  } catch {
    return false;
  }
  res.writeHead(200, {
    "Content-Type": contentTypeFor(resolved),
    "Cache-Control": cacheControl
  });
  res.end(data);
  return true;
}
async function serveStaticAsset(res, staticDir, pathname) {
  return sendFileIfPresent(res, staticDir, pathname, "public, max-age=31536000, immutable");
}
async function serveRootStaticFile(res, staticDir, pathname) {
  return sendFileIfPresent(res, staticDir, pathname, "no-cache");
}
var LOGIN_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Motoclub \xB7 Entrar</title>
<style>
  html, body { height: 100%; margin: 0; }
  body {
    background: #101114;
    color: #F5F6F7;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  form {
    background: #17181c;
    border: 1px solid #2a2c31;
    border-radius: 12px;
    padding: 2rem;
    width: 100%;
    max-width: 320px;
    box-sizing: border-box;
  }
  h1 {
    font-size: 1.1rem;
    margin: 0 0 1.25rem;
    font-weight: 600;
    color: #F5F6F7;
  }
  label {
    display: block;
    font-size: 0.85rem;
    margin-bottom: 0.4rem;
    color: #b7b9bf;
  }
  input {
    width: 100%;
    box-sizing: border-box;
    padding: 0.6rem 0.75rem;
    border-radius: 8px;
    border: 1px solid #34363c;
    background: #101114;
    color: #F5F6F7;
    font-size: 1rem;
    letter-spacing: 0.2em;
  }
  input:focus {
    outline: none;
    border-color: #E0203A;
  }
  button {
    margin-top: 1.25rem;
    width: 100%;
    padding: 0.65rem 0.75rem;
    border-radius: 8px;
    border: none;
    background: #E0203A;
    color: #F5F6F7;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
  }
  button:disabled { opacity: 0.6; cursor: default; }
  #error {
    margin-top: 0.9rem;
    color: #E0203A;
    font-size: 0.85rem;
    min-height: 1.1em;
  }
</style>
</head>
<body>
<form id="login-form">
  <h1>Motoclub \xB7 Bar</h1>
  <label for="pin">PIN</label>
  <input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="off" autofocus required />
  <button type="submit">Entrar</button>
  <div id="error" role="alert"></div>
</form>
<script>
  var form = document.getElementById('login-form');
  var pinInput = document.getElementById('pin');
  var errorBox = document.getElementById('error');
  var button = form.querySelector('button');
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    errorBox.textContent = '';
    button.disabled = true;
    fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ pin: pinInput.value }),
    })
      .then(function (response) {
        if (response.ok) {
          window.location.reload();
          return;
        }
        errorBox.textContent = 'PIN incorreto.';
        button.disabled = false;
      })
      .catch(function () {
        errorBox.textContent = 'N\xE3o foi poss\xEDvel conectar ao servidor.';
        button.disabled = false;
      });
  });
</script>
</body>
</html>
`;
function sendHtml(res, status, html) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(html);
}
async function serveAppShell(res, staticDir, authenticated) {
  if (!authenticated) {
    sendHtml(res, 200, LOGIN_HTML);
    return;
  }
  try {
    const html = await readFile(join2(staticDir, "index.html"), "utf8");
    sendHtml(res, 200, html);
  } catch {
    sendHtml(
      res,
      500,
      "<!doctype html><title>Erro</title><p>index.html n\xE3o encontrado \u2014 rode `npm run build`.</p>"
    );
  }
}
function sendPlainNotFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found");
}

// server/http/router.ts
var MAX_BODY_BYTES = 1e6;
async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of req) {
      const buffer = chunk;
      total += buffer.length;
      if (total > MAX_BODY_BYTES) return { ok: false };
      chunks.push(buffer);
    }
  } catch {
    return { ok: false };
  }
  if (chunks.length === 0) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false };
  }
}
function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
function sendUnauthorized(res) {
  sendJson(res, 401, { ok: false, error: { code: "unauthorized" } });
}
function sendBadRequest(res) {
  sendJson(res, 400, { ok: false, error: { code: "bad-request" } });
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isAuthenticated(req, sessionSecret) {
  return verifySessionToken(readSessionToken(req.headers.cookie), sessionSecret);
}
async function handleLogin(req, res, config, throttle, sleep) {
  await guardLoginAttempt(throttle, sleep);
  const body = await readJsonBody(req);
  if (!body.ok || !isRecord2(body.value) || typeof body.value.pin !== "string") {
    sendBadRequest(res);
    return;
  }
  if (!verifyPin(body.value.pin, config.pinHash)) {
    recordLoginFailure(throttle);
    sendJson(res, 401, { ok: false, error: { code: "invalid-pin" } });
    return;
  }
  recordLoginSuccess(throttle);
  const token = createSessionToken(config.sessionSecret);
  res.setHeader("Set-Cookie", buildSessionCookieHeader(token, Math.floor(SESSION_TTL_MS / 1e3)));
  sendJson(res, 200, { ok: true });
}
async function handleRpc(req, res, repository) {
  const body = await readJsonBody(req);
  if (!body.ok || !isRecord2(body.value) || typeof body.value.method !== "string") {
    sendBadRequest(res);
    return;
  }
  const argsValue = "args" in body.value ? body.value.args : [];
  if (!Array.isArray(argsValue)) {
    sendBadRequest(res);
    return;
  }
  try {
    const result = await invokeRpcMethod(repository, body.value.method, argsValue);
    sendJson(res, 200, { ok: true, result });
  } catch (error) {
    const { status, code } = statusForRpcError(error);
    sendJson(res, status, { ok: false, error: { code } });
  }
}
async function handleSnapshot(res, repository) {
  try {
    const result = await repository.getSnapshot();
    sendJson(res, 200, { ok: true, result });
  } catch (error) {
    const { status, code } = statusForRpcError(error);
    sendJson(res, status, { ok: false, error: { code } });
  }
}
function createRequestHandler(deps) {
  const throttle = deps.throttle ?? createLoginThrottle();
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve2) => setTimeout(resolve2, ms)));
  const { repository, config } = deps;
  return async function handleRequest(req, res) {
    const url = new URL(req.url ?? "/", "http://internal");
    const pathname = url.pathname;
    const method = req.method ?? "GET";
    if (method === "GET" && pathname === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }
    if (method === "POST" && pathname === "/api/session") {
      await handleLogin(req, res, config, throttle, sleep);
      return;
    }
    if (method === "GET" && pathname === "/logout") {
      res.writeHead(302, { "Set-Cookie": buildLogoutCookieHeader(), Location: "/" });
      res.end();
      return;
    }
    if (method === "GET" && isAssetPath(pathname)) {
      const served = await serveStaticAsset(res, config.staticDir, pathname);
      if (!served) sendPlainNotFound(res);
      return;
    }
    if (method === "POST" && pathname === "/api/rpc") {
      if (!isAuthenticated(req, config.sessionSecret)) {
        sendUnauthorized(res);
        return;
      }
      await handleRpc(req, res, repository);
      return;
    }
    if (method === "GET" && pathname === "/api/snapshot") {
      if (!isAuthenticated(req, config.sessionSecret)) {
        sendUnauthorized(res);
        return;
      }
      await handleSnapshot(res, repository);
      return;
    }
    if (method === "GET" && !isApiPath(pathname)) {
      if (hasDottedLastSegment(pathname)) {
        const served = await serveRootStaticFile(res, config.staticDir, pathname);
        if (!served) sendPlainNotFound(res);
        return;
      }
      await serveAppShell(res, config.staticDir, isAuthenticated(req, config.sessionSecret));
      return;
    }
    if (isApiPath(pathname)) {
      sendJson(res, 404, { ok: false, error: { code: "not-found" } });
      return;
    }
    sendPlainNotFound(res);
  };
}

// server/storage/driver.ts
async function openNodeSqliteDriver(path) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path);
  return {
    exec(sql) {
      db.exec(sql);
    },
    get(sql, params = []) {
      return db.prepare(sql).get(...params);
    },
    all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    run(sql, params = []) {
      db.prepare(sql).run(...params);
    },
    transaction(fn) {
      db.exec("BEGIN");
      let result;
      try {
        result = fn();
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
        }
        throw error;
      }
      db.exec("COMMIT");
      return result;
    },
    close() {
      db.close();
    }
  };
}

// server/storage/schema.ts
var SCHEMA_SQL = `-- SQLite stores the document, not a normalized schema. \`kv\` is the only
-- table LocalBarRepository's \`StorageLike\` needs; \`kv_history\` is a
-- gzip-compressed version history of every value \`kv\` has ever held (see
-- \`kv-history.ts\`), so a mis-tap can be undone instead of being permanent.
--
-- \`synchronous = FULL\` is deliberate and load-bearing: this machine loses
-- power with the lid closed. Do not "optimise" it to NORMAL.
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv_history (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  value_gz BLOB NOT NULL,
  written_at TEXT NOT NULL
);
`;

// server/storage/kv-history.ts
import { gzipSync } from "node:zlib";
var MAX_HISTORY_ENTRIES = 200;
var MAX_HISTORY_BYTES = 20 * 1024 * 1024;
function insertHistoryEntry(driver, key, value, writtenAt) {
  const compressed = gzipSync(Buffer.from(value, "utf8"));
  driver.run("INSERT INTO kv_history (key, value_gz, written_at) VALUES (?, ?, ?)", [key, compressed, writtenAt]);
}
function pruneHistory(driver, options = {}) {
  const maxEntries = options.maxEntries ?? MAX_HISTORY_ENTRIES;
  const maxBytes = options.maxBytes ?? MAX_HISTORY_BYTES;
  driver.run("DELETE FROM kv_history WHERE seq NOT IN (SELECT seq FROM kv_history ORDER BY seq DESC LIMIT ?)", [
    maxEntries
  ]);
  driver.run(
    `DELETE FROM kv_history WHERE seq IN (
       SELECT seq FROM (
         SELECT seq, SUM(LENGTH(value_gz)) OVER (ORDER BY seq DESC) AS running_total
         FROM kv_history
       )
       WHERE running_total > ?
     )`,
    [maxBytes]
  );
}

// server/storage/sqlite-storage.ts
var SqliteStorage = class {
  constructor(driver) {
    this.driver = driver;
  }
  getItem(key) {
    const row = this.driver.get("SELECT value FROM kv WHERE key = ?", [key]);
    return row === void 0 ? null : row.value;
  }
  setItem(key, value) {
    const writtenAt = (/* @__PURE__ */ new Date()).toISOString();
    this.driver.transaction(() => {
      this.driver.run(
        `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [key, value, writtenAt]
      );
      insertHistoryEntry(this.driver, key, value, writtenAt);
      pruneHistory(this.driver);
    });
  }
};

// server/main.ts
function resolveDistDirFromBundleDir(bundleDir) {
  return join3(bundleDir, "..", "..", "dist");
}
function defaultStaticDir() {
  return resolveDistDirFromBundleDir(dirname(fileURLToPath(import.meta.url)));
}
async function openDatabase(config) {
  const driver = await openNodeSqliteDriver(config.dbPath);
  driver.exec(SCHEMA_SQL);
  assertForeignKeysEnabled(driver.get("PRAGMA foreign_keys")?.foreign_keys);
  assertIntegrityOk(driver.get("PRAGMA integrity_check")?.integrity_check);
  return driver;
}
function buildRepository(driver) {
  return new LocalBarRepository({
    storage: new SqliteStorage(driver),
    nextId: () => randomUUID(),
    now: () => (/* @__PURE__ */ new Date()).toISOString()
  });
}
function sendJson2(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
function createHttpServer(repository, config) {
  const handleRequest = createRequestHandler({
    repository,
    config: {
      pinHash: config.pinHash,
      sessionSecret: config.sessionSecret,
      staticDir: config.staticDir
    }
  });
  return http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      console.error("Unhandled error while serving a request:", error);
      if (!res.headersSent) sendJson2(res, 500, { ok: false, error: { code: "internal-error" } });
    });
  });
}
function listen(server, port, host) {
  return new Promise((resolve2) => {
    server.listen(port, host, resolve2);
  });
}
function lockFilePath(dbPath) {
  return `${dbPath}.lock`;
}
function writeLockFile(dbPath) {
  const contents = { pid: process.pid, startedAt: (/* @__PURE__ */ new Date()).toISOString() };
  writeFileSync(lockFilePath(dbPath), JSON.stringify(contents), "utf8");
}
function removeLockFile(dbPath) {
  try {
    unlinkSync(lockFilePath(dbPath));
  } catch {
  }
}
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}
function checkLockStatus(dbPath) {
  let raw;
  try {
    raw = readFileSync(lockFilePath(dbPath), "utf8");
  } catch {
    return { running: false };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { running: false };
  }
  const pid = parsed.pid;
  if (typeof pid !== "number") return { running: false };
  return isProcessAlive(pid) ? { running: true, pid } : { running: false, pid, stale: true };
}
async function bootServer(config) {
  const driver = await openDatabase(config);
  const repository = buildRepository(driver);
  const server = createHttpServer(repository, config);
  await listen(server, config.port, config.host);
  writeLockFile(config.dbPath);
  return { server, driver, repository };
}
var SHUTDOWN_TIMEOUT_MS = 5e3;
function shutdown(server, driver, timeoutMs = SHUTDOWN_TIMEOUT_MS) {
  return new Promise((resolve2) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearInterval(pollIdleConnections);
      clearTimeout(forceCloseTimer);
      driver.close();
      resolve2();
    };
    const pollIdleConnections = setInterval(() => server.closeIdleConnections(), 50);
    const forceCloseTimer = setTimeout(() => {
      server.closeAllConnections();
      finish();
    }, timeoutMs);
    server.close(finish);
    server.closeIdleConnections();
  });
}
function installShutdownHandlers(server, driver, dbPath) {
  let shuttingDown = false;
  const handle = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down`);
    shutdown(server, driver).then(() => {
      removeLockFile(dbPath);
      process.exit(0);
    });
  };
  process.on("SIGINT", () => handle("SIGINT"));
  process.on("SIGTERM", () => handle("SIGTERM"));
}
async function main() {
  const config = loadConfig(process.env, { staticDir: defaultStaticDir() });
  const { server, driver } = await bootServer(config);
  console.log(`motoclub bar server listening on http://${config.host}:${config.port}`);
  installShutdownHandlers(server, driver, config.dbPath);
}
function isEntryPoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}
if (isEntryPoint()) {
  main().catch((error) => {
    if (error instanceof BootAssertionError) {
      console.error(`Failed to start: ${error.message}`);
      process.exit(error.exitCode);
    }
    console.error("Failed to start:", error);
    process.exit(1);
  });
}
export {
  SCHEMA_SQL,
  SHUTDOWN_TIMEOUT_MS,
  SqliteStorage,
  bootServer,
  checkLockStatus,
  installShutdownHandlers,
  isProcessAlive,
  lockFilePath,
  openNodeSqliteDriver,
  resolveDistDirFromBundleDir,
  shutdown
};
