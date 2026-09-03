import { EmptyState } from '../../../../shared/ui/EmptyState'
import { PendingTargetRow } from './PendingTargetRow'
import { pendingTargetKey, type PendingTarget } from './pending-targets'

export interface PendingTargetsListProps {
  readonly targets: readonly PendingTarget[]
  readonly expandedKey: string | undefined
  readonly onToggle: (key: string) => void
  readonly onSubmit: (target: PendingTarget, amountCents: number) => void
  readonly submittingKey: string | undefined
  readonly errorKey: string | undefined
  readonly errorMessage: string | undefined
}

export function PendingTargetsList({
  targets,
  expandedKey,
  onToggle,
  onSubmit,
  submittingKey,
  errorKey,
  errorMessage,
}: PendingTargetsListProps) {
  if (targets.length === 0) {
    return (
      <EmptyState
        title="Nenhuma pendência"
        description="Não há comanda ou extrato com saldo em aberto no momento."
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {targets.map((target) => {
        const key = pendingTargetKey(target)
        return (
          <PendingTargetRow
            key={key}
            target={target}
            expanded={expandedKey === key}
            onToggle={() => onToggle(key)}
            onSubmit={(amountCents) => onSubmit(target, amountCents)}
            isSubmitting={submittingKey === key}
            submitErrorMessage={errorKey === key ? errorMessage : undefined}
          />
        )
      })}
    </div>
  )
}
