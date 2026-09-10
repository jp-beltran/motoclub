import { parseCentsInput } from '../../../../shared/format'
import type { Item } from '../../domain/entities'

/**
 * What the item form holds while the operator types: strings, exactly as
 * typed, plus one checkbox. Money lives here as text ("12,50") and becomes
 * integer cents once, in `parseItemForm`, on submit.
 */
export interface ItemFormState {
  readonly name: string
  readonly code: string
  readonly category: string
  readonly unit: string
  readonly priceInput: string
  readonly costInput: string
  readonly favorite: boolean
  /**
   * Contagem inicial de estoque, como digitada. Vazio = este item não tem
   * controle de estoque, que é diferente de "zero". Só vale no CADASTRO: a
   * partir da criação, estoque muda por movimento em `/estoque`, que deixa
   * rastro — por isso `itemToForm` não devolve este campo preenchido.
   */
  readonly stockInput: string
}

export const EMPTY_ITEM_FORM: ItemFormState = {
  name: '',
  code: '',
  category: '',
  unit: '',
  priceInput: '',
  costInput: '',
  favorite: false,
  stockInput: '',
}

/**
 * Cents as an *editable* amount: "7,00", never "R$ 7,00".
 *
 * `formatCents` cannot be reused for this direction, and not for cosmetic
 * reasons: it prints a currency prefix and a thousands separator, and
 * "R$ 1.234,56" is not something `parseCentsInput` accepts back — so
 * pre-filling an edit form with it would make the form refuse its own
 * value. Built by slicing the digit string rather than dividing by 100, so
 * no float takes part in it. The round trip through `parseCentsInput` is
 * asserted in `item-form.test.ts`.
 */
export function formatCentsForInput(cents: number): string {
  const digits = String(cents).padStart(3, '0')
  return `${digits.slice(0, -2)},${digits.slice(-2)}`
}

/** A stored item, loaded back into the form for editing. */
export function itemToForm(item: Item): ItemFormState {
  return {
    name: item.name,
    code: item.code ?? '',
    category: item.category ?? '',
    unit: item.unit ?? '',
    priceInput: formatCentsForInput(item.unitPriceCents),
    costInput: formatCentsForInput(item.unitCostCents),
    favorite: item.favorite ?? false,
    // Editar item nunca mexe em estoque: a contagem existente continua
    // valendo e muda só por movimento registrado.
    stockInput: '',
  }
}

export interface ItemFormValues {
  readonly name: string
  readonly code: string
  readonly category: string
  readonly unit: string
  readonly favorite: boolean
  readonly unitPriceCents: number
  readonly unitCostCents: number
  /** Ausente quando o operador deixou a contagem em branco. */
  readonly stockQuantity?: number
}

export type ParsedItemForm =
  | { readonly ok: true; readonly values: ItemFormValues }
  | { readonly ok: false; readonly error: string }

/**
 * Reads the form. The only judgment made here is whether the characters the
 * operator typed *are* an amount — a formatting question, the same one
 * `parseMovementQuantity` answers for /estoque. Whether that amount is
 * acceptable is not decided here and must never be: a blank name, a
 * negative price and a fractional cost are all refused by the domain
 * (`item-name-required`, `item-price-invalid`, `item-cost-invalid`), whose
 * refusal the screen prints through `describeBarError`.
 */
export function parseItemForm(form: ItemFormState): ParsedItemForm {
  const unitPriceCents = parseCentsInput(form.priceInput)
  if (unitPriceCents === undefined) {
    return { ok: false, error: 'Informe o preço de venda em reais, como 12,50.' }
  }

  const unitCostCents = parseCentsInput(form.costInput)
  if (unitCostCents === undefined) {
    return { ok: false, error: 'Informe o custo em reais, como 7,00.' }
  }

  // Mesma divisão de trabalho do preço: aqui só respondemos "isto é um
  // número inteiro?". Se é um número aceitável (não negativo) quem decide é
  // o domínio, com `item-stock-quantity-invalid`.
  const stockTyped = form.stockInput.trim()
  let stockQuantity: number | undefined
  if (stockTyped !== '') {
    if (!/^-?\d+$/.test(stockTyped)) {
      return { ok: false, error: 'Informe a quantidade em estoque em unidades inteiras, como 24.' }
    }
    stockQuantity = Number(stockTyped)
  }

  return {
    ok: true,
    values: {
      name: form.name,
      code: form.code,
      category: form.category,
      unit: form.unit,
      favorite: form.favorite,
      unitPriceCents,
      unitCostCents,
      ...(stockQuantity === undefined ? {} : { stockQuantity }),
    },
  }
}
