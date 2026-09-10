import { describe, expect, it } from 'vitest'

import { parseCentsInput } from '../../../../shared/format'
import type { Item } from '../../domain/entities'
import {
  EMPTY_ITEM_FORM,
  formatCentsForInput,
  itemToForm,
  parseItemForm,
} from './item-form'

const BEER: Item = {
  id: 'item-beer',
  name: 'Cerveja lata',
  code: 'BEV-001',
  category: 'Bebidas',
  unit: 'lata',
  active: true,
  favorite: true,
  unitCostCents: 350,
  unitPriceCents: 700,
  stockQuantity: 42,
}

describe('formatCentsForInput', () => {
  it.each([
    [0, '0,00'],
    [5, '0,05'],
    [50, '0,50'],
    [700, '7,00'],
    [1250, '12,50'],
    [123456, '1234,56'],
  ])('renders %i cents as %s', (cents, expected) => {
    expect(formatCentsForInput(cents)).toBe(expected)
  })

  it('round-trips through parseCentsInput, which is what makes it safe to edit', () => {
    for (const cents of [0, 1, 99, 700, 1250, 99999]) {
      expect(parseCentsInput(formatCentsForInput(cents))).toBe(cents)
    }
  })
})

describe('itemToForm', () => {
  it('fills every field, money included, from a stored item', () => {
    expect(itemToForm(BEER)).toEqual({
      name: 'Cerveja lata',
      code: 'BEV-001',
      category: 'Bebidas',
      unit: 'lata',
      priceInput: '7,00',
      costInput: '3,50',
      favorite: true,
      // Vazio mesmo com o item tendo 42 em estoque: editar item não mexe em
      // estoque. A contagem existente continua valendo e só muda por
      // movimento em /estoque, que registra quem mexeu e quando.
      stockInput: '',
    })
  })

  it('não traz a contagem de estoque para o formulário de edição', () => {
    expect(BEER.stockQuantity).toBe(42)
    expect(itemToForm(BEER).stockInput).toBe('')
  })

  it('renders an absent optional field as an empty input, never as "undefined"', () => {
    expect(itemToForm({ ...BEER, code: undefined, category: undefined, unit: undefined }))
      .toMatchObject({ code: '', category: '', unit: '' })
  })
})

describe('parseItemForm, contagem inicial de estoque', () => {
  const BASE = { ...EMPTY_ITEM_FORM, name: 'Cerveja artesanal', priceInput: '15,00', costInput: '8,00' }

  it('em branco significa "sem controle de estoque", não zero', () => {
    const parsed = parseItemForm({ ...BASE, stockInput: '   ' })

    expect(parsed.ok).toBe(true)
    // Ausente, e não `stockQuantity: 0`: são coisas diferentes, e é o que
    // `getTrackedItems` lê para decidir se o item aparece em /estoque.
    expect(parsed.ok && 'stockQuantity' in parsed.values).toBe(false)
  })

  it('zero é um valor legítimo: controlo, e acabou', () => {
    const parsed = parseItemForm({ ...BASE, stockInput: '0' })

    expect(parsed.ok && parsed.values.stockQuantity).toBe(0)
  })

  it('lê unidades inteiras', () => {
    const parsed = parseItemForm({ ...BASE, stockInput: ' 24 ' })

    expect(parsed.ok && parsed.values.stockQuantity).toBe(24)
  })

  it('recusa o que não é número inteiro, nomeando o campo', () => {
    for (const digitado of ['2,5', '2.5', 'vinte', '1 caixa']) {
      const parsed = parseItemForm({ ...BASE, stockInput: digitado })
      expect(parsed.ok).toBe(false)
      expect(!parsed.ok && parsed.error).toContain('estoque')
    }
  })

  it('deixa o negativo passar pela tela, porque quem recusa é o domínio', () => {
    // A tela só responde "isto é um número inteiro?". Se o número é
    // aceitável quem decide é o repositório, com item-stock-quantity-invalid
    // — a mesma divisão de trabalho do preço e do custo.
    const parsed = parseItemForm({ ...BASE, stockInput: '-3' })

    expect(parsed.ok && parsed.values.stockQuantity).toBe(-3)
  })
})

describe('parseItemForm', () => {
  it('turns typed reais into integer cents', () => {
    const result = parseItemForm({
      ...EMPTY_ITEM_FORM, name: 'Cerveja', priceInput: '12,50', costInput: '7',
    })

    expect(result).toEqual({
      ok: true,
      values: {
        name: 'Cerveja',
        code: '',
        category: '',
        unit: '',
        favorite: false,
        unitPriceCents: 1250,
        unitCostCents: 700,
      },
    })
  })

  it('accepts a dot decimal as well, because a numeric keypad may produce one', () => {
    const result = parseItemForm({ ...EMPTY_ITEM_FORM, priceInput: '12.50', costInput: '0' })

    expect(result.ok && result.values.unitPriceCents).toBe(1250)
  })

  it.each([
    ['an unreadable price', { priceInput: 'abc', costInput: '1' }, /preço/i],
    ['a price with three decimals', { priceInput: '12,555', costInput: '1' }, /preço/i],
    ['an empty price', { priceInput: '', costInput: '1' }, /preço/i],
    ['an unreadable cost', { priceInput: '1', costInput: 'abc' }, /custo/i],
    ['an empty cost', { priceInput: '1', costInput: '' }, /custo/i],
  ])('refuses %s, naming the field', (_name, overrides, expected) => {
    const result = parseItemForm({ ...EMPTY_ITEM_FORM, name: 'Item', ...overrides })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(expected)
  })

  /**
   * The screen reads characters; it does not decide what a price is allowed
   * to be. A blank name and a negative price are both refused by the
   * domain (`item-name-required`, `item-price-invalid`), and this test
   * exists so nobody "helpfully" moves those rules up here.
   */
  it('does not judge a blank name — that is the domain\'s call', () => {
    const result = parseItemForm({ ...EMPTY_ITEM_FORM, name: '', priceInput: '1', costInput: '1' })

    expect(result.ok).toBe(true)
    expect(result.ok && result.values.name).toBe('')
  })
})
