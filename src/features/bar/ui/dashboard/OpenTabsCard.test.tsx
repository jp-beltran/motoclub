import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { OpenTabsCard } from './OpenTabsCard'

describe('OpenTabsCard', () => {
  it('shows the open tabs count and a link to the comandas area', () => {
    render(
      <MemoryRouter>
        <OpenTabsCard openTabsCount={3} />
      </MemoryRouter>,
    )

    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Comandas abertas')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ver comandas/i })).toHaveAttribute(
      'href',
      '/comandas',
    )
  })

  it('renders a coherent empty state when there are no open tabs', () => {
    render(
      <MemoryRouter>
        <OpenTabsCard openTabsCount={0} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Nenhuma comanda aberta')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ver comandas/i })).toHaveAttribute(
      'href',
      '/comandas',
    )
  })
})
