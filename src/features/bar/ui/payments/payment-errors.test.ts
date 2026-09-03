import { describe, expect, it } from 'vitest'

import { describePaymentError } from './payment-errors'

describe('describePaymentError', () => {
  it('maps an excessive payment to a pt-BR sentence', () => {
    expect(describePaymentError(new Error('Payment cannot exceed the amount due'))).toBe(
      'O valor informado é maior do que o saldo em aberto.',
    )
  })

  it('maps a monthly-tab payment attempt to a pt-BR sentence', () => {
    expect(
      describePaymentError(
        new Error('Monthly tab debt must be paid through its member statement'),
      ),
    ).toBe(
      'Comandas mensais só podem ser pagas pelo extrato do integrante, após o fechamento do mês.',
    )
  })

  it('maps a missing payment target to a pt-BR sentence', () => {
    expect(describePaymentError(new Error('Payment target not found'))).toBe(
      'Alvo do pagamento não encontrado. Atualize a página e tente novamente.',
    )
  })

  it('maps an invalid amount to a pt-BR sentence', () => {
    expect(
      describePaymentError(new Error('Money amounts must use positive safe integer cents')),
    ).toBe('Informe um valor de pagamento válido, maior que zero.')
  })

  it('falls back to a generic pt-BR sentence for an unknown error', () => {
    expect(describePaymentError(new Error('anything else'))).toBe(
      'Não foi possível registrar o pagamento. Tente novamente.',
    )
  })

  it('falls back to a generic pt-BR sentence for a non-Error value', () => {
    expect(describePaymentError('boom')).toBe(
      'Não foi possível registrar o pagamento. Tente novamente.',
    )
  })
})
