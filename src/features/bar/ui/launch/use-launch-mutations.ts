import { useMutation } from '@tanstack/react-query'

import { CURRENT_ACTOR_ID } from '../../application/actor'
import type { BarRepository } from '../../application/bar-repository'
import { useInvalidateBar } from '../../application/queries'
import { useBarRepository } from '../../application/repository-context'
import { CONSUMER_KIND, type ChargeKind } from '../../domain/constants'
import type { Consumer } from '../../domain/entities'
import { BarError } from '../../domain/errors'

export interface LaunchVariables {
  readonly consumer: Consumer
  /** Current month, from `getCurrentMonth()`, for a member's monthly tab. */
  readonly month: string
  readonly activeEventId?: string
  readonly itemId: string
  readonly quantity: number
  readonly chargeKind: ChargeKind
}

/**
 * One tap of an item: resolve the consumer's tab, then record the consumption.
 * Ensuring the tab lazily keeps the standard path at a single click and works
 * for a visitor created seconds ago, who has no tab in the snapshot yet.
 */
export function useLaunchConsumption() {
  const repository = useBarRepository()
  const invalidateBar = useInvalidateBar()

  return useMutation({
    mutationFn: async (variables: LaunchVariables) => {
      const tab = await ensureTab(repository, variables)
      return repository.createConsumption({
        tabId: tab.id,
        itemId: variables.itemId,
        quantity: variables.quantity,
        chargeKind: variables.chargeKind,
        actorId: CURRENT_ACTOR_ID,
      })
    },
    onSuccess: () => {
      invalidateBar()
    },
  })
}

function ensureTab(repository: BarRepository, variables: LaunchVariables) {
  if (variables.consumer.kind === CONSUMER_KIND.MEMBER) {
    return repository.ensureMonthlyTab({
      memberId: variables.consumer.id,
      month: variables.month,
    })
  }
  // `resolveConsumerTab` already blocks the tap when no event is active, so
  // this is the stale-pre-flight case. It raises the same coded failure a
  // backend would return for "open a visitor tab with no active event",
  // instead of an English sentence thrown for a table to recognise.
  if (!variables.activeEventId) {
    throw new BarError(
      'active-event-required',
      'An active event is required to open a visitor tab',
    )
  }
  return repository.ensureEventTab({
    eventId: variables.activeEventId,
    visitorId: variables.consumer.id,
  })
}

export function useCancelConsumption() {
  const repository = useBarRepository()
  const invalidateBar = useInvalidateBar()

  return useMutation({
    mutationFn: (consumptionId: string) =>
      repository.cancelConsumption({ consumptionId, actorId: CURRENT_ACTOR_ID }),
    onSuccess: () => {
      invalidateBar()
    },
  })
}

export interface EditQuantityVariables {
  readonly consumptionId: string
  readonly quantity: number
}

export function useEditConsumptionQuantity() {
  const repository = useBarRepository()
  const invalidateBar = useInvalidateBar()

  return useMutation({
    mutationFn: ({ consumptionId, quantity }: EditQuantityVariables) =>
      repository.editConsumptionQuantity({
        consumptionId,
        quantity,
        actorId: CURRENT_ACTOR_ID,
      }),
    onSuccess: () => {
      invalidateBar()
    },
  })
}

export interface ReassignVariables {
  readonly consumptionId: string
  readonly targetTabId: string
}

export function useReassignConsumption() {
  const repository = useBarRepository()
  const invalidateBar = useInvalidateBar()

  return useMutation({
    mutationFn: (variables: ReassignVariables) => repository.reassignConsumption(variables),
    onSuccess: () => {
      invalidateBar()
    },
  })
}
