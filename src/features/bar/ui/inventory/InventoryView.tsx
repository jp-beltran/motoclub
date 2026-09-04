import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { formatDateTime, formatQuantity } from '../../../../shared/format'
import { Button } from '../../../../shared/ui/Button'
import { Card } from '../../../../shared/ui/Card'
import { CURRENT_ACTOR_ID } from '../../application/actor'
import type { AddStockMovementInput } from '../../application/bar-repository'
import { useInvalidateBar, useBarSnapshot } from '../../application/queries'
import { useBarRepository } from '../../application/repository-context'
import { BAR_ERROR_FALLBACKS, describeBarError } from '../../application/error-messages'
import { STOCK_MOVEMENT_KIND } from '../../domain/constants'
import { StockStatusBadge } from './StockStatusBadge'
import {
  formatActorName,
  formatMovementKind,
  parseMovementQuantity,
  sortMovementsDescending,
  type ManualMovementKind,
} from './movement-utils'
import { getTrackedItems } from './stock-status'

const FIELD_CLASSES =
  'min-h-11 rounded-md border border-border-subtle bg-surface-raised px-3 text-sm text-content-primary ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

const RADIO_CLASSES =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

export function InventoryView() {
  const snapshotQuery = useBarSnapshot()
  const repository = useBarRepository()
  const invalidateBar = useInvalidateBar()

  const [kind, setKind] = useState<ManualMovementKind>(STOCK_MOVEMENT_KIND.ENTRY)
  const [itemId, setItemId] = useState('')
  const [quantityInput, setQuantityInput] = useState('')
  const [validationError, setValidationError] = useState<string | undefined>(undefined)

  const mutation = useMutation({
    mutationFn: (input: AddStockMovementInput) => repository.addStockMovement(input),
    onSuccess: () => {
      invalidateBar()
      setQuantityInput('')
    },
  })

  if (!snapshotQuery.data) return null

  const { items, stockMovements } = snapshotQuery.data
  const trackedItems = getTrackedItems(items)
  const sortedMovements = sortMovementsDescending(stockMovements)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setValidationError(undefined)
    mutation.reset()

    if (!itemId) {
      setValidationError('Selecione um item.')
      return
    }

    const result = parseMovementQuantity(kind, quantityInput)
    if (!result.ok) {
      setValidationError(result.error)
      return
    }

    mutation.mutate({
      itemId,
      kind,
      quantityDelta: result.quantityDelta,
      actorId: CURRENT_ACTOR_ID,
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-content-primary">Estoque</h1>
        <p className="mt-1 text-sm text-content-muted">
          Registre entradas e ajustes e acompanhe o histórico de movimentações.
        </p>
      </div>

      <Card>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <fieldset className="flex flex-wrap gap-4">
            <legend className="mb-2 text-sm font-medium text-content-primary">
              Tipo de movimento
            </legend>
            <label className="flex min-h-11 items-center gap-2 text-sm text-content-primary">
              <input
                type="radio"
                name="movement-kind"
                value={STOCK_MOVEMENT_KIND.ENTRY}
                checked={kind === STOCK_MOVEMENT_KIND.ENTRY}
                onChange={() => setKind(STOCK_MOVEMENT_KIND.ENTRY)}
                className={RADIO_CLASSES}
              />
              Entrada
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm text-content-primary">
              <input
                type="radio"
                name="movement-kind"
                value={STOCK_MOVEMENT_KIND.ADJUSTMENT}
                checked={kind === STOCK_MOVEMENT_KIND.ADJUSTMENT}
                onChange={() => setKind(STOCK_MOVEMENT_KIND.ADJUSTMENT)}
                className={RADIO_CLASSES}
              />
              Ajuste
            </label>
          </fieldset>

          <label className="flex flex-col gap-1 text-sm text-content-primary">
            Item
            <select
              value={itemId}
              onChange={(event) => setItemId(event.target.value)}
              className={FIELD_CLASSES}
            >
              <option value="">Selecione um item</option>
              {trackedItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-content-primary">
            Quantidade
            <input
              type="text"
              inputMode="numeric"
              value={quantityInput}
              onChange={(event) => setQuantityInput(event.target.value)}
              className={FIELD_CLASSES}
            />
          </label>
          {kind === STOCK_MOVEMENT_KIND.ADJUSTMENT && (
            <p className="text-xs text-content-muted">
              Use um valor negativo para reduzir o estoque. Se o saldo ficar negativo, o item
              fica marcado como déficit até um novo ajuste acertar a contagem — nada é
              zerado automaticamente.
            </p>
          )}

          {validationError && (
            <p role="alert" className="text-sm font-medium text-accent">
              {validationError}
            </p>
          )}
          {mutation.isError && (
            <p role="alert" className="text-sm font-medium text-accent">
              {describeBarError(mutation.error, BAR_ERROR_FALLBACKS.stockMovement)}
            </p>
          )}

          <Button type="submit" disabled={mutation.isPending} className="self-start">
            Registrar movimentação
          </Button>
        </form>
      </Card>

      <div>
        <h2 className="mb-2 text-lg font-semibold text-content-primary">Estoque atual</h2>
        {trackedItems.length === 0 ? (
          <p className="text-sm text-content-muted">Nenhum item com controle de estoque.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border-subtle">
            <table className="w-full text-left text-sm" aria-label="Estoque atual">
              <caption className="sr-only">Estoque atual</caption>
              <thead className="bg-surface-overlay text-xs uppercase tracking-wide text-content-muted">
                <tr>
                  <th scope="col" className="px-3 py-2">Item</th>
                  <th scope="col" className="px-3 py-2">Quantidade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle bg-surface-raised">
                {trackedItems.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2 text-content-primary">{item.name}</td>
                    <td className="px-3 py-2">
                      <StockStatusBadge item={item} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold text-content-primary">
          Histórico de movimentações
        </h2>
        {sortedMovements.length === 0 ? (
          <p className="text-sm text-content-muted">Nenhuma movimentação registrada.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border-subtle">
            <table className="w-full text-left text-sm" aria-label="Histórico de movimentações">
              <caption className="sr-only">Histórico de movimentações</caption>
              <thead className="bg-surface-overlay text-xs uppercase tracking-wide text-content-muted">
                <tr>
                  <th scope="col" className="px-3 py-2">Tipo</th>
                  <th scope="col" className="px-3 py-2">Data</th>
                  <th scope="col" className="px-3 py-2">Item</th>
                  <th scope="col" className="px-3 py-2">Quantidade</th>
                  <th scope="col" className="px-3 py-2">Responsável</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle bg-surface-raised">
                {sortedMovements.map((movement) => {
                  const item = items.find(({ id }) => id === movement.itemId)
                  const deltaLabel =
                    movement.quantityDelta > 0
                      ? `+${formatQuantity(movement.quantityDelta)}`
                      : formatQuantity(movement.quantityDelta)
                  return (
                    <tr key={movement.id}>
                      <td className="px-3 py-2 text-content-primary">
                        {formatMovementKind(movement.kind)}
                      </td>
                      <td className="px-3 py-2 text-content-muted">
                        {formatDateTime(movement.occurredAt)}
                      </td>
                      <td className="px-3 py-2 text-content-primary">
                        {item?.name ?? movement.itemId}
                      </td>
                      <td className="px-3 py-2 text-content-primary">{deltaLabel}</td>
                      <td className="px-3 py-2 text-content-muted">
                        {formatActorName(movement.actorId)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
