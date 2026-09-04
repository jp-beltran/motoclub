import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { CURRENT_ACTOR_NAME } from './features/bar/application/actor'
import { formatMonth, formatMonthName, getCurrentMonth } from './shared/date'
import { App } from './App'

// The demo seed derives its whole timeline — and the active event's name —
// from whichever month the suite runs in, so these are derived too rather
// than pinned to the month the seed was first written in.

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('renders the dark shell with the demo active event at the default route', async () => {
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Painel' })).toBeInTheDocument()
    expect(screen.getByText(formatMonth(getCurrentMonth()))).toBeInTheDocument()

    const nav = screen.getByRole('navigation', { name: 'Navegação principal' })
    expect(nav.querySelectorAll('a')).toHaveLength(8)

    expect(
      screen.getByText(`Encontro de ${formatMonthName(getCurrentMonth())}`),
    ).toBeInTheDocument()
    expect(screen.getByText(CURRENT_ACTOR_NAME)).toBeInTheDocument()
  })
})
