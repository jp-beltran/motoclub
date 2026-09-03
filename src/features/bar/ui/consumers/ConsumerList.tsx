import { CONSUMER_KIND, type ConsumerKind } from '../../domain/constants'
import type { Consumer } from '../../domain/entities'
import { formatCents } from '../../../../shared/format'

const KIND_LABELS: Record<ConsumerKind, string> = {
  [CONSUMER_KIND.MEMBER]: 'Integrante',
  [CONSUMER_KIND.VISITOR]: 'Visitante',
}

export interface ConsumerListRow {
  readonly consumer: Consumer
  readonly outstandingCents: number
}

export interface ConsumerListProps {
  readonly rows: readonly ConsumerListRow[]
  readonly selectedConsumerId: string | undefined
  readonly onSelect: (consumer: Consumer) => void
}

/** The filtered consumer list: type, phone (when present) and outstanding total per row. */
export function ConsumerList({ rows, selectedConsumerId, onSelect }: ConsumerListProps) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map(({ consumer, outstandingCents }) => {
        const isSelected = consumer.id === selectedConsumerId
        return (
          <li key={consumer.id}>
            <button
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(consumer)}
              className={`flex min-h-11 w-full flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors hover:bg-surface-overlay focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                isSelected
                  ? 'border-accent bg-surface-overlay'
                  : 'border-border-subtle bg-surface-raised'
              }`}
            >
              <span className="text-base font-semibold text-content-primary">
                {consumer.name}
              </span>
              <span className="text-sm text-content-muted">
                {KIND_LABELS[consumer.kind]}
                {consumer.phone ? ` · ${consumer.phone}` : ''}
              </span>
              <span className="text-sm font-medium text-content-primary">
                {formatCents(outstandingCents)}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
