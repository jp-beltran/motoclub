import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderWithBar } from '../../../../test/render-with-bar'
import { createFakeBarRepository } from '../../../../test/fake-bar-repository'
import { CONSUMER_KIND } from '../../domain/constants'
import type { Consumer } from '../../domain/entities'
import { VisitorQuickForm } from './VisitorQuickForm'

const CREATED: Consumer = {
  id: 'visitor-novo', name: 'Carlos Lima', kind: CONSUMER_KIND.VISITOR, active: true,
}

describe('VisitorQuickForm', () => {
  it('creates the visitor with a trimmed name and phone and hands it back', async () => {
    const createVisitor = vi.fn(async () => CREATED)
    const onCreated = vi.fn()
    const user = userEvent.setup()
    renderWithBar(<VisitorQuickForm onCreated={onCreated} />, {
      repository: createFakeBarRepository({ createVisitor }),
    })

    await user.type(screen.getByLabelText('Nome'), '  Carlos Lima  ')
    await user.type(screen.getByLabelText('Telefone (opcional)'), ' 11999990000 ')
    await user.click(screen.getByRole('button', { name: 'Cadastrar visitante' }))

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(CREATED)
    })
    expect(createVisitor).toHaveBeenCalledWith({
      name: 'Carlos Lima', phone: '11999990000',
    })
  })

  it('refuses an empty name without touching the repository', async () => {
    const createVisitor = vi.fn(async () => CREATED)
    const onCreated = vi.fn()
    const user = userEvent.setup()
    renderWithBar(<VisitorQuickForm onCreated={onCreated} />, {
      repository: createFakeBarRepository({ createVisitor }),
    })

    await user.type(screen.getByLabelText('Nome'), '   ')
    await user.click(screen.getByRole('button', { name: 'Cadastrar visitante' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Informe o nome do visitante.')
    expect(createVisitor).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('reports a repository failure in pt-BR and keeps the form open', async () => {
    const createVisitor = vi.fn(async () => {
      throw new Error('Visitor name is required')
    })
    const user = userEvent.setup()
    renderWithBar(<VisitorQuickForm onCreated={vi.fn()} />, {
      repository: createFakeBarRepository({ createVisitor }),
    })

    await user.type(screen.getByLabelText('Nome'), 'Carlos Lima')
    await user.click(screen.getByRole('button', { name: 'Cadastrar visitante' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Informe o nome do visitante.')
    })
    expect(screen.getByLabelText('Nome')).toHaveValue('Carlos Lima')
  })

  it('offers a cancel action only when the caller can close it', async () => {
    const onCancel = vi.fn()
    const user = userEvent.setup()
    const { unmount } = renderWithBar(
      <VisitorQuickForm onCreated={vi.fn()} onCancel={onCancel} />,
    )

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCancel).toHaveBeenCalled()

    unmount()
    renderWithBar(<VisitorQuickForm onCreated={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument()
  })
})
