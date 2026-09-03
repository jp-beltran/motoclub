import { describe, expect, it } from 'vitest'

import { BarError, type BarErrorCode } from '../domain/errors'
import {
  BAR_ERROR_FALLBACKS,
  BAR_ERROR_MESSAGES,
  describeBarError,
} from './error-messages'

/**
 * Exhaustive by construction: a `Record` over the whole union with no cast, so
 * adding a `BarErrorCode` without listing it here stops the build — and
 * `BAR_ERROR_MESSAGES` has the same key type, so a new code cannot ship
 * without pt-BR copy for it.
 */
const EVERY_CODE: Record<BarErrorCode, true> = {
  'consumer-not-found': true,
  'event-not-found': true,
  'item-not-found': true,
  'tab-not-found': true,
  'consumption-not-found': true,
  'payment-target-not-found': true,
  'visitor-name-required': true,
  'event-name-required': true,
  'consumer-not-active-member': true,
  'consumer-not-active-visitor': true,
  'event-not-active': true,
  'active-event-required': true,
  'tab-closed': true,
  'tab-not-visitor-tab': true,
  'monthly-tab-month-mismatch': true,
  'month-format-invalid': true,
  'quantity-invalid': true,
  'consumption-quantity-invalid': true,
  'consumption-already-cancelled': true,
  'consumption-not-reassignable': true,
  'consumption-item-mismatch': true,
  'reassign-target-tab-invalid': true,
  'item-stock-not-tracked': true,
  'stock-movement-quantity-invalid': true,
  'stock-entry-quantity-invalid': true,
  'stock-quantity-overflow': true,
  'stock-movement-mismatch': true,
  'consumption-stock-movement-missing': true,
  'money-amount-invalid': true,
  'money-amount-not-positive': true,
  'money-total-overflow': true,
  'money-product-overflow': true,
  'payment-exceeds-balance': true,
  'monthly-tab-payment-not-allowed': true,
  'monthly-closing-already-exists': true,
  'timestamp-invalid': true,
  'stored-data-malformed': true,
  'stored-data-unsupported-version': true,
  'stored-data-invalid': true,
  'database-mutation-invalid': true,
}

const EVERY_CODE_LIST = Object.keys(EVERY_CODE) as BarErrorCode[]

describe('BAR_ERROR_MESSAGES', () => {
  it('covers every code in the taxonomy and nothing else', () => {
    expect(Object.keys(BAR_ERROR_MESSAGES).sort()).toEqual(EVERY_CODE_LIST.sort())
  })

  it('gives every code a non-empty pt-BR sentence', () => {
    EVERY_CODE_LIST.forEach((code) => {
      expect(BAR_ERROR_MESSAGES[code].trim().length).toBeGreaterThan(0)
    })
  })

  it('never leaks an English developer sentence to the operator', () => {
    // Every stored sentence has to read as pt-BR: no ASCII-only English
    // phrases that the domain uses as its developer-facing detail.
    const englishFragments = [
      'must',
      'cannot',
      'Cannot',
      'not found',
      'Error',
      'Tab ',
      'Payment',
      'Consumption',
      'Stock',
      'Money',
      'Visitor',
      'Monthly',
    ]

    EVERY_CODE_LIST.forEach((code) => {
      englishFragments.forEach((fragment) => {
        expect(BAR_ERROR_MESSAGES[code]).not.toContain(fragment)
      })
    })
  })
})

describe('describeBarError', () => {
  it.each([
    ['tab-closed', 'Esta comanda está fechada e não aceita novos lançamentos.'],
    ['monthly-tab-month-mismatch', 'A comanda mensal só pode ser aberta no mês corrente.'],
    ['consumer-not-active-member', 'O consumidor precisa ser um integrante ativo.'],
    ['consumer-not-active-visitor', 'O consumidor precisa ser um visitante ativo.'],
    [
      'reassign-target-tab-invalid',
      'A comanda de destino precisa estar aberta e ser do mesmo tipo.',
    ],
    ['consumption-not-reassignable', 'Só é possível mover um lançamento ativo.'],
    ['consumption-already-cancelled', 'Este lançamento já foi cancelado.'],
    ['quantity-invalid', 'A quantidade precisa ser um número inteiro maior que zero.'],
    [
      'consumption-quantity-invalid',
      'A quantidade precisa ser um número inteiro maior que zero.',
    ],
    ['visitor-name-required', 'Informe o nome do visitante.'],
  ] satisfies readonly (readonly [BarErrorCode, string])[])(
    'translates %s for the launch and consumer surfaces',
    (code, expected) => {
      expect(describeBarError(new BarError(code, 'developer detail'))).toBe(expected)
    },
  )

  it.each([
    ['payment-exceeds-balance', 'O valor informado é maior do que o saldo em aberto.'],
    [
      'monthly-tab-payment-not-allowed',
      'Comandas mensais só podem ser pagas pelo extrato do integrante, após o fechamento do mês.',
    ],
    [
      'payment-target-not-found',
      'Alvo do pagamento não encontrado. Atualize a página e tente novamente.',
    ],
    ['money-amount-not-positive', 'Informe um valor de pagamento válido, maior que zero.'],
  ] satisfies readonly (readonly [BarErrorCode, string])[])(
    'translates %s for the payments surface',
    (code, expected) => {
      expect(describeBarError(new BarError(code, 'developer detail'))).toBe(expected)
    },
  )

  it.each([
    ['item-stock-not-tracked', 'Este item não possui controle de estoque.'],
    ['item-not-found', 'Item não encontrado. Atualize a página e tente novamente.'],
    ['stock-entry-quantity-invalid', 'A quantidade de entrada deve ser maior que zero.'],
    ['stock-movement-quantity-invalid', 'Informe uma quantidade válida.'],
    ['stock-quantity-overflow', 'A quantidade resultante do estoque é inválida.'],
  ] satisfies readonly (readonly [BarErrorCode, string])[])(
    'translates %s for the inventory surface',
    (code, expected) => {
      expect(describeBarError(new BarError(code, 'developer detail'))).toBe(expected)
    },
  )

  it.each([
    ['tab-not-found', 'Comanda não encontrada. Atualize a página e tente novamente.'],
    ['tab-not-visitor-tab', 'Esta ação está disponível apenas para comandas de visitante.'],
  ] satisfies readonly (readonly [BarErrorCode, string])[])(
    'translates %s for the tabs surface',
    (code, expected) => {
      expect(describeBarError(new BarError(code, 'developer detail'))).toBe(expected)
    },
  )

  it('translates a month already closed for the closing surface', () => {
    expect(
      describeBarError(new BarError('monthly-closing-already-exists', 'developer detail')),
    ).toBe('Este mês já foi fechado. Não é possível fechá-lo novamente.')
  })

  it('says both what an inactive event blocks: launching and changing tabs', () => {
    // The old ui/tabs and application tables disagreed on this one sentence.
    // The single entry has to serve both surfaces it can reach.
    const message = describeBarError(new BarError('event-not-active', 'Event must be active'))

    expect(message).toContain('não está ativo')
    expect(message).toContain('lançar consumo')
    expect(message).toContain('comandas')
  })

  it('falls back to the generic operation message for a non-Error value', () => {
    expect(describeBarError('boom')).toBe(BAR_ERROR_FALLBACKS.operation)
  })

  it('falls back to the generic operation message for an uncoded Error', () => {
    expect(describeBarError(new Error('Item not found'))).toBe(BAR_ERROR_FALLBACKS.operation)
  })

  it('uses the surface fallback the caller asks for when the failure has no code', () => {
    expect(describeBarError(new Error('boom'), BAR_ERROR_FALLBACKS.payment)).toBe(
      'Não foi possível registrar o pagamento. Tente novamente.',
    )
    expect(describeBarError('boom', BAR_ERROR_FALLBACKS.stockMovement)).toBe(
      'Não foi possível registrar a movimentação. Tente novamente.',
    )
    expect(describeBarError(new Error('boom'), BAR_ERROR_FALLBACKS.tab)).toBe(
      'Não foi possível atualizar a comanda. Tente novamente.',
    )
    expect(describeBarError(new Error('boom'), BAR_ERROR_FALLBACKS.monthlyClosing)).toBe(
      'Não foi possível fechar o mês. Tente novamente.',
    )
  })

  it('prefers the coded message over the surface fallback', () => {
    expect(
      describeBarError(
        new BarError('payment-exceeds-balance', 'Payment cannot exceed the amount due'),
        BAR_ERROR_FALLBACKS.payment,
      ),
    ).toBe('O valor informado é maior do que o saldo em aberto.')
  })

  it('never leaks the English cause to the operator', () => {
    const causes: readonly (readonly [BarErrorCode, string])[] = [
      ['tab-closed', 'Cannot add consumption to a closed tab'],
      ['event-not-active', 'Event must be active'],
      ['reassign-target-tab-invalid', 'Target tab must be open and compatible'],
      ['payment-exceeds-balance', 'Payment cannot exceed the amount due'],
    ]

    causes.forEach(([code, cause]) => {
      expect(describeBarError(new BarError(code, cause))).not.toContain(cause)
    })
    expect(describeBarError(new Error('Unmapped repository failure'))).not.toContain(
      'Unmapped repository failure',
    )
  })
})

describe('BAR_ERROR_FALLBACKS', () => {
  it('gives every surface its own pt-BR retry sentence', () => {
    const fallbacks = Object.values(BAR_ERROR_FALLBACKS)

    expect(fallbacks.length).toBeGreaterThan(0)
    expect(new Set(fallbacks).size).toBe(fallbacks.length)
    fallbacks.forEach((fallback) => {
      expect(fallback).toContain('Não foi possível')
      expect(fallback).toContain('novamente.')
    })
  })
})
