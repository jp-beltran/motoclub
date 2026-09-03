import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useBarRepository } from './repository-context'

export const barKeys = {
  snapshot: ['bar', 'snapshot'] as const,
}

export function useBarSnapshot() {
  const repository = useBarRepository()
  return useQuery({
    queryKey: barKeys.snapshot,
    queryFn: () => repository.getSnapshot(),
  })
}

export function useInvalidateBar() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: barKeys.snapshot })
}

export function useResetDemo() {
  const repository = useBarRepository()
  const invalidateBar = useInvalidateBar()
  return useMutation({
    mutationFn: () => repository.resetDemo(),
    onSuccess: () => {
      invalidateBar()
    },
  })
}
