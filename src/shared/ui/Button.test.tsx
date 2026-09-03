import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Button } from './Button'

describe('Button', () => {
  it('renders its children and meets the minimum touch target height', () => {
    render(<Button>Confirmar</Button>)

    const button = screen.getByRole('button', { name: 'Confirmar' })
    expect(button.className).toContain('min-h-11')
  })

  it('defaults to the primary variant', () => {
    render(<Button>Confirmar</Button>)

    expect(screen.getByRole('button', { name: 'Confirmar' }).className).toContain('bg-accent')
  })

  it('applies the ghost variant styling', () => {
    render(<Button variant="ghost">Cancelar</Button>)

    const button = screen.getByRole('button', { name: 'Cancelar' })
    expect(button.className).not.toContain('bg-accent ')
    expect(button.className).toContain('border-border-subtle')
  })

  it('applies the danger variant styling', () => {
    render(<Button variant="danger">Excluir</Button>)

    expect(screen.getByRole('button', { name: 'Excluir' }).className).toContain('bg-accent-strong')
  })

  it('forwards click handlers and native button props', async () => {
    const user = userEvent.setup()
    const handleClick = vi.fn()
    render(
      <Button onClick={handleClick} disabled={false}>
        Clique
      </Button>,
    )

    await user.click(screen.getByRole('button', { name: 'Clique' }))

    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('defaults to type="button" so it never submits a form by accident', () => {
    render(<Button>Confirmar</Button>)

    expect(screen.getByRole('button', { name: 'Confirmar' })).toHaveAttribute('type', 'button')
  })
})
