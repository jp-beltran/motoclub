/**
 * The bar feature's failure taxonomy.
 *
 * Every guard in the domain and in any adapter raises a `BarError` carrying
 * one of these codes. The code — not the English sentence — is the contract
 * that crosses a layer boundary: the application layer translates it into
 * pt-BR (see `application/error-messages.ts`) and nothing downstream ever
 * matches on `error.message`.
 *
 * The codes are deliberately adapter-independent: they name *what the caller
 * did wrong*, not how one storage backend phrased it, so a Node backend can
 * send the same code over the wire and every actionable operator message
 * keeps working without reproducing an English phrase character for
 * character.
 *
 * ## Why this file lives in `domain/`
 *
 * `domain/` is the innermost layer: `application/` and `infrastructure/`
 * already import from it, and it imports from neither. It is therefore the
 * only place a single definition can be shared by the domain guards
 * (`money`, `quantity`, `consumption`, …) and by the adapters
 * (`LocalBarRepository`) without inverting the dependency direction. Putting
 * the union in `application/` next to the message table would force
 * `domain/money.ts` to import from `application/`, which is the layering
 * violation this refactor exists to remove.
 */
export type BarErrorCode =
  // Referências que não existem (ou não existem mais) no banco local.
  | 'consumer-not-found'
  | 'event-not-found'
  | 'item-not-found'
  | 'tab-not-found'
  | 'consumption-not-found'
  | 'payment-target-not-found'
  // Elegibilidade de consumidor e de evento.
  | 'visitor-name-required'
  | 'event-name-required'
  | 'consumer-not-active-member'
  | 'consumer-not-active-visitor'
  | 'event-not-active'
  | 'active-event-required'
  // Ciclo de vida das comandas.
  | 'tab-closed'
  | 'tab-not-visitor-tab'
  | 'monthly-tab-month-mismatch'
  | 'month-format-invalid'
  // Lançamentos de consumo.
  | 'quantity-invalid'
  | 'consumption-quantity-invalid'
  | 'consumption-already-cancelled'
  | 'consumption-not-reassignable'
  | 'consumption-item-mismatch'
  | 'reassign-target-tab-invalid'
  // Cancelamento recusado porque o dinheiro do lançamento já foi lido em
  // outro lugar (ver domain/cancellation.ts).
  | 'consumption-frozen-in-statement'
  | 'consumption-tab-closed'
  | 'consumption-covered-by-payment'
  // Estoque.
  | 'item-stock-not-tracked'
  | 'stock-movement-quantity-invalid'
  | 'stock-entry-quantity-invalid'
  | 'stock-quantity-overflow'
  | 'stock-movement-mismatch'
  | 'consumption-stock-movement-missing'
  // Dinheiro e pagamentos.
  | 'money-amount-invalid'
  | 'money-amount-not-positive'
  | 'money-total-overflow'
  | 'money-product-overflow'
  | 'payment-exceeds-balance'
  | 'monthly-tab-payment-not-allowed'
  // Fechamento mensal.
  | 'monthly-closing-already-exists'
  | 'timestamp-invalid'
  // Persistência: dados guardados que não podem ser lidos ou escritos.
  | 'stored-data-malformed'
  | 'stored-data-unsupported-version'
  | 'stored-data-invalid'
  | 'database-mutation-invalid'

/**
 * The subset of the taxonomy raised while reading or writing the stored bar
 * database. Kept as its own alias so `BarPersistenceError` can narrow to it
 * without declaring a second, parallel code scheme.
 */
export type StoredDataErrorCode = Extract<
  BarErrorCode,
  | 'stored-data-malformed'
  | 'stored-data-unsupported-version'
  | 'stored-data-invalid'
>

/**
 * A failure with a machine-readable `code`.
 *
 * `message` stays the English developer-facing detail it always was — it is
 * what shows up in a stack trace — but it is no longer a contract: nothing
 * outside this class may branch on it.
 */
export class BarError extends Error {
  constructor(
    readonly code: BarErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'BarError'
  }
}

/** Narrows an unknown rejection to the coded taxonomy. */
export function isBarError(error: unknown): error is BarError {
  return error instanceof BarError
}
