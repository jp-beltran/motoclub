import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { Sidebar } from './Sidebar'

describe('Sidebar', () => {
  it('exposes a mobile menu toggle button with aria-expanded reflecting its state', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar />
      </MemoryRouter>,
    )

    const toggle = screen.getByRole('button', { name: /menu/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('marks the active route with aria-current in addition to color', () => {
    render(
      <MemoryRouter initialEntries={['/lancamentos']}>
        <Sidebar />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: /lançamentos/i })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: /consumidores/i })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('gives every navigation link a visible focus-visible ring', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar />
      </MemoryRouter>,
    )

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(8)
    for (const link of links) {
      expect(link.className).toContain('focus-visible:outline')
      expect(link.className).toContain('focus-visible:outline-2')
      expect(link.className).toContain('focus-visible:outline-offset-2')
      expect(link.className).toContain('focus-visible:outline-accent')
    }
  })
})
