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

  /**
   * Reading "Nenhum evento ativo" on every screen was a dead end while
   * nothing could open an event. The name is now the way to /comandas,
   * where the event is opened.
   */
  it('links the active event to the screen that manages it', () => {
    renderTopBar(undefined)

    expect(screen.getByRole('link', { name: /Evento ativo/ }))
      .toHaveAttribute('href', '/comandas')
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

/**
 * On the club's notebook, restoring the demo is one click away from wiping
 * the month: it replaces the whole SQLite database that every browser on
 * that machine shares. It is a development affordance, so it exists only in
 * development. The tutorial button, next to it, is not — that one is for the
 * operator and stays.
 *
 * This asserts the gate at runtime. That the label is not even *shipped* is
 * a separate claim, proved by grepping `dist/assets/*.js` after a build —
 * a runtime test cannot see the bundle.
 */
describe('TopBar demo reset gate', () => {
  it('offers the restore in development', () => {
    renderTopBar()

    expect(screen.getByRole('button', { name: 'Restaurar demonstração' }))
      .toBeInTheDocument()
  })

  it('does not offer the restore in production', () => {
    vi.stubEnv('DEV', false)
    renderTopBar()

    expect(screen.queryByRole('button', { name: 'Restaurar demonstração' }))
      .not.toBeInTheDocument()
    // The operator's own controls are untouched.
    expect(screen.getByRole('button', { name: 'Tutorial' })).toBeInTheDocument()
    vi.unstubAllEnvs()
  })
})

/**
 * O logout existia no servidor desde sempre e não tinha como ser alcançado:
 * nenhuma tela linkava para ele, então a única forma era digitar a URL. Com
 * a rota virando POST, digitar deixou de funcionar — este botão é o que
 * torna o recurso real em vez de órfão.
 */
describe('TopBar logout', () => {
  it('posts to the logout endpoint and reloads so the server serves the login screen', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      reload,
    } as unknown as Location)
    renderWithBar(<TopBar />)

    await userEvent.click(screen.getByRole('button', { name: 'Sair' }))

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/logout', expect.objectContaining({ method: 'POST' }))
    })
    await waitFor(() => {
      expect(reload).toHaveBeenCalled()
    })
    fetchSpy.mockRestore()
  })

  it('reports a failed logout in pt-BR instead of pretending it worked', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    renderWithBar(<TopBar />)

    await userEvent.click(screen.getByRole('button', { name: 'Sair' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível sair. Tente novamente.',
    )
    fetchSpy.mockRestore()
  })
})
