import { QueryClient } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'

import type { BarRepository } from '../features/bar/application/bar-repository'
import { TUTORIAL_SEEN_KEY, markTutorialSeen } from '../features/tutorial/tutorial-seen'
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
  /**
   * Whether this browser has already seen the tutorial. Defaults to
   * `true`, because the tutorial opens itself on a first visit and a
   * balloon floating over the screen under test is noise for every test
   * that is not about the tutorial. Pass `false` to get the first-visit
   * behaviour on purpose.
   */
  readonly tutorialSeen?: boolean
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

  // Written before rendering, because TutorialProvider reads it once while
  // mounting. Set on every call rather than only when asked, so a test does
  // not inherit whatever an earlier test in the same file left behind.
  // Guarded because a test is free to make `localStorage` throw.
  try {
    if (options.tutorialSeen ?? true) {
      markTutorialSeen()
    } else {
      window.localStorage.removeItem(TUTORIAL_SEEN_KEY)
    }
  } catch {
    // A test that broke storage on purpose gets the first-visit behaviour,
    // which is what `hasSeenTutorial` falls back to anyway.
  }

  const result = render(
    <BarTestProviders repository={repository} queryClient={queryClient} route={route}>
      {ui}
    </BarTestProviders>,
  )

  return { ...result, repository, queryClient }
}
