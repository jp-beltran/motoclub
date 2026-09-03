import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { LaunchFeedback } from './LaunchFeedback'

describe('LaunchFeedback', () => {
  it('announces a confirmation politely, as a status', () => {
    render(<LaunchFeedback message="1× Cerveja lata para Ana Paula" tone="success" />)

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent('1× Cerveja lata para Ana Paula')
  })

  it('leaves an error to its alert role, without contradicting it with aria-live', () => {
    // role="alert" is implicitly assertive. Pinning aria-live="polite" on the
    // same element gives assistive technology two contradictory instructions
    // about the confirmation region of the consumption flow.
    render(<LaunchFeedback message="Esta comanda está fechada." tone="error" />)

    const alert = screen.getByRole('alert')
    expect(alert).not.toHaveAttribute('aria-live')
  })

  it('keeps the shortage warning next to the confirmation it belongs to', () => {
    render(
      <LaunchFeedback
        message="1× Cerveja lata para Ana Paula"
        tone="success"
        warning="Estoque insuficiente para este item."
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Estoque insuficiente para este item.')
    expect(screen.getByRole('status')).toHaveTextContent('1× Cerveja lata para Ana Paula')
  })
})
