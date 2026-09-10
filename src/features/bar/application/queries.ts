import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type {
  CreateConsumerInput,
  SelectActiveEventInput,
  SetConsumerActiveInput,
  UpdateConsumerInput,
} from './bar-repository'
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

/**
 * The consumer registry, as hooks. Each one calls a single port method and
 * then invalidates the one snapshot query — there is no second read path to
 * refresh, which is exactly why `useBarSnapshot` is the only reader.
 *
 * No validation lives here: an empty name or an unknown kind is refused by
 * the repository, and the screen prints `describeBarError` of what came
 * back. A copy of the rule in this layer could only drift from the one that
 * actually guards the data.
 */
export function useCreateConsumer() {
  const repository = useBarRepository()
  const invalidateBar = useInvalidateBar()
  return useMutation({
    mutationFn: (input: CreateConsumerInput) => repository.createConsumer(input),
    onSuccess: () => {
      invalidateBar()
    },
  })
}

export function useUpdateConsumer() {
  const repository = useBarRepository()
  const invalidateBar = useInvalidateBar()
  return useMutation({
    mutationFn: (input: UpdateConsumerInput) => repository.updateConsumer(input),
    onSuccess: () => {
      invalidateBar()
    },
  })
}

export function useSetConsumerActive() {
  const repository = useBarRepository()
  const invalidateBar = useInvalidateBar()
  return useMutation({
    mutationFn: (input: SetConsumerActiveInput) => repository.setConsumerActive(input),
    onSuccess: () => {
      invalidateBar()
    },
  })
}

/**
 * Opens the night's event, or hands back the one already running: the port
 * method decides which, and it ignores the name when an active event
 * exists (see `selectOrCreateActiveEvent` in
 * `infrastructure/local-bar-repository.ts`). The screen therefore only
 * offers the form when no event is active.
 */
export function useSelectOrCreateActiveEvent() {
  const repository = useBarRepository()
  const invalidateBar = useInvalidateBar()
  return useMutation({
    mutationFn: (input: SelectActiveEventInput) => repository.selectOrCreateActiveEvent(input),
    onSuccess: () => {
      invalidateBar()
    },
  })
}
