import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { StatTile } from './StatTile'

describe('StatTile', () => {
  it('renders the label and the pre-formatted value', () => {
    render(<StatTile label="Consumo do mês" value="R$ 1.234,56" />)

    expect(screen.getByText('Consumo do mês')).toBeInTheDocument()
    expect(screen.getByText('R$ 1.234,56')).toBeInTheDocument()
  })

  it('renders the hint when provided', () => {
    render(<StatTile label="Margem" value="12,3%" hint="Lucro sobre receita" />)

    expect(screen.getByText('Lucro sobre receita')).toBeInTheDocument()
  })

  it('omits the hint when not provided', () => {
    const { container } = render(<StatTile label="Margem" value="12,3%" />)

    expect(container.querySelectorAll('p')).toHaveLength(2)
  })
})
