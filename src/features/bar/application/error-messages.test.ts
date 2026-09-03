import { describe, expect, it } from 'vitest'

import { describeRepositoryError } from './error-messages'

describe('describeRepositoryError', () => {
  it.each([
    ['Cannot add consumption to a closed tab', 'Esta comanda está fechada e não aceita novos lançamentos.'],
    ['Event must be active', 'O evento desta comanda não está ativo.'],
    ['Monthly tab month must match the current month', 'A comanda mensal só pode ser aberta no mês corrente.'],
    ['Consumer must be an active member', 'O consumidor precisa ser um integrante ativo.'],
    ['Consumer must be an active visitor', 'O consumidor precisa ser um visitante ativo.'],
    ['Target tab must be open and compatible', 'A comanda de destino precisa estar aberta e ser do mesmo tipo.'],
    ['Only active consumption can be reassigned', 'Só é possível mover um lançamento ativo.'],
    ['Only active consumption can be cancelled', 'Este lançamento já foi cancelado.'],
    ['Quantity must be a positive integer', 'A quantidade precisa ser um número inteiro maior que zero.'],
    ['Consumption quantity must be a positive safe integer', 'A quantidade precisa ser um número inteiro maior que zero.'],
    ['Visitor name is required', 'Informe o nome do visitante.'],
  ])('translates %s', (message, expected) => {
    expect(describeRepositoryError(new Error(message))).toBe(expected)
  })

  it('falls back to a readable message for an unmapped failure', () => {
    expect(describeRepositoryError(new Error('Item not found'))).toBe(
      'Não foi possível concluir a operação. Tente novamente.',
    )
  })

  it('falls back for a value that is not an error at all', () => {
    expect(describeRepositoryError('boom')).toBe(
      'Não foi possível concluir a operação. Tente novamente.',
    )
  })

  it('never leaks the English cause to the operator', () => {
    const causes = [
      'Cannot add consumption to a closed tab',
      'Event must be active',
      'Target tab must be open and compatible',
      'Unmapped repository failure',
    ]

    causes.forEach((cause) => {
      expect(describeRepositoryError(new Error(cause))).not.toContain(cause)
    })
  })
})
