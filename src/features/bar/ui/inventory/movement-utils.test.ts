import { describe, expect, it } from 'vitest'

import { CURRENT_ACTOR_ID, CURRENT_ACTOR_NAME } from '../../application/actor'
import { STOCK_MOVEMENT_KIND } from '../../domain/constants'
import type { StockMovement } from '../../domain/entities'
import {
  describeMovementError,
  formatActorName,
  formatMovementKind,
  parseMovementQuantity,
  sortMovementsDescending,
} from './movement-utils'

describe('formatMovementKind', () => {
  it('translates every stock movement kind to a pt-BR label', () => {
    expect(formatMovementKind(STOCK_MOVEMENT_KIND.ENTRY)).toBe('Entrada')
    expect(formatMovementKind(STOCK_MOVEMENT_KIND.CONSUMPTION)).toBe('Consumo')
    expect(formatMovementKind(STOCK_MOVEMENT_KIND.REVERSAL)).toBe('Estorno')
    expect(formatMovementKind(STOCK_MOVEMENT_KIND.ADJUSTMENT)).toBe('Ajuste')
  })
})

describe('formatActorName', () => {
  it('shows the current actor display name for the current actor id', () => {
    expect(formatActorName(CURRENT_ACTOR_ID)).toBe(CURRENT_ACTOR_NAME)
  })

  it('falls back to the raw actor id for an unknown actor', () => {
    expect(formatActorName('actor-desconhecido')).toBe('actor-desconhecido')
  })
})

describe('parseMovementQuantity', () => {
  it('accepts a positive integer for an entry and returns it as the delta', () => {
    expect(parseMovementQuantity('entry', '5')).toEqual({ ok: true, quantityDelta: 5 })
  })

  it('rejects an empty value', () => {
    expect(parseMovementQuantity('entry', '')).toEqual({
      ok: false,
      error: 'Informe uma quantidade válida.',
    })
  })

  it('rejects a non-numeric value', () => {
    expect(parseMovementQuantity('entry', 'abc')).toEqual({
      ok: false,
      error: 'Informe uma quantidade válida.',
    })
  })

  it('rejects a non-integer value', () => {
    expect(parseMovementQuantity('entry', '2.5')).toEqual({
      ok: false,
      error: 'A quantidade deve ser um número inteiro.',
    })
  })

  it('rejects a zero or negative entry quantity', () => {
    expect(parseMovementQuantity('entry', '0')).toEqual({
      ok: false,
      error: 'A quantidade de entrada deve ser maior que zero.',
    })
    expect(parseMovementQuantity('entry', '-3')).toEqual({
      ok: false,
      error: 'A quantidade de entrada deve ser maior que zero.',
    })
  })

  it('accepts a negative integer for an adjustment and returns it as the delta', () => {
    expect(parseMovementQuantity('adjustment', '-4')).toEqual({ ok: true, quantityDelta: -4 })
  })

  it('accepts a positive integer for an adjustment', () => {
    expect(parseMovementQuantity('adjustment', '4')).toEqual({ ok: true, quantityDelta: 4 })
  })

  it('rejects a zero adjustment', () => {
    expect(parseMovementQuantity('adjustment', '0')).toEqual({
      ok: false,
      error: 'O ajuste não pode ser zero.',
    })
  })
})

function makeMovement(overrides: Partial<StockMovement> = {}): StockMovement {
  return {
    id: 'movement-1',
    itemId: 'item-1',
    kind: STOCK_MOVEMENT_KIND.ENTRY,
    quantityDelta: 5,
    occurredAt: '2026-09-01T10:00:00.000Z',
    actorId: CURRENT_ACTOR_ID,
    ...overrides,
  }
}

describe('sortMovementsDescending', () => {
  it('orders movements from most to least recent without mutating the input', () => {
    const oldest = makeMovement({ id: 'movement-old', occurredAt: '2026-09-01T10:00:00.000Z' })
    const newest = makeMovement({ id: 'movement-new', occurredAt: '2026-09-03T10:00:00.000Z' })
    const input = [oldest, newest]

    expect(sortMovementsDescending(input)).toEqual([newest, oldest])
    expect(input).toEqual([oldest, newest])
  })
})

describe('describeMovementError', () => {
  it('maps a known repository error to a pt-BR sentence', () => {
    expect(describeMovementError(new Error('Item does not track stock'))).toBe(
      'Este item não possui controle de estoque.',
    )
  })

  it('maps every error addStockMovement can raise to a pt-BR sentence', () => {
    expect(describeMovementError(new Error('Item not found'))).toBe(
      'Item não encontrado. Atualize a página e tente novamente.',
    )
    expect(describeMovementError(new Error('Stock entry quantity must be positive'))).toBe(
      'A quantidade de entrada deve ser maior que zero.',
    )
    expect(
      describeMovementError(new Error('Stock movement quantity must be a non-zero safe integer')),
    ).toBe('Informe uma quantidade válida.')
    expect(describeMovementError(new Error('Stock quantity must be a safe integer'))).toBe(
      'A quantidade resultante do estoque é inválida.',
    )
  })

  it('falls back to a generic pt-BR message for an unrecognized error', () => {
    expect(describeMovementError(new Error('boom'))).toBe(
      'Não foi possível registrar a movimentação. Tente novamente.',
    )
  })

  it('falls back to the generic pt-BR message for a non-Error value', () => {
    expect(describeMovementError('boom')).toBe(
      'Não foi possível registrar a movimentação. Tente novamente.',
    )
  })
})
