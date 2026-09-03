import { CURRENT_ACTOR_ID, CURRENT_ACTOR_NAME } from '../../application/actor'
import { STOCK_MOVEMENT_KIND, type StockMovementKind } from '../../domain/constants'
import type { StockMovement } from '../../domain/entities'

export type ManualMovementKind = Extract<StockMovementKind, 'entry' | 'adjustment'>

export type MovementQuantityResult =
  | { readonly ok: true; readonly quantityDelta: number }
  | { readonly ok: false; readonly error: string }

const MOVEMENT_KIND_LABELS: Record<StockMovementKind, string> = {
  [STOCK_MOVEMENT_KIND.ENTRY]: 'Entrada',
  [STOCK_MOVEMENT_KIND.CONSUMPTION]: 'Consumo',
  [STOCK_MOVEMENT_KIND.REVERSAL]: 'Estorno',
  [STOCK_MOVEMENT_KIND.ADJUSTMENT]: 'Ajuste',
}

export function formatMovementKind(kind: StockMovementKind): string {
  return MOVEMENT_KIND_LABELS[kind]
}

export function formatActorName(actorId: string): string {
  return actorId === CURRENT_ACTOR_ID ? CURRENT_ACTOR_NAME : actorId
}

export function parseMovementQuantity(
  kind: ManualMovementKind,
  rawValue: string,
): MovementQuantityResult {
  const trimmed = rawValue.trim()
  if (trimmed === '' || Number.isNaN(Number(trimmed))) {
    return { ok: false, error: 'Informe uma quantidade válida.' }
  }

  const value = Number(trimmed)
  if (!Number.isInteger(value)) {
    return { ok: false, error: 'A quantidade deve ser um número inteiro.' }
  }

  if (kind === STOCK_MOVEMENT_KIND.ENTRY) {
    if (value <= 0) {
      return { ok: false, error: 'A quantidade de entrada deve ser maior que zero.' }
    }
    return { ok: true, quantityDelta: value }
  }

  if (value === 0) {
    return { ok: false, error: 'O ajuste não pode ser zero.' }
  }
  return { ok: true, quantityDelta: value }
}

export function sortMovementsDescending(
  movements: readonly StockMovement[],
): StockMovement[] {
  return [...movements].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  )
}
