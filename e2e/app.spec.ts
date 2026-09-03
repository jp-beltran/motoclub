import { expect, test } from '@playwright/test'

import { ACTIVE_EVENT_NAME } from './test-utils'

test('renders the dark shell with the demo active event at the dashboard route', async ({
  page,
}) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Painel' })).toBeVisible()
  // The dashboard is a real panel now: these come from the seeded snapshot,
  // so they also prove the repository loaded rather than just the route.
  await expect(page.getByText('Consumo do mês')).toBeVisible()
  await expect(page.getByText('Comandas abertas')).toBeVisible()
  await expect(page.getByText(ACTIVE_EVENT_NAME)).toBeVisible()
  await expect(page.getByText('Gestor')).toBeVisible()
})

test('navigates to every area route via the persistent sidebar', async ({ page }) => {
  await page.goto('/')

  const nav = page.getByRole('navigation', { name: 'Navegação principal' })
  await expect(nav.getByRole('link')).toHaveCount(8)

  await nav.getByRole('link', { name: 'Lançamentos' }).click()
  await expect(page).toHaveURL(/\/lancamentos$/)
  // level 1 is the page title: the launch screen also has an "Últimos
  // lançamentos" h2, which a bare name match resolves to as well.
  await expect(
    page.getByRole('heading', { level: 1, name: 'Lançamentos' }),
  ).toBeVisible()
})
