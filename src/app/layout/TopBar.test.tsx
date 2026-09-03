import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { CURRENT_ACTOR_NAME } from '../../features/bar/application/actor'
import { createFakeBarRepository } from '../../test/fake-bar-repository'
import { renderWithBar } from '../../test/render-with-bar'
import { TopBar } from './TopBar'

function renderTopBar(activeEventName?: string) {
  const { repository } = renderWithBar(<TopBar activeEventName={activeEventName} />)
  return { repository }
}

describe('TopBar demo reset failure', () => {
  it('reports a failed restore in pt-BR instead of silently re-enabling', async () => {
    const resetDemo = vi.fn().mockRejectedValue(new Error('QuotaExceededError'))
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderWithBar(<TopBar />, { repository: createFakeBarRepository({ resetDemo }) })

    await userEvent.click(screen.getByRole('button', { name: 'Restaurar demonstração' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível restaurar a demonstração. Tente novamente.',
    )
    confirmSpy.mockRestore()
  })

  it('says nothing while the restore has not failed', () => {
    renderWithBar(<TopBar />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

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
