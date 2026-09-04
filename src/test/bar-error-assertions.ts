import { expect } from 'vitest'

import { BarError, type BarErrorCode } from '../features/bar/domain/errors'

/**
 * Asserts that `run` fails with exactly `code`.
 *
 * Tests assert on the code, never on the English `message`: the message is
 * developer detail that may be reworded, the code is the contract a Node
 * backend would have to honour.
 */
export function expectBarErrorCode(run: () => unknown, code: BarErrorCode): void {
  let thrown: unknown
  let threw = false

  try {
    run()
  } catch (error) {
    thrown = error
    threw = true
  }

  expect(threw, `expected a BarError('${code}'), but nothing was thrown`).toBe(true)
  expect(thrown).toBeInstanceOf(BarError)
  expect((thrown as BarError).code).toBe(code)
}

/** The asynchronous counterpart of `expectBarErrorCode`, for repository calls. */
export async function expectRejectedBarErrorCode(
  run: Promise<unknown>,
  code: BarErrorCode,
): Promise<void> {
  const thrown = await run.then(
    () => undefined,
    (error: unknown) => ({ error }),
  )

  expect(thrown, `expected a BarError('${code}'), but the promise resolved`).toBeDefined()
  expect(thrown?.error).toBeInstanceOf(BarError)
  expect((thrown?.error as BarError).code).toBe(code)
}
