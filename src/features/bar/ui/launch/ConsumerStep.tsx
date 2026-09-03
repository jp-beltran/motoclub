import { useState } from 'react'

import { CONSUMER_KIND, type ConsumerKind } from '../../domain/constants'
import type { Consumer } from '../../domain/entities'
import { VisitorQuickForm } from '../consumers/VisitorQuickForm'
import { Button } from '../../../../shared/ui/Button'
import { EmptyState } from '../../../../shared/ui/EmptyState'

type ConsumerFilter = 'all' | ConsumerKind

const FILTERS: readonly { readonly value: ConsumerFilter; readonly label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: CONSUMER_KIND.MEMBER, label: 'Integrantes' },
  { value: CONSUMER_KIND.VISITOR, label: 'Visitantes' },
]

const KIND_LABELS: Record<ConsumerKind, string> = {
  [CONSUMER_KIND.MEMBER]: 'Integrante',
  [CONSUMER_KIND.VISITOR]: 'Visitante',
}

export interface ConsumerStepProps {
  readonly consumers: readonly Consumer[]
  readonly onSelect: (consumer: Consumer) => void
}

/** Step 1: find who is consuming, or register a walk-in visitor on the spot. */
export function ConsumerStep({ consumers, onSelect }: ConsumerStepProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ConsumerFilter>('all')
  const [isRegistering, setIsRegistering] = useState(false)

  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')
  const visible = consumers.filter(
    (consumer) =>
      (filter === 'all' || consumer.kind === filter) &&
      consumer.name.toLocaleLowerCase('pt-BR').includes(normalizedQuery),
  )

  return (
    <section aria-labelledby="consumer-step-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="consumer-step-title" className="text-lg font-semibold text-content-primary">
          Quem está consumindo?
        </h2>
        <Button
          variant={isRegistering ? 'ghost' : 'primary'}
          aria-expanded={isRegistering}
          onClick={() => setIsRegistering((current) => !current)}
        >
          Novo visitante
        </Button>
      </div>

      {isRegistering ? (
        <VisitorQuickForm
          onCreated={(visitor) => {
            setIsRegistering(false)
            onSelect(visitor)
          }}
          onCancel={() => setIsRegistering(false)}
        />
      ) : null}

      <label className="flex flex-col gap-1 text-sm text-content-muted">
        Buscar por nome
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Digite um nome"
          className="min-h-11 w-full rounded-md border border-border-subtle bg-surface-raised px-3 text-sm text-content-primary placeholder:text-content-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
      </label>

      <div role="group" aria-label="Filtrar consumidores" className="flex flex-wrap gap-2">
        {FILTERS.map(({ value, label }) => (
          <Button
            key={value}
            variant={filter === value ? 'primary' : 'ghost'}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </Button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="Nenhum consumidor encontrado"
          description="Ajuste a busca ou cadastre um novo visitante."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((consumer) => (
            <li key={consumer.id}>
              <button
                type="button"
                onClick={() => onSelect(consumer)}
                className="flex min-h-11 w-full flex-col items-start gap-1 rounded-lg border border-border-subtle bg-surface-raised p-4 text-left transition-colors hover:bg-surface-overlay focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <span className="text-base font-semibold text-content-primary">
                  {consumer.name}
                </span>
                <span className="text-sm text-content-muted">
                  {KIND_LABELS[consumer.kind]}
                  {consumer.phone ? ` · ${consumer.phone}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
