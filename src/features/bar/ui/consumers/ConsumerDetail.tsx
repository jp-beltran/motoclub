import { CONSUMER_KIND, CONSUMPTION_STATUS, type ConsumerKind } from '../../domain/constants'
import type { Consumer } from '../../domain/entities'
import { formatCents, formatDateTime, formatQuantity } from '../../../../shared/format'
import { Button } from '../../../../shared/ui/Button'
import { EmptyState } from '../../../../shared/ui/EmptyState'
import type { ConsumerHistoryRow } from './consumer-history'

const KIND_LABELS: Record<ConsumerKind, string> = {
  [CONSUMER_KIND.MEMBER]: 'Integrante',
  [CONSUMER_KIND.VISITOR]: 'Visitante',
}

const STATUS_LABELS = {
  [CONSUMPTION_STATUS.ACTIVE]: 'Ativo',
  [CONSUMPTION_STATUS.CANCELLED]: 'Cancelado',
} as const

export interface ConsumerDetailProps {
  readonly consumer: Consumer
  readonly outstandingCents: number
  readonly history: readonly ConsumerHistoryRow[]
  readonly onClose: () => void
}

/**
 * Full consumption history of one consumer. Every consumption is listed,
 * including cancelled ones — visibly marked here — but the outstanding
 * total above the list comes straight from `getConsumerOutstandingCents`
 * (built on `summarizeTab`), which already leaves cancelled and courtesy
 * consumption out.
 */
export function ConsumerDetail({
  consumer,
  outstandingCents,
  history,
  onClose,
}: ConsumerDetailProps) {
  return (
    <section
      aria-label={`Detalhes de ${consumer.name}`}
      className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface-raised p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-content-primary">{consumer.name}</h2>
          <p className="text-sm text-content-muted">
            {KIND_LABELS[consumer.kind]}
            {consumer.phone ? ` · ${consumer.phone}` : ''}
          </p>
        </div>
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      </div>

      <div className="flex items-baseline justify-between gap-3 border-t border-border-subtle pt-3">
        <span className="text-sm font-semibold text-content-primary">Total em aberto</span>
        <span className="text-lg font-semibold text-content-primary">
          {formatCents(outstandingCents)}
        </span>
      </div>
      {consumer.kind === CONSUMER_KIND.MEMBER ? (
        <p className="text-xs text-content-muted">
          O saldo do integrante é cobrado no extrato mensal, após o fechamento.
        </p>
      ) : null}

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-content-muted">
          Histórico de consumo
        </h3>
        {history.length === 0 ? (
          <EmptyState
            title="Nenhum consumo registrado"
            description="Este consumidor ainda não lançou nenhum consumo."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {history.map((row) => {
              const isCancelled = row.status === CONSUMPTION_STATUS.CANCELLED
              const lineClasses = isCancelled
                ? 'text-content-muted line-through'
                : 'text-content-primary'
              return (
                <li
                  key={row.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-md border border-border-subtle p-2 text-sm"
                >
                  <span className={lineClasses}>
                    {`${formatQuantity(row.quantity)}× ${row.itemName}`}
                  </span>
                  <span className="text-content-muted">{formatDateTime(row.createdAt)}</span>
                  <span className={lineClasses}>{formatCents(row.valueCents)}</span>
                  <span
                    className={isCancelled ? 'font-semibold text-warning' : 'text-positive'}
                  >
                    {STATUS_LABELS[row.status]}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
