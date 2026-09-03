import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('always renders the title', () => {
    render(<EmptyState title="Nenhum item encontrado" />)

    expect(screen.getByText('Nenhum item encontrado')).toBeInTheDocument()
  })

  it('renders the description when provided', () => {
    render(
      <EmptyState title="Nenhum item encontrado" description="Ajuste os filtros de busca." />,
    )

    expect(screen.getByText('Ajuste os filtros de busca.')).toBeInTheDocument()
  })

  it('omits the description when not provided', () => {
    const { container } = render(<EmptyState title="Nenhum item encontrado" />)

    expect(container.querySelectorAll('p')).toHaveLength(1)
  })

  it('renders the action when provided', () => {
    render(
      <EmptyState
        title="Nenhum item encontrado"
        action={<button type="button">Adicionar item</button>}
      />,
    )

    expect(screen.getByRole('button', { name: 'Adicionar item' })).toBeInTheDocument()
  })
})
