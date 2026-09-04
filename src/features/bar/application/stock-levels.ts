import { LOW_STOCK_THRESHOLD } from './constants'

/**
 * The two stock predicates every screen shares.
 *
 * They live in the application layer, like `payment-status.ts`, because three
 * areas ask them — `/estoque`'s badge, `/lancamentos`'s item card and the
 * dashboard's low-stock list — and an area must never reach into another
 * area's UI folder for one. Their independent copies had already diverged:
 * `ItemCard` used a strict `<`, so an item sitting exactly on the threshold
 * showed as neutral on the very screen where it was about to be sold, while
 * `/estoque` and the dashboard both called it critical.
 */
export function isLowStock(stockQuantity: number): boolean {
  return stockQuantity <= LOW_STOCK_THRESHOLD
}

/**
 * Below zero: more was sold than the count said was there. Ruling 26 — the
 * negative number is *kept*, never floored at zero, because it is the signal
 * that the physical count needs an adjustment. It is a different condition
 * from "low", and every screen names it differently.
 */
export function isStockDeficit(stockQuantity: number): boolean {
  return stockQuantity < 0
}
