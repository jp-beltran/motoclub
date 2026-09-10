import type { BarRepository } from '../../src/features/bar/application/bar-repository'
import { BarError, type BarErrorCode } from '../../src/features/bar/domain/errors'

/**
 * The literal, frozen allowlist of every method `POST /api/rpc` may call.
 *
 * Every method of `BarRepository`, not only the ones the current UI uses:
 * the repository implements every one of them anyway, and narrowing the
 * list to "what the UI happens to call today" would mean reading intent out
 * of `src/`, which this task must not touch. Two independent guards keep
 * this list honest:
 *
 *   1. `RpcMethodName` is declared as `keyof BarRepository`, so a typo here
 *      fails `tsc` immediately (not a name the port has).
 *   2. `AssertNoMissingRpcMethod` below fails `tsc` if the port ever grows a
 *      28th method and this array is not updated to include it — the same
 *      "a new one breaks the build until classified" guarantee the task
 *      asks for on the error-status map.
 *
 * `RPC_METHODS` is typed `ReadonlySet` (TypeScript blocks `.add`/`.delete`
 * at compile time) rather than relying on `Object.freeze`, which does not
 * actually stop `Set.prototype.add` from working — freezing an object only
 * locks its own properties, not the internal slots a Set's methods mutate.
 */
export type RpcMethodName = keyof BarRepository

export const RPC_METHOD_NAMES = [
  'getSnapshot',
  'listConsumers',
  'listItems',
  'listEvents',
  'listTabs',
  'listConsumptions',
  'listPayments',
  'listStockMovements',
  'listMonthlyClosings',
  'listMemberStatements',
  'resetDemo',
  'createVisitor',
  'ensureEventTab',
  'ensureMonthlyTab',
  'selectOrCreateActiveEvent',
  'createConsumption',
  'cancelConsumption',
  'editConsumptionQuantity',
  'reassignConsumption',
  'closeVisitorTab',
  'reopenVisitorTab',
  'recordPayment',
  'createMonthlyClosing',
  'addStockMovement',
  'createConsumer',
  'updateConsumer',
  'setConsumerActive',
  'createItem',
  'updateItem',
  'setItemActive',
] as const satisfies readonly RpcMethodName[]

// Compile-time exhaustiveness: `never` iff every key of BarRepository is
// present in RPC_METHOD_NAMES above. If the port gains a method this array
// does not list, `MissingRpcMethod` becomes a non-empty string-literal
// union and the assignment below fails `tsc` (a string is not assignable
// to `never`), exactly like the task's error-status map fails on a 44th
// unclassified code.
type MissingRpcMethod = Exclude<RpcMethodName, (typeof RPC_METHOD_NAMES)[number]>
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _assertNoMissingRpcMethod: MissingRpcMethod extends never ? true : MissingRpcMethod = true

export const RPC_METHODS: ReadonlySet<RpcMethodName> = new Set(RPC_METHOD_NAMES)

/**
 * Never index the repository with an unchecked string: this is the single
 * choke point every caller of `invokeRpcMethod` goes through, and it is a
 * plain `Set.has` against literal names — no reflection, no prototype
 * walk — so `'constructor'`, `'__proto__'`, `'toString'`,
 * `'hasOwnProperty'` and any other real-but-not-listed property name are
 * rejected exactly like a made-up method name.
 */
export function isRpcMethod(method: string): method is RpcMethodName {
  return (RPC_METHODS as ReadonlySet<string>).has(method)
}

/**
 * An HTTP/RPC-layer failure that is not a `BarError` — malformed request
 * shape, an unknown method, a missing/invalid session. Carries its own
 * status so `statusForRpcError` does not need a second map for these.
 */
export class RpcRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string = code,
  ) {
    super(message)
    this.name = 'RpcRequestError'
  }
}

/** The shape of the single argument a port method expects — `'none'`
 * (`getSnapshot()`), `'string'` (`closeVisitorTab(tabId)`), or `'object'`
 * (everything else). `Record<RpcMethodName, RpcArgShape>` requires every
 * key of `RpcMethodName` (`= keyof BarRepository`), so this table is
 * exhaustive over the port the same way `RPC_METHOD_NAMES` and
 * `BAR_ERROR_STATUS` are: a 25th method fails `tsc` here too, not just in
 * the allowlist. */
type RpcArgShape = 'none' | 'string' | 'object'

const RPC_ARG_SHAPES: Readonly<Record<RpcMethodName, RpcArgShape>> = {
  getSnapshot: 'none',
  listConsumers: 'none',
  listItems: 'none',
  listEvents: 'none',
  listTabs: 'none',
  listConsumptions: 'none',
  listPayments: 'none',
  listStockMovements: 'none',
  listMonthlyClosings: 'none',
  listMemberStatements: 'none',
  resetDemo: 'none',
  createVisitor: 'object',
  ensureEventTab: 'object',
  ensureMonthlyTab: 'object',
  selectOrCreateActiveEvent: 'object',
  createConsumption: 'object',
  cancelConsumption: 'object',
  editConsumptionQuantity: 'object',
  reassignConsumption: 'object',
  closeVisitorTab: 'string',
  reopenVisitorTab: 'string',
  recordPayment: 'object',
  createMonthlyClosing: 'object',
  addStockMovement: 'object',
  createConsumer: 'object',
  updateConsumer: 'object',
  setConsumerActive: 'object',
  createItem: 'object',
  updateItem: 'object',
  setItemActive: 'object',
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validates arity and top-level type before the port is ever called —
 * `{"method":"createVisitor","args":[]}` and
 * `{"method":"createMonthlyClosing","args":[]}` used to reach the
 * repository with `input` literally `undefined`, and whichever field the
 * method dereferenced first (`input.name.trim()`, `input.month`, …) threw
 * a raw `TypeError` that fell through to the generic 500 `internal-error`
 * catch-all — the wrong status for a malformed *request*, and a code
 * outside the `BarErrorCode` taxonomy a typed client has no branch for.
 * This closes the arity half of that gap (and, as a side effect, rejects
 * an absurdly long `args` array before it ever reaches
 * `Function.prototype.apply`, which throws its own `RangeError` past a
 * certain length) directly; the harder half — a correctly-shaped object
 * missing one *required field* deep inside, e.g. `createVisitor({})` —
 * cannot be caught by a shape check this generic without re-deriving each
 * method's own field-level rules from `src/`, so `invokeRpcMethod` closes
 * that half separately, by reclassifying the `TypeError` it produces.
 */
function validateRpcArgs(method: RpcMethodName, args: readonly unknown[]): void {
  const shape = RPC_ARG_SHAPES[method]
  const expectedCount = shape === 'none' ? 0 : 1
  if (args.length !== expectedCount) {
    throw new RpcRequestError(
      'bad-request',
      400,
      `${method} expects ${expectedCount} argument(s), got ${args.length}`,
    )
  }
  if (shape === 'string' && typeof args[0] !== 'string') {
    throw new RpcRequestError('bad-request', 400, `${method}'s argument must be a string`)
  }
  if (shape === 'object' && !isPlainObject(args[0])) {
    throw new RpcRequestError('bad-request', 400, `${method}'s argument must be an object`)
  }
}

/**
 * Calls an allowlisted method on the repository with the given args array.
 *
 * `args` is an array because the port is not arity-uniform: `getSnapshot()`
 * takes nothing, `closeVisitorTab(tabId)` takes a bare string, the rest
 * take one object — see `RPC_METHOD_NAMES`'s source, `bar-repository.ts`.
 * `fn.apply(repository, args)` — not `const fn = repository[method]`
 * followed by a bare `fn(...args)` — is what preserves the `this` binding
 * the class methods rely on: `apply`'s first argument is the receiver, so
 * `repository` is always what `this` resolves to inside the call, exactly
 * as if the method had been invoked as `repository[method](...args)`
 * directly.
 *
 * A raw `TypeError` escaping the call (not a `BarError`, not already an
 * `RpcRequestError`) is reclassified as a 400 `bad-request`: in a pure-JS
 * repository whose only untrusted input is `args` itself, a `TypeError`
 * thrown while handling a request is overwhelmingly a symptom of
 * dereferencing a missing/mis-shaped field on that input (e.g.
 * `createVisitor({})`'s `input.name.trim()`) — the caller's fault, not the
 * server's — and *not* an internal fault masquerading as one: a genuine
 * storage/database failure surfaces as a `BarError` (`stored-data-*`,
 * `database-mutation-invalid`) well before it could reach here as a bare
 * `TypeError`, and any other `Error` this call throws is left alone,
 * still falling through to `statusForRpcError`'s 500 default.
 */
export async function invokeRpcMethod(
  repository: BarRepository,
  method: string,
  args: readonly unknown[],
): Promise<unknown> {
  if (!isRpcMethod(method)) {
    throw new RpcRequestError('unknown-method', 400, `Unknown RPC method: ${method}`)
  }
  validateRpcArgs(method, args)
  const fn = repository[method] as (...callArgs: unknown[]) => Promise<unknown>
  try {
    return await fn.apply(repository, args as unknown[])
  } catch (error) {
    if (error instanceof TypeError) {
      throw new RpcRequestError(
        'bad-request',
        400,
        `${method}'s argument is missing something it needs: ${error.message}`,
      )
    }
    throw error
  }
}

/**
 * Exhaustive `Record<BarErrorCode, number>` — adding a 47th code to the
 * domain taxonomy without adding a line here fails `tsc`, the same
 * guarantee `application/error-messages.ts` gives the pt-BR message table.
 *
 * Categories, per the approved plan:
 *   - 422 for domain refusals: closed tabs, inactive events, a payment
 *     that exceeds what is owed, a blocked cancellation, a month mismatch,
 *     an invalid quantity or money amount, and — deliberately, since this
 *     is an RPC surface and not a REST resource tree — every "referenced
 *     id does not exist" code (`*-not-found`). 404 here is reserved for an
 *     unknown HTTP route, never for a domain reference miss.
 *   - 409 for the uniqueness/idempotency family
 *     (`monthly-closing-already-exists`).
 *   - 500 for the four stored-data codes: `stored-data-malformed`,
 *     `stored-data-unsupported-version`, `stored-data-invalid`, and
 *     `database-mutation-invalid`. These are local-adapter/corruption
 *     failures — the repository itself already rewraps a money invariant
 *     broken by *stored* rows into `stored-data-invalid` before it ever
 *     reaches this map (see `readStoredMoney` in
 *     `local-bar-repository.ts`) — so a server must not answer 4xx for
 *     them, it must answer 500.
 *
 * Two codes worth flagging explicitly (verified in the domain source, not
 * assumed):
 *   - `quantity-invalid` is raised only by
 *     `domain/quantity.ts#assertPositiveIntegerQuantity`, which
 *     `domain/consumption.ts#recordConsumption` calls — but
 *     `LocalBarRepository.recordConsumption` pre-checks the same
 *     "positive safe integer" rule itself and raises
 *     `consumption-quantity-invalid` first (see
 *     `local-bar-repository.ts` around the `recordConsumption` method),
 *     so `quantity-invalid` can never actually surface through
 *     `BarRepository`. It still needs a row here for the `Record` to
 *     type-check; classified identically to `consumption-quantity-invalid`
 *     (422) so that if a future direct-domain entry point ever does
 *     surface it, its classification is already consistent rather than a
 *     guess made blind.
 *   - `tab-not-found` is raised by `reassignConsumption` for *both* the
 *     source and the target tab (`local-bar-repository.ts`'s
 *     `reassignConsumption`, `findById(..., 'tab-not-found', 'Source
 *     tab')` / `'Target tab'`) — the two cases differ only in the English
 *     `message`, which never crosses the wire in this contract (codes,
 *     not messages). Both map to the same 422 here; nothing further to do
 *     at this layer since the code alone cannot disambiguate which id was
 *     wrong, and disambiguating would mean the server inventing a second
 *     code the domain does not have.
 */
export const BAR_ERROR_STATUS: Readonly<Record<BarErrorCode, number>> = {
  // Referências que não existem no banco local — 422, não 404: 404 fica só
  // para rota desconhecida (ver o comentário acima).
  'consumer-not-found': 422,
  'event-not-found': 422,
  'item-not-found': 422,
  'tab-not-found': 422,
  'consumption-not-found': 422,
  'payment-target-not-found': 422,

  // Elegibilidade de consumidor e de evento.
  'visitor-name-required': 422,
  'event-name-required': 422,
  'consumer-not-active-member': 422,
  'consumer-not-active-visitor': 422,
  'event-not-active': 422,
  'active-event-required': 422,

  // Ciclo de vida das comandas.
  'tab-closed': 422,
  'tab-not-visitor-tab': 422,
  'monthly-tab-month-mismatch': 422,
  'month-format-invalid': 422,

  // Lançamentos de consumo.
  'quantity-invalid': 422,
  'consumption-quantity-invalid': 422,
  'consumption-already-cancelled': 422,
  'consumption-not-reassignable': 422,
  'consumption-item-mismatch': 422,
  'reassign-target-tab-invalid': 422,
  'consumption-frozen-in-statement': 422,
  'consumption-tab-closed': 422,
  'consumption-covered-by-payment': 422,

  // Estoque.
  'item-stock-not-tracked': 422,
  'stock-movement-quantity-invalid': 422,
  'stock-entry-quantity-invalid': 422,
  'stock-quantity-overflow': 422,
  'stock-movement-mismatch': 422,
  'consumption-stock-movement-missing': 422,

  // Dinheiro e pagamentos — validação de entrada do operador, ainda 422:
  // a variante que envolve dado *guardado* corrompido já chega aqui como
  // `stored-data-invalid` (ver `readStoredMoney`), nunca com um destes
  // quatro códigos.
  'money-amount-invalid': 422,
  'money-amount-not-positive': 422,
  'money-total-overflow': 422,
  'money-product-overflow': 422,
  'payment-exceeds-balance': 422,
  'monthly-tab-payment-not-allowed': 422,

  // Fechamento mensal.
  'monthly-closing-already-exists': 409,
  'timestamp-invalid': 422,

  // Persistência: dado guardado corrompido, nunca 4xx.
  'stored-data-malformed': 500,
  'stored-data-unsupported-version': 500,
  'stored-data-invalid': 500,
  'database-mutation-invalid': 500,

  // Cadastro de consumidores: validação de entrada do operador (422), e a
  // unicidade do nome de integrante na mesma família 409 de
  // `monthly-closing-already-exists` — o pedido não é malformado, ele
  // conflita com uma linha que já existe.
  'consumer-name-required': 422,
  'consumer-kind-invalid': 422,
  'member-name-already-exists': 409,
  // Cadastro de itens — recusa de domínio sobre o que o cliente mandou
  // (nome vazio, preço/custo negativo ou fracionário), então 422 como as
  // outras validações de entrada.
  'item-name-required': 422,
  'item-price-invalid': 422,
  'item-cost-invalid': 422,
  'item-stock-quantity-invalid': 422,
}

/** Resolves any thrown value to the `{ status, code }` pair the wire sends. */
export function statusForRpcError(error: unknown): { status: number; code: string } {
  if (error instanceof BarError) {
    return { status: BAR_ERROR_STATUS[error.code], code: error.code }
  }
  if (error instanceof RpcRequestError) {
    return { status: error.status, code: error.code }
  }
  return { status: 500, code: 'internal-error' }
}
