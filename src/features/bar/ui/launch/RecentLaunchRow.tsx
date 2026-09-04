import { useState } from 'react'

import type { ReassignTarget } from '../../application/consumer-tab'
import { describeCancellationBlock } from '../../application/error-messages'
import type { RecentLaunch } from '../../application/recent-launches'
import { formatCents, formatDateTime, formatQuantity } from '../../../../shared/format'
import { Button } from '../../../../shared/ui/Button'

type RowMode = 'idle' | 'quantity' | 'reassign'

const FIELD_CLASSES =
  'min-h-11 w-full rounded-md border border-border-subtle bg-surface-base px-3 text-sm ' +
  'text-content-primary focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-accent'

export interface RecentLaunchRowProps {
  readonly launch: RecentLaunch
  readonly targets: readonly ReassignTarget[]
  readonly onEditQuantity: (quantity: number) => void
  readonly onReassign: (targetTabId: string) => void
  readonly onCancel: () => void
}

/**
 * One correction row: fix the quantity, move it to another tab, or undo it.
 *
 * Both "Editar quantidade" and "Cancelar" go through the repository's
 * `cancelConsumption`, which refuses a launch already frozen into a member
 * statement, sitting on a closed tab, or covered by a settled payment. Where
 * that applies the row disables them and prints the reason, rather than
 * offering a click that only fails afterwards.
 */
export function RecentLaunchRow({
  launch,
  targets,
  onEditQuantity,
  onReassign,
  onCancel,
}: RecentLaunchRowProps) {
  const [mode, setMode] = useState<RowMode>('idle')
  const [quantity, setQuantity] = useState(String(launch.consumption.quantity))
  const [targetTabId, setTargetTabId] = useState('')

  const parsedQuantity = Number.parseInt(quantity, 10)
  const hasValidQuantity = Number.isInteger(parsedQuantity) && parsedQuantity > 0
  const label = `${launch.itemName} de ${launch.consumerName}`
  const blockReason = launch.cancellationBlock
    ? describeCancellationBlock(launch.cancellationBlock)
    : undefined

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-raised p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-content-primary">
            {`${formatQuantity(launch.consumption.quantity)}× ${launch.itemName}`}
          </p>
          <p className="text-xs text-content-muted">
            {`${launch.consumerName} · ${formatDateTime(launch.consumption.createdAt)}`}
          </p>
        </div>
        <p className="text-sm text-content-primary">
          {launch.isCourtesy ? 'Cortesia' : formatCents(launch.lineTotalCents)}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          aria-label={`Editar quantidade de ${label}`}
          aria-expanded={mode === 'quantity'}
          disabled={Boolean(blockReason)}
          title={blockReason}
          onClick={() => setMode((current) => (current === 'quantity' ? 'idle' : 'quantity'))}
          className="text-xs"
        >
          Editar quantidade
        </Button>
        <Button
          variant="ghost"
          aria-label={`Trocar consumidor de ${label}`}
          aria-expanded={mode === 'reassign'}
          disabled={targets.length === 0}
          onClick={() => setMode((current) => (current === 'reassign' ? 'idle' : 'reassign'))}
          className="text-xs"
        >
          Trocar consumidor
        </Button>
        <Button
          variant="danger"
          aria-label={`Cancelar ${label}`}
          disabled={Boolean(blockReason)}
          title={blockReason}
          onClick={onCancel}
          className="text-xs"
        >
          Cancelar
        </Button>
      </div>

      {blockReason ? <p className="text-xs text-content-muted">{blockReason}</p> : null}

      {mode === 'quantity' ? (
        <div className="flex flex-wrap items-end gap-2 rounded-md bg-surface-overlay p-3">
          <label className="flex flex-1 flex-col gap-1 text-xs text-content-muted">
            {`Nova quantidade de ${label}`}
            <input
              type="number"
              min={1}
              step={1}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className={FIELD_CLASSES}
            />
          </label>
          <Button
            aria-label={`Salvar quantidade de ${label}`}
            disabled={!hasValidQuantity}
            onClick={() => {
              onEditQuantity(parsedQuantity)
              setMode('idle')
            }}
            className="text-xs"
          >
            Salvar
          </Button>
        </div>
      ) : null}

      {mode === 'reassign' ? (
        <div className="flex flex-wrap items-end gap-2 rounded-md bg-surface-overlay p-3">
          <label className="flex flex-1 flex-col gap-1 text-xs text-content-muted">
            {`Novo consumidor de ${label}`}
            <select
              value={targetTabId}
              onChange={(event) => setTargetTabId(event.target.value)}
              className={FIELD_CLASSES}
            >
              <option value="">Selecione</option>
              {targets.map((target) => (
                <option key={target.tabId} value={target.tabId}>
                  {target.consumerName}
                </option>
              ))}
            </select>
          </label>
          <Button
            aria-label={`Confirmar troca de ${label}`}
            disabled={!targetTabId}
            onClick={() => {
              onReassign(targetTabId)
              setMode('idle')
              setTargetTabId('')
            }}
            className="text-xs"
          >
            Mover
          </Button>
        </div>
      ) : null}
    </li>
  )
}
