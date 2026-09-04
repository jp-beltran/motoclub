import { describe, expect, it } from 'vitest'
import { BAR_ERROR_MESSAGES } from '../../src/features/bar/application/error-messages'
import { BarError, type BarErrorCode } from '../../src/features/bar/domain/errors'
import {
  BAR_ERROR_STATUS,
  invokeRpcMethod,
  isRpcMethod,
  RPC_METHOD_NAMES,
  RpcRequestError,
  statusForRpcError,
} from './rpc'

describe('RPC_METHOD_NAMES', () => {
  it('lists exactly the 24 methods of the BarRepository port', () => {
    expect(RPC_METHOD_NAMES).toHaveLength(24)
  })

  it('has no duplicate names', () => {
    expect(new Set(RPC_METHOD_NAMES).size).toBe(RPC_METHOD_NAMES.length)
  })
})

describe('isRpcMethod', () => {
  it('accepts every allowlisted method name', () => {
    for (const name of RPC_METHOD_NAMES) {
      expect(isRpcMethod(name)).toBe(true)
    }
  })

  it('rejects an unknown method name', () => {
    expect(isRpcMethod('deleteEverything')).toBe(false)
  })

  it('rejects a real-but-not-allowlisted property name like constructor', () => {
    expect(isRpcMethod('constructor')).toBe(false)
    expect(isRpcMethod('__proto__')).toBe(false)
    expect(isRpcMethod('toString')).toBe(false)
    expect(isRpcMethod('hasOwnProperty')).toBe(false)
  })
})

describe('invokeRpcMethod', () => {
  it('rejects an unknown method without ever touching the repository', async () => {
    const repository = new Proxy(
      {},
      {
        get() {
          throw new Error('must not read any property off the repository')
        },
      },
    )
    await expect(
      invokeRpcMethod(repository as never, 'deleteEverything', []),
    ).rejects.toBeInstanceOf(RpcRequestError)
  })

  it('rejects a real-but-not-allowlisted property name like constructor', async () => {
    const repository = { getSnapshot: async () => ({}) }
    await expect(invokeRpcMethod(repository as never, 'constructor', [])).rejects.toMatchObject({
      code: 'unknown-method',
    })
  })

  it('calls the allowlisted method with the given args array, preserving `this`', async () => {
    const repository = {
      calls: [] as unknown[],
      async createVisitor(this: { calls: unknown[] }, input: unknown) {
        this.calls.push(input)
        return { id: 'v1', ...(input as object) }
      },
    }
    const result = await invokeRpcMethod(repository as never, 'createVisitor', [{ name: 'Ana' }])
    expect(result).toEqual({ id: 'v1', name: 'Ana' })
    expect(repository.calls).toEqual([{ name: 'Ana' }])
  })

  it('calls a no-argument method with an empty args array', async () => {
    const repository = { getSnapshot: async () => ({ ok: true }) }
    const result = await invokeRpcMethod(repository as never, 'getSnapshot', [])
    expect(result).toEqual({ ok: true })
  })

  it('calls a bare-string-argument method by spreading a single-element args array', async () => {
    const repository = { closeVisitorTab: async (tabId: string) => ({ tabId }) }
    const result = await invokeRpcMethod(repository as never, 'closeVisitorTab', ['tab-1'])
    expect(result).toEqual({ tabId: 'tab-1' })
  })
})

describe('BAR_ERROR_STATUS', () => {
  it('maps every BarErrorCode in the domain taxonomy to an HTTP status', () => {
    const codes = Object.keys(BAR_ERROR_MESSAGES) as BarErrorCode[]
    expect(codes.length).toBeGreaterThan(0)
    for (const code of codes) {
      expect(typeof BAR_ERROR_STATUS[code]).toBe('number')
    }
    // Exhaustiveness is also enforced at compile time by the literal
    // Record<BarErrorCode, number> type in rpc.ts; this proves it at
    // runtime against the same source of truth the client's message table
    // uses, so the two can never silently drift apart in code counts.
    expect(Object.keys(BAR_ERROR_STATUS).length).toBe(codes.length)
  })

  it('classifies the stored-data family and database-mutation-invalid as 500', () => {
    expect(BAR_ERROR_STATUS['stored-data-malformed']).toBe(500)
    expect(BAR_ERROR_STATUS['stored-data-unsupported-version']).toBe(500)
    expect(BAR_ERROR_STATUS['stored-data-invalid']).toBe(500)
    expect(BAR_ERROR_STATUS['database-mutation-invalid']).toBe(500)
  })

  it('classifies the uniqueness family as 409', () => {
    expect(BAR_ERROR_STATUS['monthly-closing-already-exists']).toBe(409)
  })

  it('classifies ordinary domain refusals as 422', () => {
    expect(BAR_ERROR_STATUS['tab-closed']).toBe(422)
    expect(BAR_ERROR_STATUS['event-not-active']).toBe(422)
    expect(BAR_ERROR_STATUS['payment-exceeds-balance']).toBe(422)
    expect(BAR_ERROR_STATUS['consumption-frozen-in-statement']).toBe(422)
    expect(BAR_ERROR_STATUS['monthly-tab-month-mismatch']).toBe(422)
  })

  it('classifies not-found references as 422, not 404 (404 is reserved for unknown routes)', () => {
    expect(BAR_ERROR_STATUS['tab-not-found']).toBe(422)
    expect(BAR_ERROR_STATUS['consumer-not-found']).toBe(422)
  })
})

describe('statusForRpcError', () => {
  it('maps a BarError via BAR_ERROR_STATUS', () => {
    const error = new BarError('payment-exceeds-balance', 'nope')
    expect(statusForRpcError(error)).toEqual({ status: 422, code: 'payment-exceeds-balance' })
  })

  it('maps an RpcRequestError via its own status', () => {
    const error = new RpcRequestError('unknown-method', 400, 'nope')
    expect(statusForRpcError(error)).toEqual({ status: 400, code: 'unknown-method' })
  })

  it('maps any other thrown value to a 500 internal-error', () => {
    expect(statusForRpcError(new Error('boom'))).toEqual({ status: 500, code: 'internal-error' })
    expect(statusForRpcError('boom')).toEqual({ status: 500, code: 'internal-error' })
  })
})
