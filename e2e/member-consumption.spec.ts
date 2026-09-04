import { expect, test } from '@playwright/test'

import { resetDemoDatabase } from './test-utils'

/**
 * Speed acceptance flow (constraint 13): an existing member with an active
 * event picks up in two clicks (consumer, then item) and every consumption
 * after that in one click, without losing the selected consumer. Also
 * proves the resulting tab and stock changes are the repository's real
 * money — not just a rendered confirmation — by reading them back from the
 * comanda panel and the estoque screen, including after a reload.
 */
test('registers two consumptions for an existing member and updates tab and stock', async ({
  page,
}) => {
  await resetDemoDatabase(page)
  await page.goto('/lancamentos')

  // Click 1: pick the consumer. Água mineral has no prior consumption for
  // Ana Paula in the seed, so its tab line and stock delta are unambiguous.
  await page.getByRole('button', { name: /^Ana Paula/ }).click()
  await expect(
    page.getByRole('heading', { level: 2, name: 'O que foi consumido?' }),
  ).toBeVisible()

  // Click 2: tap the item. This is the whole first consumption.
  await page.getByRole('button', { name: 'Lançar Água mineral' }).click()
  await expect(page.getByRole('status')).toContainText('1× Água mineral para Ana Paula')

  // The consumer selection must survive the launch, so the second
  // consumption for the same member costs exactly one click.
  await expect(page.getByRole('heading', { level: 2, name: 'O que foi consumido?' })).toBeVisible()
  await page.getByRole('button', { name: 'Lançar Água mineral' }).click()
  await expect(page.getByRole('status')).toContainText('1× Água mineral para Ana Paula')

  // The tab now carries both new units on top of the seeded consumption.
  await page.getByRole('button', { name: 'Ver comanda' }).click()
  const tabPanel = page.getByRole('complementary', { name: 'Comanda de Ana Paula' })
  await expect(tabPanel).toBeVisible()
  await expect(tabPanel).toContainText('2× Água mineral')
  await expect(tabPanel).toContainText('R$ 8,00')
  // Seeded: 3× Cerveja lata (R$ 21,00) + 2× Água mineral (R$ 8,00) = R$ 29,00.
  await expect(tabPanel.getByText('Total').locator('..')).toContainText('R$ 29,00')

  // Stock for Água mineral dropped from the seeded 28 to 26.
  await page.goto('/estoque')
  const stockTable = page.getByRole('table', { name: 'Estoque atual' })
  const stockRow = stockTable.getByRole('row', { name: /Água mineral/ })
  await expect(stockRow).toContainText('26')

  // The change is real persisted data, not client-only state: it survives
  // a hard reload of the page.
  await page.reload()
  await expect(stockTable.getByRole('row', { name: /Água mineral/ })).toContainText('26')
})
