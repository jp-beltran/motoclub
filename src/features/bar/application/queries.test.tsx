import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { createFakeBarRepository } from '../../../test/fake-bar-repository'
import type { BarRepository } from './bar-repository'
import { barKeys, useBarSnapshot, useResetDemo } from './queries'
import { BarRepositoryProvider } from './repository-context'

function createWrapper(repository: BarRepository, queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <BarRepositoryProvider repository={repository}>{children}</BarRepositoryProvider>
      </QueryClientProvider>
    )
  }
}

describe('useBarSnapshot', () => {
  it('returns the repository snapshot', async () => {
    const repository = createFakeBarRepository()
    const queryClient = new QueryClient()

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
    const queryClient = new QueryClient()
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
