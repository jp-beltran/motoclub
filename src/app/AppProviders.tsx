import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'

import { TutorialProvider } from '../features/tutorial/tutorial-context'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

interface AppProvidersProps {
  children: ReactNode
}

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Above the router: the button that opens the tutorial is in the
          TopBar and the balloon it opens is further down in the shell. */}
      <TutorialProvider>
        <BrowserRouter>{children}</BrowserRouter>
      </TutorialProvider>
    </QueryClientProvider>
  )
}
