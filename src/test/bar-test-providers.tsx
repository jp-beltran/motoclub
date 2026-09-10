import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'

import type { BarRepository } from '../features/bar/application/bar-repository'
import { BarRepositoryProvider } from '../features/bar/application/repository-context'
import { TutorialProvider } from '../features/tutorial/tutorial-context'

export interface BarTestProvidersProps {
  readonly repository: BarRepository
  readonly queryClient: QueryClient
  readonly route?: string
  readonly children: ReactNode
}

/**
 * The provider stack every bar UI test needs: TanStack Query,
 * BarRepositoryProvider, TutorialProvider and a router context. Compose
 * this directly when a test needs `renderHook`'s `wrapper` option; use
 * `renderWithBar` (from `./render-with-bar`) for plain `render()` calls.
 *
 * `TutorialProvider` decides at mount whether the tutorial opens itself,
 * by reading the "already seen" flag out of `localStorage`. Which is why
 * `renderWithBar` writes that flag before rendering — see its
 * `tutorialSeen` option.
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
        <TutorialProvider>
          <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
        </TutorialProvider>
      </BarRepositoryProvider>
    </QueryClientProvider>
  )
}
