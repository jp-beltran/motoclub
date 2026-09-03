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

const FALLBACK_MOVEMENT_ERROR_MESSAGE =
  'Não foi possível registrar a movimentação. Tente novamente.'

// addStockMovement (local-bar-repository.ts) only ever throws a plain Error
// with one of these English messages. The repository is not this area's to
// change, so this maps its known messages to pt-BR sentences at the UI
// boundary and falls back to a generic pt-BR message for anything else.
const MOVEMENT_ERROR_MESSAGES: Record<string, string> = {
  'Item does not track stock': 'Este item não possui controle de estoque.',
  'Item not found': 'Item não encontrado. Atualize a página e tente novamente.',
  'Stock entry quantity must be positive': 'A quantidade de entrada deve ser maior que zero.',
  'Stock movement quantity must be a non-zero safe integer':
    'Informe uma quantidade válida.',
  'Stock quantity must be a safe integer': 'A quantidade resultante do estoque é inválida.',
}

export function describeMovementError(error: unknown): string {
  if (error instanceof Error && error.message in MOVEMENT_ERROR_MESSAGES) {
    return MOVEMENT_ERROR_MESSAGES[error.message]
  }
  return FALLBACK_MOVEMENT_ERROR_MESSAGE
}
