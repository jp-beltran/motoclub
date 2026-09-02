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
  readonly status: TabStatus
  readonly openedAt: string
  readonly closedAt?: string
}

export interface EventTab extends TabBase {
  readonly kind: Extract<TabKind, 'event'>
  readonly eventId: string
  readonly visitorId: string
}

export interface MonthlyTab extends TabBase {
  readonly kind: Extract<TabKind, 'monthly'>
  readonly memberId: string
  readonly month: string
}

export type Tab = EventTab | MonthlyTab

export interface Consumption {
  readonly id: string
  readonly tabId: string
  readonly consumerId: string
  readonly itemId: string
  readonly status: ConsumptionStatus
  readonly chargeKind: ChargeKind
  readonly quantity: number
  readonly unitPriceCents: number
  readonly unitCostCents: number
  readonly createdAt: string
  readonly cancelledAt?: string
  readonly actorId: string
  readonly cancelledByActorId?: string
}

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
