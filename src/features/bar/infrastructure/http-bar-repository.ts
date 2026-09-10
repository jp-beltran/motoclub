import type {
  AddStockMovementInput,
  BarDatabase,
  BarRepository,
  CancelConsumptionRepositoryInput,
  CreateConsumptionInput,
  CreateItemInput,
  CreateMonthlyClosingInput,
  CreateVisitorInput,
  EditConsumptionQuantityInput,
  EditConsumptionQuantityResult,
  EnsureEventTabInput,
  EnsureMonthlyTabInput,
  ReassignConsumptionInput,
  RecordPaymentInput,
  SelectActiveEventInput,
  CreateConsumerInput,
  UpdateConsumerInput,
  SetConsumerActiveInput,
  SetItemActiveInput,
  UpdateItemInput,
} from '../application/bar-repository'
import type { CancellationResult, ConsumptionResult } from '../domain/consumption'
import type {
  Consumption,
  Consumer,
  Event,
  EventTab,
  Item,
  MemberStatement,
  MonthlyClosing,
  MonthlyTab,
  Payment,
  StockMovement,
  Tab,
} from '../domain/entities'
import { BarError, type BarErrorCode } from '../domain/errors'
import type { MonthlyConsolidation } from '../domain/monthly-closing'

/**
 * Same origin, relative path — the SPA and the API are served by the same
 * process (see the plan's "Fase 1 → Cliente"), so there is no base URL to
 * configure, only one to hard-code correctly. An `import.meta.env`/`VITE_*`
 * seam here would default to something that happens to work in `vite dev`
 * and silently point nowhere useful once built, which is a defect this
 * adapter must not introduce.
 */
const RPC_ENDPOINT = '/api/rpc'

/** The wire envelope `server/http/rpc.ts` promises: `{ ok: true, result }`
 * on success, `{ ok: false, error: { code } }` on failure. Only `code`
 * crosses the wire — never a message — which is exactly what `BarError`
 * needs to reconstruct itself on this side of the network. */
interface RpcSuccessBody {
  readonly ok: true
  readonly result: unknown
}
interface RpcFailureBody {
  readonly ok: false
  readonly error: { readonly code: string }
}
type RpcResponseBody = RpcSuccessBody | RpcFailureBody

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isRpcResponseBody(value: unknown): value is RpcResponseBody {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false
  if (value.ok) return true
  return isRecord(value.error) && typeof value.error.code === 'string'
}

/**
 * Raised when the server did not answer with the `{ ok, ... }` envelope at
 * all — a dropped connection, a non-JSON body, an HTML error page from
 * something in front of the server. Deliberately **not** a `BarError`:
 * the server never told this adapter a `BarErrorCode`, so inventing one
 * would be a lie the taxonomy exists to prevent. `describeBarError` (see
 * `application/error-messages.ts`) falls through to its generic pt-BR
 * fallback for anything that is not a `BarError` — including this class —
 * so the operator still reads a full sentence, never this message or a
 * stack trace.
 */
export class HttpBarRepositoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HttpBarRepositoryError'
  }
}

/**
 * `BarRepository` over the HTTP server's single RPC endpoint
 * (`server/http/rpc.ts`). One private `call` does the actual request;
 * every port method below is a one-line delegation naming its own RPC
 * method and forwarding its arguments as the `args` array the wire
 * contract expects (`getSnapshot()` sends none, `closeVisitorTab`/
 * `reopenVisitorTab` send a bare string, everything else sends one input
 * object).
 */
export class HttpBarRepository implements BarRepository {
  private async call<Result>(method: string, args: readonly unknown[] = []): Promise<Result> {
    let response: Response
    try {
      response = await fetch(RPC_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, args }),
      })
    } catch {
      throw new HttpBarRepositoryError(`Network failure calling ${method}`)
    }

    // The PIN gate lives entirely on the server (see the plan's "PIN"
    // section): a 401 here means the session cookie is missing or expired,
    // and the only correct client behaviour is to fall back to the
    // server-rendered login page. No UI of our own — just this.
    if (response.status === 401) {
      window.location.reload()
      return new Promise<Result>(() => {})
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new HttpBarRepositoryError(`Malformed response body calling ${method}`)
    }

    if (!isRpcResponseBody(body)) {
      throw new HttpBarRepositoryError(`Unexpected response shape calling ${method}`)
    }

    if (!body.ok) {
      // The same `BarError` class the in-process repository throws, keyed
      // on the same code — this is what lets `describeBarError` and every
      // UI test asserting a refusal keep working unchanged across the
      // wire. The English message never crossed the wire and never will;
      // it only needs to be something readable in a stack trace.
      throw new BarError(body.error.code as BarErrorCode, `Server refused ${method}: ${body.error.code}`)
    }

    return body.result as Result
  }

  async getSnapshot(): Promise<BarDatabase> {
    return this.call('getSnapshot')
  }

  async listConsumers(): Promise<Consumer[]> {
    return this.call('listConsumers')
  }

  async listItems(): Promise<Item[]> {
    return this.call('listItems')
  }

  async listEvents(): Promise<Event[]> {
    return this.call('listEvents')
  }

  async listTabs(): Promise<Tab[]> {
    return this.call('listTabs')
  }

  async listConsumptions(): Promise<Consumption[]> {
    return this.call('listConsumptions')
  }

  async listPayments(): Promise<Payment[]> {
    return this.call('listPayments')
  }

  async listStockMovements(): Promise<StockMovement[]> {
    return this.call('listStockMovements')
  }

  async listMonthlyClosings(): Promise<MonthlyClosing[]> {
    return this.call('listMonthlyClosings')
  }

  async listMemberStatements(): Promise<MemberStatement[]> {
    return this.call('listMemberStatements')
  }

  async resetDemo(): Promise<BarDatabase> {
    return this.call('resetDemo')
  }

  async createVisitor(input: CreateVisitorInput): Promise<Consumer> {
    return this.call('createVisitor', [input])
  }

  async ensureEventTab(input: EnsureEventTabInput): Promise<EventTab> {
    return this.call('ensureEventTab', [input])
  }

  async ensureMonthlyTab(input: EnsureMonthlyTabInput): Promise<MonthlyTab> {
    return this.call('ensureMonthlyTab', [input])
  }

  async selectOrCreateActiveEvent(input: SelectActiveEventInput): Promise<Event> {
    return this.call('selectOrCreateActiveEvent', [input])
  }

  async createConsumption(input: CreateConsumptionInput): Promise<ConsumptionResult> {
    return this.call('createConsumption', [input])
  }

  async cancelConsumption(input: CancelConsumptionRepositoryInput): Promise<CancellationResult> {
    return this.call('cancelConsumption', [input])
  }

  async editConsumptionQuantity(
    input: EditConsumptionQuantityInput,
  ): Promise<EditConsumptionQuantityResult> {
    return this.call('editConsumptionQuantity', [input])
  }

  async reassignConsumption(input: ReassignConsumptionInput): Promise<Consumption> {
    return this.call('reassignConsumption', [input])
  }

  async closeVisitorTab(tabId: string): Promise<EventTab> {
    return this.call('closeVisitorTab', [tabId])
  }

  async reopenVisitorTab(tabId: string): Promise<EventTab> {
    return this.call('reopenVisitorTab', [tabId])
  }

  async recordPayment(input: RecordPaymentInput): Promise<Payment> {
    return this.call('recordPayment', [input])
  }

  async createMonthlyClosing(input: CreateMonthlyClosingInput): Promise<MonthlyConsolidation> {
    return this.call('createMonthlyClosing', [input])
  }

  async addStockMovement(input: AddStockMovementInput): Promise<StockMovement> {
    return this.call('addStockMovement', [input])
  }

  async createConsumer(input: CreateConsumerInput): Promise<Consumer> {
    return this.call('createConsumer', [input])
  }

  async updateConsumer(input: UpdateConsumerInput): Promise<Consumer> {
    return this.call('updateConsumer', [input])
  }

  async setConsumerActive(input: SetConsumerActiveInput): Promise<Consumer> {
    return this.call('setConsumerActive', [input])
  }

  async createItem(input: CreateItemInput): Promise<Item> {
    return this.call('createItem', [input])
  }

  async updateItem(input: UpdateItemInput): Promise<Item> {
    return this.call('updateItem', [input])
  }

  async setItemActive(input: SetItemActiveInput): Promise<Item> {
    return this.call('setItemActive', [input])
  }
}
