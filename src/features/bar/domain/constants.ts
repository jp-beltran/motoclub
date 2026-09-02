export const CONSUMER_KIND = { MEMBER: 'member', VISITOR: 'visitor' } as const
export const TAB_KIND = { EVENT: 'event', MONTHLY: 'monthly' } as const
export const TAB_STATUS = { OPEN: 'open', CLOSED: 'closed' } as const
export const CONSUMPTION_STATUS = { ACTIVE: 'active', CANCELLED: 'cancelled' } as const
export const CHARGE_KIND = { CHARGED: 'charged', COURTESY: 'courtesy' } as const
export const PAYMENT_TARGET = { TAB: 'tab', STATEMENT: 'statement' } as const
export const PAYMENT_STATUS = {
  UNPAID: 'unpaid',
  PARTIAL: 'partial',
  PAID: 'paid',
} as const
export const STOCK_MOVEMENT_KIND = {
  ENTRY: 'entry',
  CONSUMPTION: 'consumption',
  REVERSAL: 'reversal',
  ADJUSTMENT: 'adjustment',
} as const
export const STOCK_WARNING = { INSUFFICIENT: 'insufficient-stock' } as const

export type ConsumerKind = (typeof CONSUMER_KIND)[keyof typeof CONSUMER_KIND]
export type TabKind = (typeof TAB_KIND)[keyof typeof TAB_KIND]
export type TabStatus = (typeof TAB_STATUS)[keyof typeof TAB_STATUS]
export type ConsumptionStatus =
  (typeof CONSUMPTION_STATUS)[keyof typeof CONSUMPTION_STATUS]
export type ChargeKind = (typeof CHARGE_KIND)[keyof typeof CHARGE_KIND]
export type PaymentTarget = (typeof PAYMENT_TARGET)[keyof typeof PAYMENT_TARGET]
export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS]
export type StockMovementKind =
  (typeof STOCK_MOVEMENT_KIND)[keyof typeof STOCK_MOVEMENT_KIND]
export type StockWarning = (typeof STOCK_WARNING)[keyof typeof STOCK_WARNING]
