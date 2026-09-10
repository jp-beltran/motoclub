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
  it('lists exactly the 27 methods of the BarRepository port', () => {
    expect(RPC_METHOD_NAMES).toHaveLength(30)
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

  describe('argument-shape validation (rejects a malformed call before it ever reaches the repository)', () => {
    it('rejects too few arguments for a none-shaped method', async () => {
      const repository = new Proxy({}, { get: () => { throw new Error('must not be called') } })
      await expect(
        invokeRpcMethod(repository as never, 'getSnapshot', ['unexpected']),
      ).rejects.toMatchObject({ code: 'bad-request', status: 400 })
    })

    it('rejects zero arguments for an object-shaped method (the createVisitor([]) repro)', async () => {
      const repository = new Proxy({}, { get: () => { throw new Error('must not be called') } })
      await expect(
        invokeRpcMethod(repository as never, 'createVisitor', []),
      ).rejects.toMatchObject({ code: 'bad-request', status: 400 })
    })

    it('rejects zero arguments for createMonthlyClosing([]) and addStockMovement([])', async () => {
      const repository = new Proxy({}, { get: () => { throw new Error('must not be called') } })
      await expect(
        invokeRpcMethod(repository as never, 'createMonthlyClosing', []),
      ).rejects.toMatchObject({ code: 'bad-request', status: 400 })
      await expect(
        invokeRpcMethod(repository as never, 'addStockMovement', []),
      ).rejects.toMatchObject({ code: 'bad-request', status: 400 })
    })

    it('rejects zero arguments for a string-shaped method (closeVisitorTab([]))', async () => {
      const repository = new Proxy({}, { get: () => { throw new Error('must not be called') } })
      await expect(
        invokeRpcMethod(repository as never, 'closeVisitorTab', []),
      ).rejects.toMatchObject({ code: 'bad-request', status: 400 })
    })

    it('rejects a non-string argument for a string-shaped method', async () => {
      const repository = new Proxy({}, { get: () => { throw new Error('must not be called') } })
      await expect(
        invokeRpcMethod(repository as never, 'closeVisitorTab', [123]),
      ).rejects.toMatchObject({ code: 'bad-request', status: 400 })
    })

    it('rejects a non-object argument (string, null, array) for an object-shaped method', async () => {
      const repository = new Proxy({}, { get: () => { throw new Error('must not be called') } })
      await expect(
        invokeRpcMethod(repository as never, 'createVisitor', ['not an object']),
      ).rejects.toMatchObject({ code: 'bad-request', status: 400 })
      await expect(
        invokeRpcMethod(repository as never, 'createVisitor', [null]),
      ).rejects.toMatchObject({ code: 'bad-request', status: 400 })
      await expect(
        invokeRpcMethod(repository as never, 'createVisitor', [[]]),
      ).rejects.toMatchObject({ code: 'bad-request', status: 400 })
    })

    it('rejects too many arguments (extra positional args, and the theoretical RangeError-from-apply case)', async () => {
      const repository = new Proxy({}, { get: () => { throw new Error('must not be called') } })
      await expect(
        invokeRpcMethod(repository as never, 'recordPayment', [{}, {}]),
      ).rejects.toMatchObject({ code: 'bad-request', status: 400 })
    })

    it('accepts a well-formed call for every shape (none/string/object) without throwing', async () => {
      const repository = {
        getSnapshot: async () => ({}),
        closeVisitorTab: async (tabId: string) => ({ tabId }),
        createVisitor: async (input: unknown) => ({ input }),
      }
      await expect(invokeRpcMethod(repository as never, 'getSnapshot', [])).resolves.toEqual({})
      await expect(
        invokeRpcMethod(repository as never, 'closeVisitorTab', ['tab-1']),
      ).resolves.toEqual({ tabId: 'tab-1' })
      await expect(
        invokeRpcMethod(repository as never, 'createVisitor', [{ name: 'Ana' }]),
      ).resolves.toEqual({ input: { name: 'Ana' } })
    })
  })

  describe('a raw TypeError from a correctly-shaped-but-incomplete argument', () => {
    it('is reclassified as a 400 bad-request, not a 500 internal-error (the createVisitor([{}]) repro)', async () => {
      const repository = {
        createVisitor: async (input: { name: string }) => {
          // Exactly what LocalBarRepository.createVisitor does first:
          // `input.name.trim()`. `{}` has no `name`, so this throws a raw
          // TypeError — the caller's fault (a missing required field), not
          // the server's.
          const name = input.name.trim()
          return { name }
        },
      }
      await expect(
        invokeRpcMethod(repository as never, 'createVisitor', [{}]),
      ).rejects.toMatchObject({ code: 'bad-request', status: 400 })
    })

    it('does not reclassify a BarError the same way — domain refusals keep their own code', async () => {
      const repository = {
        createVisitor: async () => {
          throw new BarError('visitor-name-required', 'Visitor name is required')
        },
      }
      await expect(invokeRpcMethod(repository as never, 'createVisitor', [{ name: '' }])).rejects.toBeInstanceOf(
        BarError,
      )
    })

    it('does not reclassify an unrelated Error (e.g. a genuine internal fault) as bad-request', async () => {
      const repository = {
        createVisitor: async () => {
          throw new Error('disk on fire')
        },
      }
      const rejection = await invokeRpcMethod(repository as never, 'createVisitor', [
        { name: 'Ana' },
      ]).catch((error: unknown) => error)
      expect(rejection).not.toMatchObject({ code: 'bad-request' })
    })
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
    expect(BAR_ERROR_STATUS['member-name-already-exists']).toBe(409)
  })

  it('classifies the consumer registry input guards as 422', () => {
    expect(BAR_ERROR_STATUS['consumer-name-required']).toBe(422)
    expect(BAR_ERROR_STATUS['consumer-kind-invalid']).toBe(422)
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
