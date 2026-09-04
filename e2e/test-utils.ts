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

/** The single localStorage key LocalBarRepository reads and writes. */
export const DEMO_DATABASE_KEY = 'motoclub:bar-database'

/** sessionStorage marker so the reset below only fires once per test. */
const RESET_DONE_FLAG = 'e2e:demo-database-reset-done'

/**
 * Clears the persisted demo database before the app boots, so every test
 * starts from LocalBarRepository's known seed (see
 * src/features/bar/infrastructure/demo-seed.ts) instead of whatever a
 * previous test left behind. Call before `page.goto`.
 *
 * `page.addInitScript` re-runs on *every* navigation in this page — every
 * later `page.goto()` and `page.reload()` too, not just the first load — so
 * a bare `removeItem` would silently wipe every mutation the test makes the
 * moment it navigates again or reloads, which is exactly what a flow needs
 * to prove. sessionStorage persists across reloads and navigations within
 * the same tab (and a fresh Playwright test gets a fresh context, so a
 * fresh sessionStorage too), so it makes a reliable once-per-test guard.
 */
export async function resetDemoDatabase(page: Page): Promise<void> {
  await page.addInitScript(
    ({ storageKey, flagKey }) => {
      if (window.sessionStorage.getItem(flagKey)) return
      window.localStorage.removeItem(storageKey)
      window.sessionStorage.setItem(flagKey, '1')
    },
    { storageKey: DEMO_DATABASE_KEY, flagKey: RESET_DONE_FLAG },
  )
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
