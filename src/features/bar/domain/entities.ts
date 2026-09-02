import type {
  ChargeKind,
  ConsumerKind,
  ConsumptionStatus,
  PaymentTarget,
  StockMovementKind,
  TabKind,
  TabStatus,
} from './constants'

export interface Consumer {
  readonly id: string
  readonly name: string
  readonly kind: ConsumerKind
}

export interface Item {
  readonly id: string
  readonly name: string
  readonly unitCostCents: number
  readonly unitPriceCents: number
  readonly stockQuantity?: number
}

export interface Event {
  readonly id: string
  readonly name: string
  readonly startsAt: string
  readonly endsAt?: string
}

interface TabBase {
  readonly id: string
  readonly openedAt: string
}

type TabLifecycle =
  | {
      readonly status: Extract<TabStatus, 'open'>
      readonly closedAt?: never
    }
  | {
      readonly status: Extract<TabStatus, 'closed'>
      readonly closedAt: string
    }

interface EventTabDetails {
  readonly kind: Extract<TabKind, 'event'>
  readonly eventId: string
  readonly visitorId: string
}

interface MonthlyTabDetails {
  readonly kind: Extract<TabKind, 'monthly'>
  readonly memberId: string
  readonly month: string
}

export type EventTab = TabBase & TabLifecycle & EventTabDetails
export type MonthlyTab = TabBase & TabLifecycle & MonthlyTabDetails
export type Tab = EventTab | MonthlyTab

interface ConsumptionBase {
  readonly id: string
  readonly tabId: string
  readonly consumerId: string
  readonly itemId: string
  readonly chargeKind: ChargeKind
  readonly quantity: number
  readonly unitPriceCents: number
  readonly unitCostCents: number
  readonly createdAt: string
  readonly actorId: string
}

export type ActiveConsumption = ConsumptionBase & {
  readonly status: Extract<ConsumptionStatus, 'active'>
  readonly cancelledAt?: never
  readonly cancelledByActorId?: never
}

export type CancelledConsumption = ConsumptionBase & {
  readonly status: Extract<ConsumptionStatus, 'cancelled'>
  readonly cancelledAt: string
  readonly cancelledByActorId: string
}

export type Consumption = ActiveConsumption | CancelledConsumption

export interface Payment {
  readonly id: string
  readonly target: PaymentTarget
  readonly targetId: string
  readonly amountCents: number
  readonly paidAt: string
  readonly actorId: string
}

export interface StockMovement {
  readonly id: string
  readonly itemId: string
  readonly kind: StockMovementKind
  readonly quantityDelta: number
  readonly occurredAt: string
  readonly actorId: string
  readonly consumptionId?: string
}

export interface MemberStatement {
  readonly id: string
  readonly memberId: string
  readonly month: string
  readonly consumptions: readonly Consumption[]
  readonly createdAt: string
}

export interface MonthlyClosing {
  readonly id: string
  readonly month: string
  readonly statementIds: readonly string[]
  readonly closedAt: string
  readonly actorId: string
}
