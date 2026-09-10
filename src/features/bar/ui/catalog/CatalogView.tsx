import { useRef, useState, type FormEvent } from 'react'

import { formatCents } from '../../../../shared/format'
import { Button } from '../../../../shared/ui/Button'
import { Card } from '../../../../shared/ui/Card'
import { EmptyState } from '../../../../shared/ui/EmptyState'
import { BAR_ERROR_FALLBACKS, describeBarError } from '../../application/error-messages'
import { useBarSnapshot } from '../../application/queries'
import type { Item } from '../../domain/entities'
import { getItemMarginRatio } from '../../domain/financials'
import { StockStatusBadge } from '../inventory/StockStatusBadge'
import {
  EMPTY_ITEM_FORM,
  itemToForm,
  parseItemForm,
  type ItemFormState,
} from './item-form'
import {
  ALL_CATEGORIES,
  filterCatalogItems,
  formatMarginRatio,
  getItemCategories,
  isItemActive,
  splitItemsByStatus,
} from './item-selectors'
import { useCreateItem, useSetItemActive, useUpdateItem } from './use-item-mutations'

const FIELD_CLASSES =
  'min-h-11 rounded-md border border-border-subtle bg-surface-raised px-3 text-sm text-content-primary ' +
  'placeholder:text-content-muted focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-accent'

const CHECKBOX_CLASSES =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-accent'

export function CatalogView() {
  const snapshotQuery = useBarSnapshot()
  const [searchTerm, setSearchTerm] = useState('')
  const [category, setCategory] = useState(ALL_CATEGORIES)
  /** The item being edited, or `undefined` while the form registers a new one. */
  const [editingId, setEditingId] = useState<string>()
  const [form, setForm] = useState<ItemFormState>(EMPTY_ITEM_FORM)
  /**
   * Only ever a "these characters are not an amount" message. Every rule
   * about what an item may be comes back from the repository instead, in
   * `saveError` below.
   */
  const [formError, setFormError] = useState<string>()
  const nameInputRef = useRef<HTMLInputElement>(null)

  const createItem = useCreateItem()
  const updateItem = useUpdateItem()
  const setItemActive = useSetItemActive()

  // The app shell already renders the loading and persistence-error states.
  if (!snapshotQuery.data) return null

  const items = snapshotQuery.data.items
  const categories = getItemCategories(items)
  const filteredItems = filterCatalogItems(items, { searchTerm, category })
  const { active, inactive } = splitItemsByStatus(filteredItems)
  const isSaving = createItem.isPending || updateItem.isPending
  const saveError = createItem.error ?? updateItem.error

  function updateField<Key extends keyof ItemFormState>(key: Key, value: ItemFormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function resetForm() {
    setEditingId(undefined)
    setForm(EMPTY_ITEM_FORM)
    setFormError(undefined)
    createItem.reset()
    updateItem.reset()
  }

  /**
   * Loads the row into the one form at the top of the screen — no modal, and
   * nothing to scroll past on a phone. Focus follows, because otherwise a
   * click on a row far down the table would change something off-screen with
   * no sign that it happened.
   */
  function startEditing(item: Item) {
    setEditingId(item.id)
    setForm(itemToForm(item))
    setFormError(undefined)
    createItem.reset()
    updateItem.reset()
    nameInputRef.current?.focus()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(undefined)
    createItem.reset()
    updateItem.reset()

    const parsed = parseItemForm(form)
    if (!parsed.ok) {
      setFormError(parsed.error)
      return
    }

    // Every field goes on an edit, blanks included: what the operator sees in
    // the form is what the item becomes, which is also how a wrong code gets
    // cleared (`updateItem` reads a blank text field as "clear it").
    if (editingId) {
      // Campo a campo, e não `...parsed.values`: `stockQuantity` não pode
      // vazar para cá nem por acidente, porque `updateItem` não mexe em
      // estoque — isso é movimento em /estoque, que deixa rastro.
      const { name, code, category, unit, favorite, unitPriceCents, unitCostCents } = parsed.values
      updateItem.mutate(
        { id: editingId, name, code, category, unit, favorite, unitPriceCents, unitCostCents },
        { onSuccess: () => resetForm() },
      )
      return
    }
    createItem.mutate(parsed.values, { onSuccess: () => resetForm() })
  }

  return (
    <div className="flex flex-col gap-6">
      <div data-tutorial="itens">
        <h1 className="text-2xl font-semibold text-content-primary">Itens</h1>
        <p className="mt-1 text-sm text-content-muted">
          Catálogo de itens do bar e situação do estoque.
        </p>
      </div>

      <Card>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-content-primary">
            {editingId ? 'Editar item' : 'Novo item'}
          </h2>
          <p className="text-sm text-content-muted">
            Preço e custo em reais, com vírgula: 12,50. Alterar o preço vale para os
            próximos lançamentos — o que já foi lançado mantém o valor da venda.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-content-primary">
              Nome
              <input
                ref={nameInputRef}
                type="text"
                value={form.name}
                onChange={(event) => updateField('name', event.target.value)}
                placeholder="Cerveja lata"
                className={FIELD_CLASSES}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-content-primary">
              Código
              <input
                type="text"
                value={form.code}
                onChange={(event) => updateField('code', event.target.value)}
                placeholder="BEV-001"
                className={FIELD_CLASSES}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-content-primary">
              Categoria
              <input
                type="text"
                value={form.category}
                onChange={(event) => updateField('category', event.target.value)}
                placeholder="Bebidas"
                className={FIELD_CLASSES}
                list="catalog-categories"
              />
            </label>
            <datalist id="catalog-categories">
              {categories.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
            <label className="flex flex-col gap-1 text-sm text-content-primary">
              Unidade
              <input
                type="text"
                value={form.unit}
                onChange={(event) => updateField('unit', event.target.value)}
                placeholder="lata"
                className={FIELD_CLASSES}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-content-primary">
              Preço de venda (R$)
              <input
                type="text"
                inputMode="decimal"
                value={form.priceInput}
                onChange={(event) => updateField('priceInput', event.target.value)}
                placeholder="7,00"
                className={FIELD_CLASSES}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-content-primary">
              Custo (R$)
              <input
                type="text"
                inputMode="decimal"
                value={form.costInput}
                onChange={(event) => updateField('costInput', event.target.value)}
                placeholder="3,50"
                className={FIELD_CLASSES}
              />
            </label>
          </div>

          {/* Só no cadastro: depois de criado, estoque muda por movimento em
              /estoque, que deixa rastro de quem mexeu e quando. Mostrar o
              campo na edição convidaria a corrigir estoque por fora do
              histórico. */}
          {!editingId && (
            <label className="flex flex-col gap-1 text-sm text-content-muted">
              Estoque inicial (opcional)
              <input
                type="text"
                inputMode="numeric"
                value={form.stockInput}
                onChange={(event) => updateField('stockInput', event.target.value)}
                placeholder="24"
                className={FIELD_CLASSES}
              />
              <span className="text-xs text-content-muted">
                Deixe em branco se você não controla o estoque deste item. Zero significa
                que você controla e o estoque acabou.
              </span>
            </label>
          )}

          <label className="flex min-h-11 items-center gap-2 text-sm text-content-primary">
            <input
              type="checkbox"
              checked={form.favorite}
              onChange={(event) => updateField('favorite', event.target.checked)}
              className={CHECKBOX_CLASSES}
            />
            Favorito (aparece primeiro no lançamento)
          </label>

          {formError && (
            <p role="alert" className="text-sm font-medium text-accent">
              {formError}
            </p>
          )}
          {saveError && (
            <p role="alert" className="text-sm font-medium text-accent">
              {describeBarError(saveError, BAR_ERROR_FALLBACKS.item)}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={isSaving}>
              {editingId ? 'Salvar item' : 'Cadastrar item'}
            </Button>
            {editingId && (
              <Button type="button" variant="ghost" onClick={resetForm}>
                Cancelar edição
              </Button>
            )}
          </div>
        </form>
      </Card>

      {setItemActive.isError && (
        <p role="alert" className="text-sm font-medium text-accent">
          {describeBarError(setItemActive.error, BAR_ERROR_FALLBACKS.item)}
        </p>
      )}

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
          description="Cadastre um item acima ou ajuste a busca e o filtro de categoria."
        />
      ) : (
        <ItemTable
          caption="Itens ativos"
          items={active}
          isBusy={setItemActive.isPending}
          onEdit={startEditing}
          onToggleActive={(item) =>
            setItemActive.mutate({ id: item.id, active: !isItemActive(item) })
          }
        />
      )}

      {inactive.length > 0 && (
        <div>
          <h2 className="mb-2 text-lg font-semibold text-content-primary">Itens inativos</h2>
          <p className="mb-2 text-sm text-content-muted">
            Não aparecem no lançamento. O que já foi vendido continua no histórico e nos
            relatórios.
          </p>
          <ItemTable
            caption="Itens inativos"
            items={inactive}
            isBusy={setItemActive.isPending}
            onEdit={startEditing}
            onToggleActive={(item) =>
              setItemActive.mutate({ id: item.id, active: !isItemActive(item) })
            }
          />
        </div>
      )}
    </div>
  )
}

interface ItemTableProps {
  readonly caption: string
  readonly items: readonly Item[]
  readonly isBusy: boolean
  readonly onEdit: (item: Item) => void
  readonly onToggleActive: (item: Item) => void
}

function ItemTable({ caption, items, isBusy, onEdit, onToggleActive }: ItemTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle">
      <table className="w-full min-w-[900px] text-left text-sm" aria-label={caption}>
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
            <th scope="col" className="px-3 py-2">Ações</th>
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
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    className="text-xs"
                    aria-label={`Editar ${item.name}`}
                    onClick={() => onEdit(item)}
                  >
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    className="text-xs"
                    aria-label={
                      `${isItemActive(item) ? 'Desativar' : 'Reativar'} ${item.name}`
                    }
                    disabled={isBusy}
                    onClick={() => onToggleActive(item)}
                  >
                    {isItemActive(item) ? 'Desativar' : 'Reativar'}
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
