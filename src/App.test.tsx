import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { CURRENT_ACTOR_NAME } from './features/bar/application/actor'
import { App } from './App'

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('renders the dark shell with the demo active event at the default route', async () => {
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Painel' })).toBeInTheDocument()
    expect(screen.getByText('setembro de 2026')).toBeInTheDocument()

    const nav = screen.getByRole('navigation', { name: 'Navegação principal' })
    expect(nav.querySelectorAll('a')).toHaveLength(8)

    expect(screen.getByText('Encontro de setembro')).toBeInTheDocument()
    expect(screen.getByText(CURRENT_ACTOR_NAME)).toBeInTheDocument()
  })
})
