import type { QueryClient } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { BarTestProviders } from '../../../test/bar-test-providers'
import { createFakeBarRepository } from '../../../test/fake-bar-repository'
import { createBarQueryClient } from '../../../test/render-with-bar'
import { CONSUMER_KIND, EVENT_STATUS } from '../domain/constants'
import type { Consumer, Event } from '../domain/entities'
import type { BarRepository } from './bar-repository'
import {
  barKeys,
  useBarSnapshot,
  useCreateConsumer,
  useResetDemo,
  useSelectOrCreateActiveEvent,
  useSetConsumerActive,
  useUpdateConsumer,
} from './queries'

function createWrapper(repository: BarRepository, queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <BarTestProviders repository={repository} queryClient={queryClient}>
        {children}
      </BarTestProviders>
    )
  }
}

describe('useBarSnapshot', () => {
  it('returns the repository snapshot', async () => {
    const repository = createFakeBarRepository()
    const queryClient = createBarQueryClient()

    const { result } = renderHook(() => useBarSnapshot(), {
      wrapper: createWrapper(repository, queryClient),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(repository.getSnapshot).toHaveBeenCalledTimes(1)
    const expectedSnapshot = await repository.getSnapshot()
    expect(result.current.data).toEqual(expectedSnapshot)
  })
})

describe('useResetDemo', () => {
  it('calls repository.resetDemo and invalidates the snapshot query on success', async () => {
    const repository = createFakeBarRepository()
    const queryClient = createBarQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const wrapper = createWrapper(repository, queryClient)

    const { result: snapshotResult } = renderHook(() => useBarSnapshot(), { wrapper })
    await waitFor(() => expect(snapshotResult.current.isSuccess).toBe(true))

    const { result: resetResult } = renderHook(() => useResetDemo(), { wrapper })
    resetResult.current.mutate()

    await waitFor(() => expect(resetResult.current.isSuccess).toBe(true))

    expect(repository.resetDemo).toHaveBeenCalledTimes(1)
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: barKeys.snapshot }),
    )
  })
})

/**
 * Every write hook shares one contract: call exactly one port method with
 * exactly what the screen passed, then invalidate the single snapshot query
 * so every screen reading it re-renders. There is no second read path to
 * keep in sync — `useBarSnapshot` is the only one.
 */
describe('consumer registry and active event mutations', () => {
  const MARCOS: Consumer = {
    id: 'consumer-1', name: 'Marcos Silva', kind: CONSUMER_KIND.MEMBER, active: true,
  }
  const EVENT: Event = {
    id: 'event-1', name: 'Passeio de domingo',
    startsAt: '2026-09-20T18:00:00.000Z', status: EVENT_STATUS.ACTIVE,
  }

  function setup(overrides: Partial<BarRepository>) {
    const repository = createFakeBarRepository(overrides)
    const queryClient = createBarQueryClient()
    return {
      repository,
      wrapper: createWrapper(repository, queryClient),
      invalidateSpy: vi.spyOn(queryClient, 'invalidateQueries'),
    }
  }

  function expectSnapshotInvalidated(invalidateSpy: ReturnType<typeof vi.spyOn>) {
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: barKeys.snapshot }),
    )
  }

  it('useCreateConsumer registers a consumer of the given kind', async () => {
    const createConsumer = vi.fn(async () => MARCOS)
    const { wrapper, invalidateSpy } = setup({ createConsumer })

    const { result } = renderHook(() => useCreateConsumer(), { wrapper })
    result.current.mutate({ name: 'Marcos Silva', kind: CONSUMER_KIND.MEMBER })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(createConsumer).toHaveBeenCalledWith({
      name: 'Marcos Silva', kind: CONSUMER_KIND.MEMBER,
    })
    expectSnapshotInvalidated(invalidateSpy)
  })

  it('useUpdateConsumer forwards only the fields the screen changed', async () => {
    const updateConsumer = vi.fn(async () => MARCOS)
    const { wrapper, invalidateSpy } = setup({ updateConsumer })

    const { result } = renderHook(() => useUpdateConsumer(), { wrapper })
    result.current.mutate({ id: MARCOS.id, name: 'Marcos Silva' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(updateConsumer).toHaveBeenCalledWith({ id: MARCOS.id, name: 'Marcos Silva' })
    expectSnapshotInvalidated(invalidateSpy)
  })

  it('useSetConsumerActive sends the wanted state, not a toggle', async () => {
    const setConsumerActive = vi.fn(async () => ({ ...MARCOS, active: false }))
    const { wrapper, invalidateSpy } = setup({ setConsumerActive })

    const { result } = renderHook(() => useSetConsumerActive(), { wrapper })
    result.current.mutate({ id: MARCOS.id, active: false })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(setConsumerActive).toHaveBeenCalledWith({ id: MARCOS.id, active: false })
    expectSnapshotInvalidated(invalidateSpy)
  })

  it('useSelectOrCreateActiveEvent opens the event the operator named', async () => {
    const selectOrCreateActiveEvent = vi.fn(async () => EVENT)
    const { wrapper, invalidateSpy } = setup({ selectOrCreateActiveEvent })

    const { result } = renderHook(() => useSelectOrCreateActiveEvent(), { wrapper })
    result.current.mutate({ name: 'Passeio de domingo' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(selectOrCreateActiveEvent).toHaveBeenCalledWith({ name: 'Passeio de domingo' })
    expectSnapshotInvalidated(invalidateSpy)
  })
})
