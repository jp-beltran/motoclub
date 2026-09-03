import { describe, expect, it } from 'vitest'

import { LAUNCH_BLOCK_MESSAGES, describeLaunchError } from './launch-messages'

describe('LAUNCH_BLOCK_MESSAGES', () => {
  it('explains a closed monthly tab and points at the way out', () => {
    expect(LAUNCH_BLOCK_MESSAGES['monthly-tab-closed']).toBe(
      'A comanda mensal deste integrante já foi fechada. ' +
        'Lançamentos deste mês não são mais aceitos — o saldo é cobrado no extrato.',
    )
  })

  it('explains that only visitors depend on an active event', () => {
    expect(LAUNCH_BLOCK_MESSAGES['no-active-event']).toBe(
      'Nenhum evento ativo. Visitantes só recebem consumo durante um evento; ' +
        'integrantes continuam disponíveis.',
    )
  })

  it('explains a closed visitor tab', () => {
    expect(LAUNCH_BLOCK_MESSAGES['event-tab-closed']).toBe(
      'A comanda deste visitante está fechada. Reabra a comanda para lançar consumo.',
    )
  })
})

describe('describeLaunchError', () => {
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
    expect(describeLaunchError(new Error(message))).toBe(expected)
  })

  it('falls back to a readable message for an unmapped failure', () => {
    expect(describeLaunchError(new Error('Item not found'))).toBe(
      'Não foi possível concluir a operação. Tente novamente.',
    )
  })

  it('falls back for a value that is not an error at all', () => {
    expect(describeLaunchError('boom')).toBe(
      'Não foi possível concluir a operação. Tente novamente.',
    )
  })
})
