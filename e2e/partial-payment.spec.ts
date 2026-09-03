import { expect, test } from '@playwright/test'

import { cardMatching, resetDemoDatabase } from './test-utils'

/**
 * A member's debt is only payable through the statement the monthly
 * closing produces (`target: 'statement'`) — never against the monthly
 * tab itself, which never appears on /pagamentos while open (see
 * pending-targets.ts). So this flow runs the closing first, then pays part
 * of Ana Paula's resulting statement and checks the remaining balance and
 * the "Parcial" status it must leave behind.
 */
test('a partial payment on a member statement leaves the right remaining balance', async ({
  page,
}) => {
  await resetDemoDatabase(page)

  // Closing a month is a two-step confirmation (irreversible: it freezes
  // the month into statements and closes every member's monthly tab), so
  // the trigger click alone does not perform it.
  await page.goto('/fechamento')
  await page.getByRole('button', { name: 'Fechar mês' }).click()
  await page.getByRole('button', { name: 'Confirmar fechamento' }).click()
  await expect(page.getByRole('button', { name: 'Fechar mês' })).toBeDisabled()

  await page.goto('/pagamentos')

  // Only the row's own summary (name, status, Total/Pago/Em aberto) is
  // scoped here — its expanded payment form is a DOM sibling, not a
  // descendant, and only one row can be expanded at a time (PagamentosView
  // keeps a single `expandedKey`), so the form itself is addressed
  // unscoped below without becoming ambiguous.
  const anaRow = cardMatching(page, ['Ana Paula — setembro de 2026', 'Total'])
  await expect(anaRow).toContainText('Não pago')
  await expect(anaRow).toContainText('R$ 21,00')

  await anaRow.getByRole('button', { name: 'Registrar pagamento' }).click()
  await page.getByLabel('Valor do pagamento').fill('10,00')
  await page.getByRole('button', { name: 'Confirmar pagamento' }).click()

  // R$ 21,00 due − R$ 10,00 paid = R$ 11,00 remaining, status "Parcial".
  await expect(anaRow).toContainText('Parcial')
  await expect(anaRow).toContainText('R$ 11,00')
  await expect(anaRow).toContainText('R$ 10,00')
  await expect(page.getByText('Histórico de pagamentos')).toBeVisible()
  await expect(page.getByRole('main').getByText('Gestor')).toBeVisible()

  // The payment is real persisted money, not UI-only state.
  await page.reload()
  const anaRowAfterReload = cardMatching(page, ['Ana Paula — setembro de 2026', 'Total'])
  await expect(anaRowAfterReload).toContainText('Parcial')
  await expect(anaRowAfterReload).toContainText('R$ 11,00')
})
