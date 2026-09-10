import { expect, test } from '@playwright/test'

import { resetDemoDatabase } from './test-utils'

/**
 * The whole reason /itens exists: register what the club actually sells, at
 * the club's own price, and be able to change that price later without
 * touching money already charged.
 *
 * The last two thirds of this spec are the money guarantee, seen from the
 * screen instead of from a unit test: a launch made at R$ 7,00 still reads
 * R$ 7,00 after the item goes to R$ 9,00, across a reload, on the real
 * server with the real SQLite database behind it.
 */
test('registers an item, sells it, reprices it, and leaves the sale untouched', async ({ page }) => {
  await resetDemoDatabase(page)
  await page.goto('/itens')

  const activeItems = page.getByRole('table', { name: 'Itens ativos' })

  // --- Register the real item, price and cost in reais with a comma.
  await page.getByLabel('Nome', { exact: true }).fill('Cerveja artesanal')
  await page.getByLabel('Código', { exact: true }).fill('BEV-900')
  await page.getByLabel('Categoria', { exact: true }).fill('Bebidas')
  await page.getByLabel('Unidade', { exact: true }).fill('garrafa')
  await page.getByLabel('Preço de venda (R$)', { exact: true }).fill('7,00')
  await page.getByLabel('Custo (R$)', { exact: true }).fill('3,50')
  await page.getByRole('button', { name: 'Cadastrar item' }).click()

  const newRow = activeItems.getByRole('row', { name: /Cerveja artesanal/ })
  await expect(newRow).toContainText('BEV-900')
  await expect(newRow).toContainText('R$ 7,00')
  await expect(newRow).toContainText('R$ 3,50')
  // 700 sale, 350 cost -> 50,0% margin, computed from the stored cents.
  await expect(newRow).toContainText('50,0%')
  // Persisted on the server, not just in this tab.
  await page.reload()
  await expect(activeItems.getByRole('row', { name: /Cerveja artesanal/ }))
    .toContainText('R$ 7,00')

  // --- Sell one at R$ 7,00.
  await page.goto('/lancamentos')
  await page.getByRole('button', { name: /^Ana Paula/ }).click()
  await page.getByRole('button', { name: 'Lançar Cerveja artesanal' }).click()

  const history = page.getByRole('region', { name: 'Últimos lançamentos' })
  const sale = history.locator('li').filter({ hasText: 'Cerveja artesanal' })
  await expect(sale).toContainText('1× Cerveja artesanal')
  await expect(sale).toContainText('R$ 7,00')

  // --- Reprice the item to R$ 9,00.
  await page.goto('/itens')
  await page.getByRole('button', { name: 'Editar Cerveja artesanal' }).click()
  // The form comes back pre-filled with the stored cents, as an editable
  // amount — not as "R$ 7,00", which it would then refuse to parse.
  await expect(page.getByLabel('Preço de venda (R$)', { exact: true })).toHaveValue('7,00')
  await page.getByLabel('Preço de venda (R$)', { exact: true }).fill('9,00')
  await page.getByRole('button', { name: 'Salvar item' }).click()

  await expect(activeItems.getByRole('row', { name: /Cerveja artesanal/ }))
    .toContainText('R$ 9,00')

  // --- THE POINT: the sale already recorded is still R$ 7,00.
  await page.goto('/lancamentos')
  const saleAfter = page.getByRole('region', { name: 'Últimos lançamentos' })
    .locator('li').filter({ hasText: 'Cerveja artesanal' })
  await expect(saleAfter).toContainText('R$ 7,00')
  await expect(saleAfter).not.toContainText('R$ 9,00')

  // And it survives a reload, so this is the stored consumption talking and
  // not a stale render.
  await page.reload()
  const saleReloaded = page.getByRole('region', { name: 'Últimos lançamentos' })
    .locator('li').filter({ hasText: 'Cerveja artesanal' })
  await expect(saleReloaded).toContainText('R$ 7,00')

  // The next sale, though, does use the new price — otherwise the edit would
  // be merely ignored and this spec would pass for the wrong reason.
  await page.getByRole('button', { name: /^Ana Paula/ }).click()
  await page.getByRole('button', { name: 'Lançar Cerveja artesanal' }).click()
  await expect(
    page.getByRole('region', { name: 'Últimos lançamentos' })
      .locator('li').filter({ hasText: 'Cerveja artesanal' })
      .filter({ hasText: 'R$ 9,00' }),
  ).toHaveCount(1)
})

/**
 * Taking a product out of the catalogue must stop it being sold again
 * without erasing what it already sold.
 */
test('a deactivated item leaves the launch screen and stays in the history', async ({ page }) => {
  await resetDemoDatabase(page)
  await page.goto('/lancamentos')

  // Sell one "Cerveja lata" from the seed first, so there is history to keep.
  await page.getByRole('button', { name: /^Ana Paula/ }).click()
  await page.getByRole('button', { name: 'Lançar Cerveja lata' }).click()
  const history = page.getByRole('region', { name: 'Últimos lançamentos' })
  await expect(history.locator('li').filter({ hasText: 'Cerveja lata' }).first())
    .toContainText('R$ 7,00')

  await page.goto('/itens')
  await page.getByRole('button', { name: 'Desativar Cerveja lata' }).click()

  const inactiveItems = page.getByRole('table', { name: 'Itens inativos' })
  await expect(inactiveItems.getByRole('row', { name: /Cerveja lata/ })).toBeVisible()

  // Gone from the launch grid...
  await page.goto('/lancamentos')
  await page.getByRole('button', { name: /^Ana Paula/ }).click()
  await expect(page.getByRole('button', { name: 'Lançar Cerveja lata' })).toHaveCount(0)
  // ...and still on the record, at the price it was sold for.
  await expect(page.getByRole('region', { name: 'Últimos lançamentos' })
    .locator('li').filter({ hasText: 'Cerveja lata' }).first())
    .toContainText('R$ 7,00')

  // Reactivating puts it back on sale.
  await page.goto('/itens')
  await page.getByRole('button', { name: 'Reativar Cerveja lata' }).click()
  await page.goto('/lancamentos')
  await page.getByRole('button', { name: /^Ana Paula/ }).click()
  await expect(page.getByRole('button', { name: 'Lançar Cerveja lata' })).toBeVisible()
})

/**
 * The domain refuses, the screen reports. Nothing about what a price may be
 * is decided in the browser.
 */
test('refuses an item with no name, in pt-BR, without creating anything', async ({ page }) => {
  await resetDemoDatabase(page)
  await page.goto('/itens')

  await page.getByLabel('Preço de venda (R$)', { exact: true }).fill('5,00')
  await page.getByLabel('Custo (R$)', { exact: true }).fill('2,00')
  await page.getByRole('button', { name: 'Cadastrar item' }).click()

  await expect(page.getByRole('alert')).toContainText('Informe o nome do item.')

  // An unreadable price is named as such, and still nothing is created.
  await page.getByLabel('Nome', { exact: true }).fill('Item torto')
  await page.getByLabel('Preço de venda (R$)', { exact: true }).fill('abc')
  await page.getByRole('button', { name: 'Cadastrar item' }).click()
  await expect(page.getByRole('alert')).toContainText(/preço de venda/i)

  await page.reload()
  await expect(page.getByRole('row', { name: /Item torto/ })).toHaveCount(0)
})

/**
 * The registration is done standing at the bar, on a phone. The form is one
 * column at 390px and the page must not scroll sideways — the item table is
 * wide, so it scrolls inside its own container, which is the pattern
 * /estoque and /itens already used before there was a form above them.
 */
test('phone (390x844): registers an item without the page scrolling sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await resetDemoDatabase(page)
  await page.goto('/itens')

  await page.getByLabel('Nome', { exact: true }).fill('Energético')
  await page.getByLabel('Preço de venda (R$)', { exact: true }).fill('10,00')
  await page.getByLabel('Custo (R$)', { exact: true }).fill('4,50')
  await page.getByRole('button', { name: 'Cadastrar item' }).click()

  await expect(page.getByRole('table', { name: 'Itens ativos' })
    .getByRole('row', { name: /Energético/ })).toContainText('R$ 10,00')

  // The document itself never overflows horizontally; only the table's own
  // scroll container may.
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
})

/**
 * The restore is a development affordance and must not be reachable on the
 * built artefact this suite serves — the same artefact the notebook runs.
 * `resetDemoDatabase` above still restores the seed through the RPC method,
 * which is exactly the split: the method stays, the button does not.
 */
test('offers no "Restaurar demonstração" button in the production build', async ({ page }) => {
  await resetDemoDatabase(page)
  await page.goto('/')

  await expect(page.getByRole('button', { name: 'Restaurar demonstração' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Tutorial' })).toBeVisible()
})
