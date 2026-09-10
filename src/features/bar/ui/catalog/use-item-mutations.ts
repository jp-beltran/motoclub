import { useMutation } from '@tanstack/react-query'

import type {
  CreateItemInput,
  SetItemActiveInput,
  UpdateItemInput,
} from '../../application/bar-repository'
import { useInvalidateBar } from '../../application/queries'
import { useBarRepository } from '../../application/repository-context'

/**
 * The three writes /itens needs, next to the screen that uses them and
 * shaped like `ui/launch/use-launch-mutations.ts`: one `useMutation` each,
 * every one invalidating the single snapshot query on success so the
 * catalogue, the launch grid and the dashboard all re-read the same data.
 *
 * Reads still come from `useBarSnapshot` and nothing else — there is no
 * second read path for items.
 */
export function useCreateItem() {
  const repository = useBarRepository()
  const invalidateBar = useInvalidateBar()

  return useMutation({
    mutationFn: (input: CreateItemInput) => repository.createItem(input),
    onSuccess: () => {
      invalidateBar()
    },
  })
}

export function useUpdateItem() {
  const repository = useBarRepository()
  const invalidateBar = useInvalidateBar()

  return useMutation({
    mutationFn: (input: UpdateItemInput) => repository.updateItem(input),
    onSuccess: () => {
      invalidateBar()
    },
  })
}

export function useSetItemActive() {
  const repository = useBarRepository()
  const invalidateBar = useInvalidateBar()

  return useMutation({
    mutationFn: (input: SetItemActiveInput) => repository.setItemActive(input),
    onSuccess: () => {
      invalidateBar()
    },
  })
}
