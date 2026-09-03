import { QueryClient } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'

import type { BarRepository } from '../features/bar/application/bar-repository'
import { BarTestProviders } from './bar-test-providers'
import { createFakeBarRepository } from './fake-bar-repository'

/**
 * A BarPersistenceError is not transient, so retrying automatically only
 * delays the stable error UI the shell shows. Matches the production
 * QueryClient in src/app/AppProviders.tsx.
 */
export function createBarQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

export interface RenderWithBarOptions {
  readonly repository?: BarRepository
  readonly queryClient?: QueryClient
  readonly route?: string
}

export interface RenderWithBarResult extends RenderResult {
  readonly repository: BarRepository
  readonly queryClient: QueryClient
}

/**
 * Renders `ui` behind the same provider stack the real app mounts
 * (BarRepositoryProvider + TanStack Query + router), defaulting to a fresh
 * fake in-memory repository and query client so tests stay isolated from
 * each other unless they explicitly share one.
 */
export function renderWithBar(
  ui: ReactElement,
  options: RenderWithBarOptions = {},
): RenderWithBarResult {
  const repository = options.repository ?? createFakeBarRepository()
  const queryClient = options.queryClient ?? createBarQueryClient()
  const route = options.route ?? '/'

  const result = render(
    <BarTestProviders repository={repository} queryClient={queryClient} route={route}>
      {ui}
    </BarTestProviders>,
  )

  return { ...result, repository, queryClient }
}
