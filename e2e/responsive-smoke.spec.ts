import { expect, test } from '@playwright/test'

import { resetDemoDatabase } from './test-utils'

/**
 * The same launch-and-check-the-tab flow as member-consumption.spec.ts, run
 * at tablet and phone widths, to prove the persistent sidebar navigation
 * and the comanda panel both still work once the layout switches to its
 * responsive classes (Sidebar.tsx's `md:hidden` hamburger, TabPanel.tsx's
 * `fixed inset-0` full-screen overlay below `md`).
 */
test('tablet (768x1024): navigation and the tab panel work at md breakpoint', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await resetDemoDatabase(page)
  await page.goto('/')

  // At exactly 768px Tailwind's `md:` classes apply, so the nav is already
  // visible without opening the hamburger menu.
  const nav = page.getByRole('navigation', { name: 'Navegação principal' })
  await expect(nav).toBeVisible()
  await nav.getByRole('link', { name: 'Lançamentos' }).click()
  await expect(page).toHaveURL(/\/lancamentos$/)

  await page.getByRole('button', { name: 'Bruno Santos' }).click()
  await page.getByRole('button', { name: 'Lançar Refrigerante' }).click()
  await expect(page.getByRole('status')).toContainText('1× Refrigerante para Bruno Santos')

  await page.getByRole('button', { name: 'Ver comanda' }).click()
  const tabPanel = page.getByRole('complementary', { name: 'Comanda de Bruno Santos' })
  await expect(tabPanel).toBeVisible()
  await expect(tabPanel).toContainText('1× Refrigerante')
  // Seeded: 2× Espetinho (R$ 24,00) + 1× Refrigerante (R$ 6,00) = R$ 30,00.
  await expect(tabPanel.getByText('Total').locator('..')).toContainText('R$ 30,00')
})

test('phone (390x844): the hamburger menu and the tab panel work below md', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await resetDemoDatabase(page)
  await page.goto('/')

  // Below md the nav starts collapsed behind a hamburger button.
  const nav = page.getByRole('navigation', { name: 'Navegação principal' })
  await expect(nav).toBeHidden()
  await page.getByRole('button', { name: 'Abrir menu' }).click()
  await expect(nav).toBeVisible()
  await nav.getByRole('link', { name: 'Lançamentos' }).click()
  await expect(page).toHaveURL(/\/lancamentos$/)

  await page.getByRole('button', { name: 'Célia Martins' }).click()
  await page.getByRole('button', { name: 'Lançar Água mineral' }).click()
  await expect(page.getByRole('status')).toContainText('1× Água mineral para Célia Martins')

  await page.getByRole('button', { name: 'Ver comanda' }).click()
  const tabPanel = page.getByRole('complementary', { name: 'Comanda de Célia Martins' })
  await expect(tabPanel).toBeVisible()
  await expect(tabPanel).toContainText('1× Água mineral')
  // Célia had no prior consumption this month: 1× Água mineral = R$ 4,00.
  await expect(tabPanel.getByText('Total').locator('..')).toContainText('R$ 4,00')
})
