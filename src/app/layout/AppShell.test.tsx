import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { BarPersistenceError } from '../../features/bar/infrastructure/local-bar-repository'
import { createFakeBarRepository } from '../../test/fake-bar-repository'
import { renderWithBar } from '../../test/render-with-bar'
import { AppShell } from './AppShell'

function renderAppShell(repository: ReturnType<typeof createFakeBarRepository>) {
  return renderWithBar(
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<p>Conteúdo da rota</p>} />
        <Route path="lancamentos" element={<p>Lançamentos</p>} />
      </Route>
    </Routes>,
    { repository },
  )
}

describe('AppShell', () => {
  it('renders the persistent navigation with all 8 routes', async () => {
    renderAppShell(createFakeBarRepository())

    await waitFor(() => expect(screen.getByText('Conteúdo da rota')).toBeInTheDocument())

    const nav = screen.getByRole('navigation', { name: 'Navegação principal' })
    expect(within(nav).getAllByRole('link')).toHaveLength(8)
  })

  it('renders the route content once the snapshot is ready', async () => {
    renderAppShell(createFakeBarRepository())

    expect(await screen.findByText('Conteúdo da rota')).toBeInTheDocument()
  })

  it('shows a stable persistence error message with both recovery actions, without a blank screen', async () => {
    const repository = createFakeBarRepository({
      getSnapshot: vi.fn(async () => {
        throw new BarPersistenceError('stored-data-malformed', 'Stored bar data is malformed JSON')
      }),
    })

    renderAppShell(repository)

    const alert = await screen.findByRole('alert')
    expect(
      within(alert).getByText('Não foi possível carregar os dados do bar.'),
    ).toBeInTheDocument()
    expect(within(alert).getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument()
    expect(
      within(alert).getByRole('button', { name: 'Restaurar demonstração' }),
    ).toBeInTheDocument()

    expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toBeInTheDocument()
  })

  it('requires explicit confirmation before restoring the demo data from the error panel', async () => {
    const user = userEvent.setup()
    const repository = createFakeBarRepository({
      getSnapshot: vi.fn(async () => {
        throw new BarPersistenceError('stored-data-malformed', 'Stored bar data is malformed JSON')
      }),
    })

    renderAppShell(repository)

    const alert = await screen.findByRole('alert')
    const resetButton = within(alert).getByRole('button', { name: 'Restaurar demonstração' })

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    await user.click(resetButton)
    expect(repository.resetDemo).not.toHaveBeenCalled()

    confirmSpy.mockReturnValueOnce(true)
    await user.click(resetButton)
    await waitFor(() => expect(repository.resetDemo).toHaveBeenCalledTimes(1))

    confirmSpy.mockRestore()
  })
})
