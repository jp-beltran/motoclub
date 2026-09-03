import { useState } from 'react'

import { CONSUMER_KIND, type ChargeKind } from '../../domain/constants'
import type { Consumer, Item } from '../../domain/entities'
import type { ConsumerTabResolution } from './consumer-tab'
import { ItemCard } from './ItemCard'
import { LAUNCH_BLOCK_MESSAGES } from './launch-messages'
import { Button } from '../../../../shared/ui/Button'
import { EmptyState } from '../../../../shared/ui/EmptyState'

const ALL_CATEGORIES = 'all'
const UNCATEGORIZED_LABEL = 'Sem categoria'

export interface ItemStepProps {
  readonly consumer: Consumer
  readonly items: readonly Item[]
  readonly resolution: ConsumerTabResolution
  readonly onChangeConsumer: () => void
  readonly onLaunch: (itemId: string, quantity: number, chargeKind: ChargeKind) => void
  readonly onOpenTab: () => void
}

/** Step 2: the pinned consumer and the grid that registers consumption. */
export function ItemStep({
  consumer,
  items,
  resolution,
  onChangeConsumer,
  onLaunch,
  onOpenTab,
}: ItemStepProps) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(ALL_CATEGORIES)

  const blockedReason = resolution.kind === 'blocked' ? resolution.reason : undefined
  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')
  const categories = [...new Set(items.map(({ category: name }) => name ?? UNCATEGORIZED_LABEL))]
  const visible = items.filter(
    (item) =>
      (category === ALL_CATEGORIES || (item.category ?? UNCATEGORIZED_LABEL) === category) &&
      item.name.toLocaleLowerCase('pt-BR').includes(normalizedQuery),
  )
  const favorites = visible.filter(({ favorite }) => favorite)
  const others = visible.filter(({ favorite }) => !favorite)

  return (
    <section aria-labelledby="item-step-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface-raised p-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-content-muted">
            Lançando para
          </p>
          <p className="text-lg font-semibold text-content-primary">{consumer.name}</p>
          <p className="text-sm text-content-muted">
            {consumer.kind === CONSUMER_KIND.MEMBER ? 'Integrante' : 'Visitante'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={onOpenTab}>
            Ver comanda
          </Button>
          <Button variant="ghost" onClick={onChangeConsumer}>
            Trocar consumidor
          </Button>
        </div>
      </div>

      {blockedReason ? (
        <p
          role="alert"
          className="rounded-lg border border-warning bg-surface-raised p-4 text-sm text-content-primary"
        >
          {LAUNCH_BLOCK_MESSAGES[blockedReason]}
        </p>
      ) : (
        <>
          <h2 id="item-step-title" className="text-lg font-semibold text-content-primary">
            O que foi consumido?
          </h2>

          <label className="flex flex-col gap-1 text-sm text-content-muted">
            Buscar item
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Digite o nome do item"
              className="min-h-11 w-full rounded-md border border-border-subtle bg-surface-raised px-3 text-sm text-content-primary placeholder:text-content-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
          </label>

          <div role="group" aria-label="Filtrar por categoria" className="flex flex-wrap gap-2">
            <Button
              variant={category === ALL_CATEGORIES ? 'primary' : 'ghost'}
              aria-pressed={category === ALL_CATEGORIES}
              onClick={() => setCategory(ALL_CATEGORIES)}
            >
              Todas
            </Button>
            {categories.map((name) => (
              <Button
                key={name}
                variant={category === name ? 'primary' : 'ghost'}
                aria-pressed={category === name}
                onClick={() => setCategory(name)}
              >
                {name}
              </Button>
            ))}
          </div>

          {visible.length === 0 ? (
            <EmptyState
              title="Nenhum item encontrado"
              description="Ajuste a busca ou o filtro de categoria."
            />
          ) : null}

          <ItemGrid title="Favoritos" items={favorites} onLaunch={onLaunch} />
          <ItemGrid
            title={favorites.length > 0 ? 'Outros itens' : 'Itens'}
            items={others}
            onLaunch={onLaunch}
          />
        </>
      )}
    </section>
  )
}

interface ItemGridProps {
  readonly title: string
  readonly items: readonly Item[]
  readonly onLaunch: (itemId: string, quantity: number, chargeKind: ChargeKind) => void
}

function ItemGrid({ title, items, onLaunch }: ItemGridProps) {
  if (items.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-content-muted">
        {title}
      </h3>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li key={item.id}>
            <ItemCard
              item={item}
              onLaunch={(quantity, chargeKind) => onLaunch(item.id, quantity, chargeKind)}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
