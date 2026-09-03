import { expect, test } from '@playwright/test'

import { resetDemoDatabase } from './test-utils'

/**
 * An entry adds to the running stock, an adjustment can move it either way,
 * and both land in the catalogue's current-stock table and in the
 * movement history — real numbers, not just a submitted form.
 */
test('a stock entry and an adjustment are reflected in the catalogue', async ({ page }) => {
  await resetDemoDatabase(page)
  await page.goto('/estoque')

  const stockTable = page.getByRole('table', { name: 'Estoque atual' })
  const historyTable = page.getByRole('table', { name: 'Histórico de movimentações' })

  await expect(stockTable.getByRole('row', { name: /Cerveja lata/ })).toContainText('42')
  await expect(stockTable.getByRole('row', { name: /Água mineral/ })).toContainText('28')

  // Entry: +10 Cerveja lata, 42 -> 52.
  await page.getByLabel('Entrada').check()
  await page.getByLabel('Item').selectOption({ label: 'Cerveja lata' })
  await page.getByLabel('Quantidade').fill('10')
  await page.getByRole('button', { name: 'Registrar movimentação' }).click()

  await expect(stockTable.getByRole('row', { name: /Cerveja lata/ })).toContainText('52')
  // The seed already has an "Entrada" row for Cerveja lata (+45) and a
  // "Consumo" row too, so pin the new row down by its own quantity as well.
  const entryRow = historyTable.getByRole('row', { name: /Cerveja lata/ }).filter({ hasText: '+10' })
  await expect(entryRow).toContainText('Entrada')
  await expect(entryRow).toContainText('Gestor')

  // Adjustment: -5 Água mineral, 28 -> 23.
  await page.getByLabel('Ajuste').check()
  await expect(page.getByText('Use um valor negativo para reduzir o estoque.')).toBeVisible()
  await page.getByLabel('Item').selectOption({ label: 'Água mineral' })
  await page.getByLabel('Quantidade').fill('-5')
  await page.getByRole('button', { name: 'Registrar movimentação' }).click()

  await expect(stockTable.getByRole('row', { name: /Água mineral/ })).toContainText('23')
  // The seed already has a "Consumo" row for Água mineral (-1), so pin
  // the new row down by its own quantity too.
  const adjustmentRow = historyTable.getByRole('row', { name: /Água mineral/ }).filter({ hasText: '-5' })
  await expect(adjustmentRow).toContainText('Ajuste')

  // Both movements are real persisted data.
  await page.reload()
  await expect(stockTable.getByRole('row', { name: /Cerveja lata/ })).toContainText('52')
  await expect(stockTable.getByRole('row', { name: /Água mineral/ })).toContainText('23')
})
