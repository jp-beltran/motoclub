import { QueryClient } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { BarTestProviders } from '../../../../test/bar-test-providers'
import { createFakeBarRepository } from '../../../../test/fake-bar-repository'
import { describeBarError } from '../../application/error-messages'
import { CHARGE_KIND, CONSUMER_KIND } from '../../domain/constants'
import type { Consumer } from '../../domain/entities'
import { BarError } from '../../domain/errors'
import { useLaunchConsumption } from './use-launch-mutations'

const VISITOR: Consumer = {
  id: 'visitor-rafael',
  name: 'Rafael Oliveira',
  kind: CONSUMER_KIND.VISITOR,
  active: true,
}

function wrapper({ children }: { readonly children: ReactNode }) {
  return (
    <BarTestProviders
      repository={createFakeBarRepository()}
      queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {children}
    </BarTestProviders>
  )
}

/**
 * The screen resolves a visitor's tab before the tap and blocks the launch
 * when no event is active, so this guard is only reached when that
 * pre-flight is stale. It still has to fail as a coded error — never as an
 * English sentence thrown for a message table to recognise.
 */
describe('useLaunchConsumption without an active event', () => {
  it('fails with a code, not a thrown English sentence', async () => {
    const { result } = renderHook(() => useLaunchConsumption(), { wrapper })

    result.current.mutate({
      consumer: VISITOR,
      month: '2026-09',
      activeEventId: undefined,
      itemId: 'item-cerveja',
      quantity: 1,
      chargeKind: CHARGE_KIND.CHARGED,
    })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    const error = result.current.error
    expect(error).toBeInstanceOf(BarError)
    expect((error as BarError).code).toBe('active-event-required')
  })

  it('reaches the operator as the pt-BR sentence for that code', async () => {
    const { result } = renderHook(() => useLaunchConsumption(), { wrapper })

    result.current.mutate({
      consumer: VISITOR,
      month: '2026-09',
      activeEventId: undefined,
      itemId: 'item-cerveja',
      quantity: 1,
      chargeKind: CHARGE_KIND.CHARGED,
    })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(describeBarError(result.current.error)).toContain('Nenhum evento ativo')
  })
})
