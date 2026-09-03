import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'

import type { BarRepository } from '../features/bar/application/bar-repository'
import { BarRepositoryProvider } from '../features/bar/application/repository-context'

export interface BarTestProvidersProps {
  readonly repository: BarRepository
  readonly queryClient: QueryClient
  readonly route?: string
  readonly children: ReactNode
}

/**
 * The provider stack every bar UI test needs: TanStack Query,
 * BarRepositoryProvider and a router context. Compose this directly when a
 * test needs `renderHook`'s `wrapper` option; use `renderWithBar` (from
 * `./render-with-bar`) for plain `render()` calls.
 */
export function BarTestProviders({
  repository,
  queryClient,
  route = '/',
  children,
}: BarTestProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <BarRepositoryProvider repository={repository}>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </BarRepositoryProvider>
    </QueryClientProvider>
  )
}
