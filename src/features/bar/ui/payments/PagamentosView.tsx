import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { EmptyState } from '../../../../shared/ui/EmptyState'
import { CURRENT_ACTOR_ID } from '../../application/actor'
import type { RecordPaymentInput } from '../../application/bar-repository'
import { useBarSnapshot, useInvalidateBar } from '../../application/queries'
import { useBarRepository } from '../../application/repository-context'
import { BAR_ERROR_FALLBACKS, describeBarError } from '../../application/error-messages'
import { listPendingTargets, pendingTargetKey, type PendingTarget } from './pending-targets'
import { PendingTargetsList } from './PendingTargetsList'

export function PagamentosView() {
  const snapshotQuery = useBarSnapshot()
  const repository = useBarRepository()
  const invalidateBar = useInvalidateBar()
  const [expandedKey, setExpandedKey] = useState<string | undefined>(undefined)

  const paymentMutation = useMutation({
    mutationFn: (input: RecordPaymentInput) => repository.recordPayment(input),
    onSuccess: () => {
      invalidateBar()
    },
  })

  function handleToggle(key: string) {
    setExpandedKey((current) => (current === key ? undefined : key))
    paymentMutation.reset()
  }

  function handleSubmit(target: PendingTarget, amountCents: number) {
    paymentMutation.mutate({
      target: target.target,
      targetId: target.targetId,
      amountCents,
      actorId: CURRENT_ACTOR_ID,
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-content-primary">Pagamentos</h1>
        <p className="mt-1 text-sm text-content-muted">
          Registre pagamentos de comandas de visitante e de extratos mensais, e acompanhe
          o que ainda está em aberto.
        </p>
      </header>

      <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-surface-raised p-3">
        <p className="text-sm text-content-muted">
          O saldo de integrantes referente ao mês corrente ainda não aparece aqui: ele só vira
          pendência de pagamento depois do fechamento mensal, quando o extrato do integrante é
          gerado.
        </p>
        <Link
          to="/fechamento"
          className="inline-flex w-fit min-h-11 items-center text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Ir para o fechamento mensal
        </Link>
      </div>

      {snapshotQuery.isPending ? (
        <p className="text-content-muted">Carregando pendências…</p>
      ) : null}

      {snapshotQuery.isError ? (
        <EmptyState
          title="Não foi possível carregar as pendências"
          description="Tente novamente em instantes."
        />
      ) : null}

      {snapshotQuery.data ? (
        <PendingTargetsList
          targets={listPendingTargets(snapshotQuery.data)}
          expandedKey={expandedKey}
          onToggle={handleToggle}
          onSubmit={handleSubmit}
          submittingKey={
            paymentMutation.isPending && paymentMutation.variables
              ? pendingTargetKey({
                  target: paymentMutation.variables.target,
                  targetId: paymentMutation.variables.targetId,
                })
              : undefined
          }
          errorKey={
            paymentMutation.isError && paymentMutation.variables
              ? pendingTargetKey({
                  target: paymentMutation.variables.target,
                  targetId: paymentMutation.variables.targetId,
                })
              : undefined
          }
          errorMessage={
            paymentMutation.isError
              ? describeBarError(paymentMutation.error, BAR_ERROR_FALLBACKS.payment)
              : undefined
          }
        />
      ) : null}
    </div>
  )
}
