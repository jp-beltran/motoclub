import { describe, expect, it } from 'vitest'

import { TUTORIAL_STEPS } from './tutorial-steps'

/** The 8 routes AppRouter serves (src/app/AppRouter.tsx). */
const APP_ROUTES = [
  '/',
  '/lancamentos',
  '/consumidores',
  '/itens',
  '/comandas',
  '/fechamento',
  '/pagamentos',
  '/estoque',
]

describe('TUTORIAL_STEPS', () => {
  it('walks the operator through the night in operating order', () => {
    expect(TUTORIAL_STEPS.map(({ route }) => route)).toEqual([
      '/',
      '/lancamentos',
      '/comandas',
      '/consumidores',
      '/itens',
      '/estoque',
      '/pagamentos',
      '/fechamento',
      undefined,
    ])
  })

  it('gives every step a unique id', () => {
    const ids = TUTORIAL_STEPS.map(({ id }) => id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every step a short title and a body to read', () => {
    for (const { id, title, body } of TUTORIAL_STEPS) {
      expect(title, `título do passo ${id}`).not.toBe('')
      expect(title.length, `título do passo ${id}`).toBeLessThanOrEqual(40)
      expect(body, `texto do passo ${id}`).not.toBe('')
    }
  })

  /**
   * A step pointing at a route the router does not serve would navigate the
   * operator to a blank screen mid-tutorial.
   */
  it('only points at routes the app actually serves', () => {
    for (const { id, route } of TUTORIAL_STEPS) {
      if (route === undefined) continue
      expect(APP_ROUTES, `rota do passo ${id}`).toContain(route)
    }
  })
})
