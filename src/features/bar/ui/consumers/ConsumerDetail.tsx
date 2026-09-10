import { useState } from 'react'

import { describeBarError } from '../../application/error-messages'
import { useSetConsumerActive } from '../../application/queries'
import { CONSUMER_KIND, CONSUMPTION_STATUS, type ConsumerKind } from '../../domain/constants'
import type { Consumer } from '../../domain/entities'
import { formatCents, formatDateTime, formatQuantity } from '../../../../shared/format'
import { Button } from '../../../../shared/ui/Button'
import { EmptyState } from '../../../../shared/ui/EmptyState'
import { ConsumerEditForm } from './ConsumerEditForm'
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
 * Full consumption history of one consumer, and the two things the register
 * can do to them: correct a typo and deactivate them.
 *
 * Every consumption is listed, including cancelled ones — visibly marked
 * here — but the outstanding total above the list comes straight from
 * `getConsumerOutstandingCents`, which already leaves cancelled and
 * courtesy consumption out. See that selector's own doc comment for exactly
 * how it derives the total for each consumer kind (they differ).
 *
 * The deactivation control sits right under that total on purpose: the
 * user's ruling is that deactivating someone who owes money is allowed and
 * the debt stays, so the operator has to be able to read the debt in the
 * same glance as the button that stops new consumption for them.
 */
export function ConsumerDetail({
  consumer,
  outstandingCents,
  history,
  onClose,
}: ConsumerDetailProps) {
  const [isEditing, setIsEditing] = useState(false)
  const setConsumerActive = useSetConsumerActive()
  const isActive = consumer.active !== false

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
          {isActive ? null : (
            <p className="mt-1 text-sm font-semibold text-warning">Inativo</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            aria-expanded={isEditing}
            onClick={() => setIsEditing((current) => !current)}
          >
            Corrigir dados
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>

      {isEditing ? (
        <ConsumerEditForm
          consumer={consumer}
          onSaved={() => setIsEditing(false)}
          onCancel={() => setIsEditing(false)}
        />
      ) : null}

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

      <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant={isActive ? 'danger' : 'primary'}
            disabled={setConsumerActive.isPending}
            onClick={() => {
              setConsumerActive.reset()
              setConsumerActive.mutate({ id: consumer.id, active: !isActive })
            }}
          >
            {activationLabel(isActive, setConsumerActive.isPending)}
          </Button>
          <p className="text-xs text-content-muted">
            {isActive
              ? 'Um consumidor inativo não recebe novos lançamentos.'
              : 'Reativar volta a permitir lançamentos para este consumidor.'}
          </p>
        </div>
        {isActive && outstandingCents > 0 ? (
          <p className="text-xs text-content-muted">
            {`Os ${formatCents(outstandingCents)} em aberto continuam sendo cobrados no ` +
              'fechamento do mês e na tela de pagamentos até serem quitados.'}
          </p>
        ) : null}
        {setConsumerActive.isError ? (
          <p role="alert" className="text-sm text-accent">
            {describeBarError(setConsumerActive.error)}
          </p>
        ) : null}
      </div>

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

/** One label per state, so a click never leaves the button reading "Desativar" while it is deactivating. */
function activationLabel(isActive: boolean, isPending: boolean): string {
  if (isPending) return isActive ? 'Desativando…' : 'Reativando…'
  return isActive ? 'Desativar' : 'Reativar'
}
