import { expect, test } from '@playwright/test'

test('renders the prototype home route', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Motoclub' })).toBeVisible()
  await expect(page.getByText('Protótipo em construção')).toBeVisible()
})
