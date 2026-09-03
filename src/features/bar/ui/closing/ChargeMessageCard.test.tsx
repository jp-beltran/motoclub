import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ChargeMessageLine } from '../../domain/charge-message'
import { ChargeMessageCard } from './ChargeMessageCard'

const LINES: readonly ChargeMessageLine[] = [
  { itemName: 'Cerveja lata', quantity: 3, subtotalCents: 2100 },
]

/**
 * `userEvent.setup()` installs its own clipboard stub on `navigator` (always
 * resolving `writeText`), so it must run before we replace `navigator.clipboard`
 * with our own controllable mock — otherwise setup() clobbers it and every
 * copy silently "succeeds" regardless of what we tell the mock to do.
 */
function setupWithClipboard(writeText: (text: string) => Promise<void>) {
  const user = userEvent.setup()
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
  return user
}

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, 'clipboard')
})

describe('ChargeMessageCard', () => {
  it('shows the built charge message', () => {
    render(
      <ChargeMessageCard
        consumerName="Ana Paula"
        month="2026-09"
        lines={LINES}
        totalCents={2100}
        paidCents={0}
        remainingCents={2100}
      />,
    )

    expect(screen.getByText(/3× Cerveja lata — R\$ 21,00/)).toBeInTheDocument()
    expect(screen.getByText(/Total: R\$ 21,00/)).toBeInTheDocument()
  })

  it('copies the message to the clipboard and reports success in pt-BR', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const user = setupWithClipboard(writeText)
    render(
      <ChargeMessageCard
        consumerName="Ana Paula"
        month="2026-09"
        lines={LINES}
        totalCents={2100}
        paidCents={0}
        remainingCents={2100}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Copiar mensagem' }))

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Total: R$ 21,00'))
    expect(await screen.findByRole('status')).toHaveTextContent('Mensagem copiada.')
  })

  it('reports a clipboard failure in pt-BR when it rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('permission denied'))
    const user = setupWithClipboard(writeText)
    render(
      <ChargeMessageCard
        consumerName="Ana Paula"
        month="2026-09"
        lines={LINES}
        totalCents={2100}
        paidCents={0}
        remainingCents={2100}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Copiar mensagem' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível copiar a mensagem. Copie manualmente.',
    )
  })
})
