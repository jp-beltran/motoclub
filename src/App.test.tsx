import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CURRENT_ACTOR_NAME } from './features/bar/application/actor'
import type { StorageLike } from './features/bar/application/bar-repository'
import { isBarError } from './features/bar/domain/errors'
import { LocalBarRepository } from './features/bar/infrastructure/local-bar-repository'
import { formatMonth, formatMonthName, getCurrentMonth } from './shared/date'
import { App } from './App'

// The demo seed derives its whole timeline — and the active event's name —
// from whichever month the suite runs in, so these are derived too rather
// than pinned to the month the seed was first written in.

/** The same in-memory `StorageLike` the repository's own tests use (see
 * `local-bar-repository.test.ts`) — a `Map` behind `getItem`/`setItem`,
 * nothing browser-specific. */
class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('App', () => {
  let repository: LocalBarRepository

  beforeEach(() => {
    repository = new LocalBarRepository({
      storage: new MemoryStorage(),
      nextId: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
    })

    /**
     * `App` now wires `HttpBarRepository`, which calls `POST /api/rpc`
     * (see `src/App.tsx` and `http-bar-repository.ts`). This stubs
     * `fetch` to dispatch that exact wire request into an in-process
     * `LocalBarRepository` over the `MemoryStorage` above — the same
     * `{ method, args }` request body `HttpBarRepository` serializes, and
     * the same `{ ok: true, result }` / `{ ok: false, error: { code } }`
     * envelope the real server sends back. This keeps the test's original
     * meaning ("the real wiring boots and renders the seeded demo")
     * while now also exercising `HttpBarRepository`'s own request/response
     * handling, unlike a mock repository would.
     */
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (!url.endsWith('/api/rpc') || init?.method !== 'POST') {
        throw new Error(`Unexpected fetch in App.test.tsx: ${init?.method ?? 'GET'} ${url}`)
      }
      const { method, args } = JSON.parse(String(init.body)) as {
        method: string
        args: readonly unknown[]
      }
      try {
        const fn = repository[method as keyof LocalBarRepository] as (
          ...callArgs: unknown[]
        ) => Promise<unknown>
        const result = await fn.apply(repository, args as unknown[])
        return jsonResponse(200, { ok: true, result })
      } catch (error) {
        const code = isBarError(error) ? error.code : 'internal-error'
        return jsonResponse(422, { ok: false, error: { code } })
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the dark shell with the demo active event at the default route', async () => {
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Painel' })).toBeInTheDocument()
    expect(screen.getByText(formatMonth(getCurrentMonth()))).toBeInTheDocument()

    const nav = screen.getByRole('navigation', { name: 'Navegação principal' })
    expect(nav.querySelectorAll('a')).toHaveLength(8)

    expect(
      screen.getByText(`Encontro de ${formatMonthName(getCurrentMonth())}`),
    ).toBeInTheDocument()
    expect(screen.getByText(CURRENT_ACTOR_NAME)).toBeInTheDocument()
  })
})
