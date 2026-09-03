import { expect, test } from '@playwright/test'

import { CURRENT_MONTH_LABEL, cardMatching, resetDemoDatabase } from './test-utils'

/**
 * Running the monthly closing: the live preview before closing matches each
 * member's seeded consumption, the closing requires an explicit two-step
 * confirmation because it is irreversible (it freezes the month into
 * statements and closes every member's monthly tab, with no reopen path),
 * closing freezes it into per-member statements with a charge message, and
 * — the domain rule this flow has to respect — the closing also closes
 * that month's monthly tabs, so a member can no longer receive new
 * consumption afterwards.
 */
test('closes the month and shows each member charge preview, frozen after closing', async ({
  page,
}) => {
  await resetDemoDatabase(page)
  await page.goto('/fechamento')

  await expect(page.getByRole('heading', { level: 1, name: 'Fechamento' })).toBeVisible()
  await expect(page.getByText('Prévia — nada foi salvo ainda.')).toBeVisible()

  // Ana Paula: 3× Cerveja lata (R$ 7,00) = R$ 21,00. Bruno Santos: 2×
  // Espetinho (R$ 12,00) = R$ 24,00. Célia has no consumption this month
  // and must not appear in the preview at all.
  const anaPreview = cardMatching(page, ['Ana Paula', 'Total:'])
  await expect(anaPreview).toContainText('3× Cerveja lata')
  await expect(anaPreview).toContainText('Total: R$ 21,00')

  const brunoPreview = cardMatching(page, ['Bruno Santos', 'Total:'])
  await expect(brunoPreview).toContainText('2× Espetinho')
  await expect(brunoPreview).toContainText('Total: R$ 24,00')

  await expect(page.getByText('Célia Martins')).toHaveCount(0)

  // The first click on "Fechar mês" only opens an in-place confirmation —
  // it must not perform the closing yet. This is the operator's last
  // chance to back out of an action that is otherwise irreversible.
  await page.getByRole('button', { name: 'Fechar mês' }).click()
  await expect(
    page.getByText(
      `Confirma o fechamento de ${CURRENT_MONTH_LABEL}? Esta ação é irreversível: as comandas ` +
        'mensais dos integrantes serão fechadas e o consumo do mês será congelado em extratos ' +
        'individuais.',
    ),
  ).toBeVisible()
  // Nothing was saved yet: the member preview cards are still the live
  // (unfrozen) preview, not a closed statement — only the "Fechar mês"
  // trigger itself is swapped for the confirm box. Cancelling must return
  // to that exact same preview.
  await expect(page.getByRole('button', { name: 'Confirmar fechamento' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancelar' }).click()
  await expect(page.getByRole('button', { name: 'Fechar mês' })).toBeVisible()
  await expect(page.getByText('Prévia — nada foi salvo ainda.')).toBeVisible()
  await expect(anaPreview).toContainText('Total: R$ 21,00')

  // Now actually confirm it.
  await page.getByRole('button', { name: 'Fechar mês' }).click()
  await page.getByRole('button', { name: 'Confirmar fechamento' }).click()

  // Once closed, the screen shows frozen statements instead of a preview,
  // and closing again is not offered.
  await expect(page.getByText('Prévia — nada foi salvo ainda.')).toHaveCount(0)
  await expect(page.getByText(/Este mês já foi fechado e não pode ser fechado novamente/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Fechar mês' })).toBeDisabled()

  const anaClosed = cardMatching(page, ['Ana Paula', 'Restante:'])
  await expect(anaClosed).toContainText('3× Cerveja lata')
  await expect(anaClosed).toContainText('Total: R$ 21,00')
  await expect(anaClosed).toContainText('Pago: R$ 0,00')
  await expect(anaClosed).toContainText('Restante: R$ 21,00')
  await expect(anaClosed).toContainText('Em aberto')

  const brunoClosed = cardMatching(page, ['Bruno Santos', 'Restante:'])
  await expect(brunoClosed).toContainText('Total: R$ 24,00')
  await expect(brunoClosed).toContainText('Restante: R$ 24,00')

  // Domain rule: closing the month also closes that month's monthly tabs.
  // Ana can no longer receive new consumption — the launch screen must say
  // so instead of letting the operator tap an item.
  await page.goto('/lancamentos')
  await page.getByRole('button', { name: /^Ana Paula/ }).click()
  await expect(page.getByRole('alert')).toContainText('A comanda mensal deste integrante já foi fechada')
  await expect(page.getByRole('button', { name: 'Lançar Cerveja lata' })).toHaveCount(0)

  // The closing itself survives a reload.
  await page.goto('/fechamento')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Fechar mês' })).toBeDisabled()
  await expect(cardMatching(page, ['Ana Paula', 'Restante:'])).toContainText('Total: R$ 21,00')
})
