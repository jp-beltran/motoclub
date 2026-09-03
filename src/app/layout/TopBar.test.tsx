import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { CURRENT_ACTOR_NAME } from '../../features/bar/application/actor'
import { BarRepositoryProvider } from '../../features/bar/application/repository-context'
import { createFakeBarRepository } from '../../test/fake-bar-repository'
import { TopBar } from './TopBar'

function renderTopBar(activeEventName?: string) {
  const repository = createFakeBarRepository()
  const queryClient = new QueryClient()
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <BarRepositoryProvider repository={repository}>{children}</BarRepositoryProvider>
      </QueryClientProvider>
    )
  }

  render(<TopBar activeEventName={activeEventName} />, { wrapper: Wrapper })
  return { repository }
}

describe('TopBar', () => {
  it('shows the active event name when there is one', () => {
    renderTopBar('Encontro de setembro')

    expect(screen.getByText('Encontro de setembro')).toBeInTheDocument()
  })

  it('shows a fallback message when there is no active event', () => {
    renderTopBar(undefined)

    expect(screen.getByText('Nenhum evento ativo')).toBeInTheDocument()
  })

  it('shows the current operator name', () => {
    renderTopBar()

    expect(screen.getByText(CURRENT_ACTOR_NAME)).toBeInTheDocument()
  })

  it('does not reset the demo data when the confirmation is declined', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { repository } = renderTopBar()

    await user.click(screen.getByRole('button', { name: 'Restaurar demonstração' }))

    expect(confirmSpy).toHaveBeenCalled()
    expect(repository.resetDemo).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('resets the demo data when the confirmation is accepted', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { repository } = renderTopBar()

    await user.click(screen.getByRole('button', { name: 'Restaurar demonstração' }))

    await waitFor(() => expect(repository.resetDemo).toHaveBeenCalledTimes(1))
    confirmSpy.mockRestore()
  })
})
