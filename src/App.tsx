import { useState } from 'react'

import { AppProviders } from './app/AppProviders'
import { AppRouter } from './app/AppRouter'
import { BarRepositoryProvider } from './features/bar/application/repository-context'
import { createBrowserBarRepository } from './features/bar/infrastructure/create-browser-repository'

export function App() {
  const [repository] = useState(() => createBrowserBarRepository())

  return (
    <AppProviders>
      <BarRepositoryProvider repository={repository}>
        <AppRouter />
      </BarRepositoryProvider>
    </AppProviders>
  )
}
