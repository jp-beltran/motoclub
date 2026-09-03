import { expect, test } from '@playwright/test'

import { cardMatching, resetDemoDatabase } from './test-utils'

/**
 * A walk-in visitor: register them on the spot from the launch screen, tap
 * two consumptions onto the event tab that gets opened automatically, then
 * close that tab from /comandas and confirm its summary — total, paid and
 * remaining — is still readable once closed.
 */
test('registers a visitor, launches consumption, closes the tab and keeps its summary', async ({
  page,
}) => {
  await resetDemoDatabase(page)
  await page.goto('/lancamentos')

  await page.getByRole('button', { name: 'Novo visitante' }).click()
  const form = page.getByRole('form', { name: 'Novo visitante' })
  await form.getByLabel('Nome').fill('Marcos Silva')
  await form.getByRole('button', { name: 'Cadastrar visitante' }).click()

  // The freshly created visitor is selected automatically, so the launch
  // screen jumps straight to the item step for them.
  await expect(page.getByText('Lançando para')).toBeVisible()
  await expect(page.getByText('Marcos Silva')).toBeVisible()

  // No event tab exists yet for this visitor: the first tap both opens it
  // and records the consumption.
  await page.getByRole('button', { name: 'Lançar Cerveja lata' }).click()
  await expect(page.getByRole('status')).toContainText('1× Cerveja lata para Marcos Silva')
  await page.getByRole('button', { name: 'Lançar Espetinho' }).click()
  await expect(page.getByRole('status')).toContainText('1× Espetinho para Marcos Silva')

  await page.getByRole('button', { name: 'Ver comanda' }).click()
  const tabPanel = page.getByRole('complementary', { name: 'Comanda de Marcos Silva' })
  await expect(tabPanel).toContainText('1× Cerveja lata')
  await expect(tabPanel).toContainText('1× Espetinho')
  // 1× Cerveja lata (R$ 7,00) + 1× Espetinho (R$ 12,00) = R$ 19,00, all unpaid.
  await expect(tabPanel).toContainText('R$ 19,00')
  await expect(tabPanel.getByText('Em aberto').locator('..')).toContainText('R$ 19,00')

  await page.goto('/comandas')
  const marcosCard = cardMatching(page, [
    'Marcos Silva',
    page.getByRole('button', { name: 'Fechar comanda' }),
  ])
  await expect(marcosCard).toContainText('Aberta')
  await expect(marcosCard).toContainText('R$ 19,00')

  await marcosCard.getByRole('button', { name: 'Fechar comanda' }).click()
  await expect(marcosCard).toContainText('Confirma o fechamento desta comanda? O total registrado é R$ 19,00.')
  await marcosCard.getByRole('button', { name: 'Confirmar fechamento' }).click()

  // The closed tab still shows its full preserved summary, not an empty one.
  const closedCard = cardMatching(page, ['Marcos Silva', page.getByRole('button', { name: 'Reabrir comanda' })])
  await expect(closedCard).toContainText('Fechada')
  await expect(closedCard).toContainText('1× Cerveja lata')
  await expect(closedCard).toContainText('1× Espetinho')
  await expect(closedCard).toContainText('R$ 19,00')
  await expect(closedCard).toContainText('Saldo em aberto: R$ 19,00')

  // The closing survives a reload too.
  await page.reload()
  const reloadedCard = cardMatching(page, ['Marcos Silva', page.getByRole('button', { name: 'Reabrir comanda' })])
  await expect(reloadedCard).toContainText('Fechada')
  await expect(reloadedCard).toContainText('R$ 19,00')
})
