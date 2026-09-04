import type { Locator, Page } from '@playwright/test'

import { formatMonth, formatMonthName, getCurrentMonth } from '../src/shared/date'

/**
 * The demo seed derives its whole timeline, and its active event's name,
 * from the month it is generated in (see demo-seed.ts). These give the
 * specs the same labels without pinning them to a literal month — five of
 * them used to fail on the 1st of the next month with no code change.
 */
export const CURRENT_MONTH_LABEL = formatMonth(getCurrentMonth())
export const ACTIVE_EVENT_NAME = `Encontro de ${formatMonthName(getCurrentMonth())}`

/**
 * The PIN this suite's server is booted with — `playwright.config.ts`'s
 * `webServer.env.BAR_PIN_HASH` is a fresh scrypt hash of this same literal.
 * The one value the config and this file must agree on outside the wire
 * contract itself.
 */
export const E2E_PIN = '246810'

/**
 * Logs the browser context in (`POST /api/session`) and restores the
 * shared server database to its known demo seed (`POST /api/rpc { method:
 * 'resetDemo' }`) — `resetDemo` is an ordinary, already-shipped
 * `BarRepository` method (the same one "Restaurar demonstração" in the
 * app calls), so no test-only endpoint enters production. Call before
 * `page.goto`.
 *
 * Uses `page.request` (Playwright's `APIRequestContext` tied to the
 * page's own browser context — see
 * https://playwright.dev/docs/api/class-page#page-request), which shares
 * cookie storage with the page's own navigations, so the session cookie
 * `POST /api/session` sets lands in the browser before the test's first
 * `page.goto` ever runs.
 *
 * Previously each browser context had its own `localStorage`, so the 7
 * spec files were isolated from each other for free and a `sessionStorage`
 * guard kept `page.addInitScript`'s per-navigation re-run from wiping a
 * test's own mutations. Now every spec talks to the same server, backed by
 * one shared SQLite file (see `playwright.config.ts`'s `webServer.env.
 * BAR_DB_PATH`), so an explicit, one-shot reset before each test's first
 * navigation replaces both jobs: it must run once per test (which calling
 * this function once already guarantees, since nothing here re-runs on
 * navigation), and it must actually undo whatever the previous test left
 * behind on the shared database.
 */
export async function resetDemoDatabase(page: Page): Promise<void> {
  const sessionResponse = await page.request.post('/api/session', { data: { pin: E2E_PIN } })
  if (!sessionResponse.ok()) {
    throw new Error(`e2e login failed: HTTP ${sessionResponse.status()}`)
  }

  const resetResponse = await page.request.post('/api/rpc', {
    data: { method: 'resetDemo', args: [] },
  })
  if (!resetResponse.ok()) {
    throw new Error(`e2e resetDemo failed: HTTP ${resetResponse.status()}`)
  }
}

/**
 * The innermost `<div>` whose subtree contains every one of `matches` —
 * plain strings (substring text) and/or nested locators such as
 * `page.getByRole('button', { name })`. Several screens (comandas,
 * pagamentos, fechamento) repeat unlabelled Card rows with duplicate
 * button names and no list landmark, so a single role/text query cannot
 * tell one row from another. This combines several signals — usually a
 * unique name plus a row-specific button — and returns the most specific
 * container that matches all of them, which in practice is that row's own
 * Card element rather than one of its ancestors.
 */
export function cardMatching(page: Page, matches: readonly (string | Locator)[]): Locator {
  return matches
    .reduce<Locator>(
      (locator, match) =>
        typeof match === 'string' ? locator.filter({ hasText: match }) : locator.filter({ has: match }),
      page.locator('div'),
    )
    .last()
}
