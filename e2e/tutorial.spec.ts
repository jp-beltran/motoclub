import { expect, test } from '@playwright/test'

import { resetDemoDatabase } from './test-utils'

/**
 * The only spec that asks `resetDemoDatabase` for a browser which has never
 * seen the tutorial (`tutorialSeen: false`); every other spec takes the
 * default, so its balloon never floats over their assertions. See the
 * option's own note in test-utils.ts.
 */
test('opens itself on a first visit, walks the steps, and stays closed after the X', async ({
  page,
}) => {
  await resetDemoDatabase(page, { tutorialSeen: false })
  await page.goto('/')

  const balloon = page.getByRole('dialog')
  await expect(balloon).toBeVisible()
  await expect(balloon).toContainText('Passo 1 de 9')

  // Each step takes the operator to the screen it is explaining, so they
  // never have to guess which menu item was meant.
  await balloon.getByRole('button', { name: 'Próximo' }).click()
  await expect(page).toHaveURL(/\/lancamentos$/)
  await expect(balloon).toContainText('Passo 2 de 9')

  await balloon.getByRole('button', { name: 'Próximo' }).click()
  await expect(page).toHaveURL(/\/comandas$/)
  await expect(balloon).toContainText('Passo 3 de 9')

  await balloon.getByRole('button', { name: 'Anterior' }).click()
  await expect(page).toHaveURL(/\/lancamentos$/)
  await expect(balloon).toContainText('Passo 2 de 9')

  await balloon.getByRole('button', { name: 'Fechar tutorial' }).click()
  await expect(balloon).toBeHidden()

  // Closing remembers itself in this browser: a reload must not bring the
  // tutorial back on top of an operator who already dismissed it.
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Lançamentos' })).toBeVisible()
  await expect(page.getByRole('dialog')).toBeHidden()

  // And the button is always there for anyone who wants it again.
  await page.getByRole('button', { name: 'Tutorial' }).click()
  await expect(page.getByRole('dialog')).toContainText('Passo 1 de 9')
})

/**
 * The bar's notebook is small and the balloon is a `fixed` box placed
 * against its target's left edge — the one thing that could push the layout
 * wider than the screen and hand the operator a horizontal scrollbar
 * mid-service.
 */
test('phone (390x844): the balloon fits the screen without scrolling sideways', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await resetDemoDatabase(page, { tutorialSeen: false })
  await page.goto('/')

  const balloon = page.getByRole('dialog')
  await expect(balloon).toBeVisible()

  const box = await balloon.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(scrollWidth).toBeLessThanOrEqual(390)

  // Still operable at that width: the X is a real 44px touch target.
  const closeBox = await balloon.getByRole('button', { name: 'Fechar tutorial' }).boundingBox()
  expect(closeBox).not.toBeNull()
  expect(closeBox!.height).toBeGreaterThanOrEqual(44)

  await balloon.getByRole('button', { name: 'Fechar tutorial' }).click()
  await expect(balloon).toBeHidden()
})
