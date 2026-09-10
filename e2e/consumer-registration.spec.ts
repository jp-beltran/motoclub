import { expect, test } from '@playwright/test'

import { CURRENT_MONTH_LABEL, cardMatching, resetDemoDatabase } from './test-utils'

/**
 * The gap the user found by using the app: the system worked beautifully on
 * invented data because there was no way to register the club's real
 * integrantes — "a opção é apenas de visitante".
 *
 * This is that flow end to end, through the real Node server and its
 * SQLite database: register an integrante, launch a consumption for them,
 * and find them in the monthly closing charging exactly what they drank.
 */
test('registers a new integrante, launches consumption and charges them in the closing', async ({
  page,
}) => {
  await resetDemoDatabase(page)
  await page.goto('/consumidores')

  await page.getByRole('button', { name: 'Cadastrar consumidor' }).click()
  const form = page.getByRole('form', { name: 'Cadastrar consumidor' })
  // Integrante is the default; clicking it is the point of the test.
  await form.getByRole('radio', { name: 'Integrante' }).click()
  await form.getByLabel('Nome').fill('Marcos Silva')
  await form.getByLabel('Telefone (opcional)').fill('(11) 90000-0000')
  await form.getByRole('button', { name: 'Cadastrar' }).click()

  const marcosRow = page.getByRole('button', { name: /^Marcos Silva/ })
  await expect(marcosRow).toContainText('Integrante')
  await expect(marcosRow).toContainText('(11) 90000-0000')
  // Registered, and owing nothing yet.
  await expect(marcosRow).toContainText('R$ 0,00')

  // He is a real consumer now: the launch screen offers him like any other
  // integrante, and the first tap opens his monthly tab and charges it.
  await page.goto('/lancamentos')
  await page.getByRole('button', { name: /^Marcos Silva/ }).click()
  await page.getByRole('button', { name: 'Lançar Cerveja lata' }).click()
  await expect(page.getByRole('status')).toContainText('1× Cerveja lata para Marcos Silva')

  // R$ 7,00 of real money: on his own row in /consumidores...
  await page.goto('/consumidores')
  await expect(page.getByRole('button', { name: /^Marcos Silva/ })).toContainText('R$ 7,00')

  // ...and in the closing preview, as a line and as a total.
  await page.goto('/fechamento')
  const marcosPreview = cardMatching(page, ['Marcos Silva', 'Total:'])
  await expect(marcosPreview).toContainText('1× Cerveja lata')
  await expect(marcosPreview).toContainText('Total: R$ 7,00')

  // And it survives a reload, because it is in the database, not the page.
  await page.reload()
  await expect(cardMatching(page, ['Marcos Silva', 'Total:'])).toContainText('Total: R$ 7,00')
})

/**
 * The user's ruling, proved with money that exists: deactivating an
 * integrante who still owes is allowed, and the debt stays visible.
 *
 *  1. gone from /lancamentos — no new consumption can be launched for them;
 *  2. still charged by /fechamento, to the cent;
 *  3. still collectable on /pagamentos, and only a real payment clears it.
 */
test('a deactivated integrante disappears from lançamentos but keeps owing to the cent', async ({
  page,
}) => {
  await resetDemoDatabase(page)

  // An integrante of our own, with one real consumption on his tab.
  await page.goto('/consumidores')
  await page.getByRole('button', { name: 'Cadastrar consumidor' }).click()
  const form = page.getByRole('form', { name: 'Cadastrar consumidor' })
  await form.getByLabel('Nome').fill('Marcos Silva')
  await form.getByRole('button', { name: 'Cadastrar' }).click()
  await expect(page.getByRole('button', { name: /^Marcos Silva/ })).toBeVisible()

  await page.goto('/lancamentos')
  await page.getByRole('button', { name: /^Marcos Silva/ }).click()
  await page.getByRole('button', { name: 'Lançar Espetinho' }).click()
  await expect(page.getByRole('status')).toContainText('1× Espetinho para Marcos Silva')

  // Deactivate him from the register, right under the R$ 12,00 he owes.
  await page.goto('/consumidores')
  await page.getByRole('button', { name: /^Marcos Silva/ }).click()
  const detail = page.getByRole('region', { name: 'Detalhes de Marcos Silva' })
  await expect(detail.getByText('Total em aberto').locator('..')).toContainText('R$ 12,00')
  await expect(detail).toContainText(
    'Os R$ 12,00 em aberto continuam sendo cobrados no fechamento do mês e na tela de ' +
      'pagamentos até serem quitados.',
  )
  await detail.getByRole('button', { name: 'Desativar' }).click()

  // 1. Gone from the launch screen — not even by searching for him.
  await page.goto('/lancamentos')
  await page.getByLabel('Buscar por nome').fill('Marcos')
  await expect(page.getByRole('button', { name: /^Marcos Silva/ })).toHaveCount(0)

  // He is still in the register, marked inactive, still owing R$ 12,00.
  await page.goto('/consumidores')
  const inactiveRow = page.getByRole('button', { name: /^Marcos Silva/ })
  await expect(inactiveRow).toContainText('Inativo')
  await expect(inactiveRow).toContainText('R$ 12,00')

  // 2. The closing still charges him, and freezes it into his statement.
  await page.goto('/fechamento')
  await expect(cardMatching(page, ['Marcos Silva', 'Total:'])).toContainText('Total: R$ 12,00')
  await page.getByRole('button', { name: 'Fechar mês' }).click()
  await page.getByRole('button', { name: 'Confirmar fechamento' }).click()
  await expect(page.getByRole('button', { name: 'Fechar mês' })).toBeDisabled()
  const marcosStatement = cardMatching(page, ['Marcos Silva', 'Restante:'])
  await expect(marcosStatement).toContainText('Total: R$ 12,00')
  await expect(marcosStatement).toContainText('Restante: R$ 12,00')

  // 3. And /pagamentos collects it, from a consumer who is no longer active.
  await page.goto('/pagamentos')
  const marcosRow = cardMatching(page, [`Marcos Silva — ${CURRENT_MONTH_LABEL}`, 'Total'])
  await expect(marcosRow).toContainText('Não pago')
  await expect(marcosRow).toContainText('R$ 12,00')

  await marcosRow.getByRole('button', { name: 'Registrar pagamento' }).click()
  await page.getByLabel('Valor do pagamento').fill('12,00')
  await page.getByRole('button', { name: 'Confirmar pagamento' }).click()

  // Paid in full — and only now does he leave the payments screen. Nothing
  // was ever forgiven; it was collected.
  await expect(
    page.getByText(`Marcos Silva — ${CURRENT_MONTH_LABEL}`),
  ).toHaveCount(0)
  await page.goto('/consumidores')
  await expect(page.getByRole('button', { name: /^Marcos Silva/ })).toContainText('R$ 0,00')
})

/**
 * Global constraint: it has to work on the phone the operator actually
 * holds behind the bar. The register is the newest screen, so it gets the
 * same 390px treatment responsive-smoke.spec.ts gives the launch flow —
 * including the check that nothing pushes the page sideways.
 */
test('phone (390x844): the register works and never scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await resetDemoDatabase(page)
  await page.goto('/consumidores')

  await page.getByRole('button', { name: 'Cadastrar consumidor' }).click()
  const form = page.getByRole('form', { name: 'Cadastrar consumidor' })
  await form.getByRole('radio', { name: 'Visitante' }).click()
  await form.getByLabel('Nome').fill('Marcos Silva')
  await form.getByRole('button', { name: 'Cadastrar' }).click()

  const detail = page.getByRole('region', { name: 'Detalhes de Marcos Silva' })
  await expect(detail).toBeVisible()
  await expect(detail.getByRole('button', { name: 'Desativar' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Marcos Silva/ })).toContainText('Visitante')

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})
