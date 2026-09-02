import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { App } from './App'

describe('App', () => {
  it('renders the prototype home route', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: 'Motoclub' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Protótipo em construção')).toBeInTheDocument()
  })
})
