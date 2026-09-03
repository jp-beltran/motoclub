import type { ChargeKind, PaymentTarget, StockMovementKind } from '../domain/constants'
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
import type { CancellationResult, ConsumptionResult } from '../domain/consumption'
import type { MonthlyConsolidation } from '../domain/monthly-closing'

export interface BarDatabase {
  consumers: Consumer[]
  items: Item[]
  events: Event[]
  tabs: Tab[]
  consumptions: Consumption[]
  payments: Payment[]
  stockMovements: StockMovement[]
  monthlyClosings: MonthlyClosing[]
  memberStatements: MemberStatement[]
}

export interface BarDatabaseEnvelope {
  readonly version: 1
  readonly data: BarDatabase
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface LocalBarRepositoryDependencies {
  readonly storage: StorageLike
  readonly nextId: () => string
  readonly now: () => string
  readonly storageKey?: string
}

export interface CreateVisitorInput { readonly name: string; readonly phone?: string }
export interface EnsureEventTabInput { readonly eventId: string; readonly visitorId: string }
export interface SelectActiveEventInput { readonly name: string; readonly startsAt?: string }
export interface CreateConsumptionInput {
  readonly tabId: string
  readonly itemId: string
  readonly quantity: number
  readonly chargeKind: ChargeKind
  readonly actorId: string
}
export interface CancelConsumptionRepositoryInput {
  readonly consumptionId: string
  readonly actorId: string
}
export interface EditConsumptionQuantityInput extends CancelConsumptionRepositoryInput {
  readonly quantity: number
}
export interface EditConsumptionQuantityResult extends ConsumptionResult {
  readonly cancelledConsumption: Consumption
  readonly cancellationMovement?: StockMovement
  readonly replacement: Consumption
}
export interface ReassignConsumptionInput {
  readonly consumptionId: string
  readonly targetTabId: string
}
export interface RecordPaymentInput {
  readonly target: PaymentTarget
  readonly targetId: string
  readonly amountCents: number
  readonly actorId: string
}
export interface CreateMonthlyClosingInput { readonly month: string; readonly actorId: string }
export interface AddStockMovementInput {
  readonly itemId: string
  readonly kind: Extract<StockMovementKind, 'entry' | 'adjustment'>
  readonly quantityDelta: number
  readonly actorId: string
}

export interface BarRepository {
  getSnapshot(): Promise<BarDatabase>
  listConsumers(): Promise<Consumer[]>
  listItems(): Promise<Item[]>
  listEvents(): Promise<Event[]>
  listTabs(): Promise<Tab[]>
  listConsumptions(): Promise<Consumption[]>
  listPayments(): Promise<Payment[]>
  listStockMovements(): Promise<StockMovement[]>
  listMonthlyClosings(): Promise<MonthlyClosing[]>
  listMemberStatements(): Promise<MemberStatement[]>
  resetDemo(): Promise<BarDatabase>
  createVisitor(input: CreateVisitorInput): Promise<Consumer>
  ensureEventTab(input: EnsureEventTabInput): Promise<EventTab>
  selectOrCreateActiveEvent(input: SelectActiveEventInput): Promise<Event>
  createConsumption(input: CreateConsumptionInput): Promise<ConsumptionResult>
  cancelConsumption(input: CancelConsumptionRepositoryInput): Promise<CancellationResult>
  editConsumptionQuantity(input: EditConsumptionQuantityInput): Promise<EditConsumptionQuantityResult>
  reassignConsumption(input: ReassignConsumptionInput): Promise<Consumption>
  closeVisitorTab(tabId: string): Promise<EventTab>
  reopenVisitorTab(tabId: string): Promise<EventTab>
  recordPayment(input: RecordPaymentInput): Promise<Payment>
  createMonthlyClosing(input: CreateMonthlyClosingInput): Promise<MonthlyConsolidation>
  addStockMovement(input: AddStockMovementInput): Promise<StockMovement>
}
