import { useState } from 'react'

import { formatCents } from '../../../../shared/format'
import { EmptyState } from '../../../../shared/ui/EmptyState'
import { useBarSnapshot } from '../../application/queries'
import type { Item } from '../../domain/entities'
import { getItemMarginRatio } from '../../domain/financials'
import { StockStatusBadge } from '../inventory/StockStatusBadge'
import {
  ALL_CATEGORIES,
  filterCatalogItems,
  formatMarginRatio,
  getItemCategories,
  splitItemsByStatus,
} from './item-selectors'

const FIELD_CLASSES =
  'min-h-11 rounded-md border border-border-subtle bg-surface-raised px-3 text-sm text-content-primary ' +
  'placeholder:text-content-muted focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-accent'

export function CatalogView() {
  const snapshotQuery = useBarSnapshot()
  const [searchTerm, setSearchTerm] = useState('')
  const [category, setCategory] = useState(ALL_CATEGORIES)

  if (!snapshotQuery.data) return null

  const items = snapshotQuery.data.items
  const categories = getItemCategories(items)
  const filteredItems = filterCatalogItems(items, { searchTerm, category })
  const { active, inactive } = splitItemsByStatus(filteredItems)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-content-primary">Itens</h1>
        <p className="mt-1 text-sm text-content-muted">
          Catálogo de itens do bar e situação do estoque.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          type="search"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Buscar por nome ou código"
          aria-label="Buscar por nome ou código"
          className={`${FIELD_CLASSES} min-w-[220px] flex-1`}
        />
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          aria-label="Filtrar por categoria"
          className={FIELD_CLASSES}
        >
          <option value={ALL_CATEGORIES}>Todas as categorias</option>
          {categories.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      {active.length === 0 ? (
        <EmptyState
          title="Nenhum item encontrado"
          description="Ajuste a busca ou o filtro de categoria."
        />
      ) : (
        <ItemTable caption="Itens ativos" items={active} />
      )}

      {inactive.length > 0 && (
        <div>
          <h2 className="mb-2 text-lg font-semibold text-content-primary">Itens inativos</h2>
          <ItemTable caption="Itens inativos" items={inactive} />
        </div>
      )}
    </div>
  )
}

interface ItemTableProps {
  readonly caption: string
  readonly items: readonly Item[]
}

function ItemTable({ caption, items }: ItemTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle">
      <table className="w-full min-w-[760px] text-left text-sm" aria-label={caption}>
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-overlay text-xs uppercase tracking-wide text-content-muted">
          <tr>
            <th scope="col" className="px-3 py-2">Código</th>
            <th scope="col" className="px-3 py-2">Nome</th>
            <th scope="col" className="px-3 py-2">Categoria</th>
            <th scope="col" className="px-3 py-2">Unidade</th>
            <th scope="col" className="px-3 py-2">Custo</th>
            <th scope="col" className="px-3 py-2">Venda</th>
            <th scope="col" className="px-3 py-2">Margem</th>
            <th scope="col" className="px-3 py-2">Estoque</th>
            <th scope="col" className="px-3 py-2">Favorito</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle bg-surface-raised">
          {items.map((item) => (
            <tr key={item.id}>
              <td className="px-3 py-2 text-content-muted">{item.code ?? '—'}</td>
              <td className="px-3 py-2 font-medium text-content-primary">{item.name}</td>
              <td className="px-3 py-2 text-content-muted">{item.category ?? '—'}</td>
              <td className="px-3 py-2 text-content-muted">{item.unit ?? '—'}</td>
              <td className="px-3 py-2 text-content-primary">{formatCents(item.unitCostCents)}</td>
              <td className="px-3 py-2 text-content-primary">{formatCents(item.unitPriceCents)}</td>
              <td className="px-3 py-2 text-content-primary">
                {formatMarginRatio(getItemMarginRatio(item))}
              </td>
              <td className="px-3 py-2">
                <StockStatusBadge item={item} />
              </td>
              <td className="px-3 py-2 text-content-primary">{item.favorite ? 'Sim' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
