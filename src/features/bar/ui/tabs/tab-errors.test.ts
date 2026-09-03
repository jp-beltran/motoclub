import { describe, expect, it } from 'vitest'

import { describeTabError } from './tab-errors'

describe('describeTabError', () => {
  it('maps a missing tab to a pt-BR sentence', () => {
    expect(describeTabError(new Error('Tab not found'))).toBe(
      'Comanda não encontrada. Atualize a página e tente novamente.',
    )
  })

  it('maps a non-visitor tab to a pt-BR sentence', () => {
    expect(describeTabError(new Error('Tab must belong to a visitor'))).toBe(
      'Esta ação está disponível apenas para comandas de visitante.',
    )
  })

  it('maps an inactive event to a pt-BR sentence', () => {
    expect(describeTabError(new Error('Event must be active'))).toBe(
      'Só é possível fechar ou reabrir comandas de um evento ativo.',
    )
  })

  it('falls back to a generic pt-BR sentence for an unknown error', () => {
    expect(describeTabError(new Error('anything else'))).toBe(
      'Não foi possível atualizar a comanda. Tente novamente.',
    )
  })

  it('falls back to a generic pt-BR sentence for a non-Error value', () => {
    expect(describeTabError('boom')).toBe(
      'Não foi possível atualizar a comanda. Tente novamente.',
    )
  })
})
