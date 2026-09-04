import { useState } from 'react'

import { AppProviders } from './app/AppProviders'
import { AppRouter } from './app/AppRouter'
import { BarRepositoryProvider } from './features/bar/application/repository-context'
import { HttpBarRepository } from './features/bar/infrastructure/http-bar-repository'

export function App() {
  const [repository] = useState(() => new HttpBarRepository())

  return (
    <AppProviders>
      <BarRepositoryProvider repository={repository}>
        <AppRouter />
      </BarRepositoryProvider>
    </AppProviders>
  )
}
