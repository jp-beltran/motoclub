import { expect, test } from '@playwright/test'

test('renders the dark shell with the demo active event at the dashboard route', async ({
  page,
}) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Painel' })).toBeVisible()
  await expect(page.getByText('Em construção.')).toBeVisible()
  await expect(page.getByText('Encontro de setembro')).toBeVisible()
  await expect(page.getByText('Gestor')).toBeVisible()
})

test('navigates to every area route via the persistent sidebar', async ({ page }) => {
  await page.goto('/')

  const nav = page.getByRole('navigation', { name: 'Navegação principal' })
  await expect(nav.getByRole('link')).toHaveCount(8)

  await nav.getByRole('link', { name: 'Lançamentos' }).click()
  await expect(page).toHaveURL(/\/lancamentos$/)
  await expect(page.getByRole('heading', { name: 'Lançamentos' })).toBeVisible()
})
