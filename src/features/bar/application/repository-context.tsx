import { createContext, useContext, type ReactNode } from 'react'

import type { BarRepository } from './bar-repository'

const BarRepositoryContext = createContext<BarRepository | undefined>(undefined)

interface BarRepositoryProviderProps {
  readonly repository: BarRepository
  readonly children: ReactNode
}

export function BarRepositoryProvider({ repository, children }: BarRepositoryProviderProps) {
  return (
    <BarRepositoryContext.Provider value={repository}>
      {children}
    </BarRepositoryContext.Provider>
  )
}

export function useBarRepository(): BarRepository {
  const repository = useContext(BarRepositoryContext)
  if (!repository) {
    throw new Error('useBarRepository must be used within a BarRepositoryProvider')
  }
  return repository
}
