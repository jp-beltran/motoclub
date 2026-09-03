import { useState } from 'react'

import { formatCents, formatQuantity } from '../../../../shared/format'
import { Button } from '../../../../shared/ui/Button'
import { Card } from '../../../../shared/ui/Card'
import type { TabLine, TabSummary } from '../../application/tab-summary'
import { TAB_STATUS } from '../../domain/constants'
import { PaymentStatusBadge, TabStatusBadge } from './StatusBadges'

export interface TabCardProps {
  readonly summary: TabSummary
  /** Whether the tab's own event is currently active. */
  readonly eventActive: boolean
  readonly onClose: (tabId: string) => void
  readonly onReopen: (tabId: string) => void
  readonly isClosePending: boolean
  readonly isReopenPending: boolean
  readonly closeErrorMessage?: string
  readonly reopenErrorMessage?: string
}

type ConfirmMode = 'idle' | 'confirm-close' | 'confirm-reopen'

/**
 * One visitor's event tab: its preserved summary (always visible, closed or
 * open) plus the close/reopen action. Both actions require an explicit
 * confirmation step — reopening in particular must never happen implicitly,
 * per the defect fixed in commit f840adc.
 */
export function TabCard({
  summary,
  eventActive,
  onClose,
  onReopen,
  isClosePending,
  isReopenPending,
  closeErrorMessage,
  reopenErrorMessage,
}: TabCardProps) {
  const [mode, setMode] = useState<ConfirmMode>('idle')
  const { tab, consumer, lines, courtesyLines, totalCents, payment } = summary
  const isOpen = tab.status === TAB_STATUS.OPEN

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="font-semibold text-content-primary">{consumer.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <TabStatusBadge status={tab.status} />
            <PaymentStatusBadge status={payment.status} />
          </div>
        </div>
        <p className="text-lg font-semibold text-content-primary">{formatCents(totalCents)}</p>
      </div>

      {lines.length > 0 ? <LineList title="Consumo" lines={lines} /> : null}
      {courtesyLines.length > 0 ? (
        <LineList title="Cortesias (não somam no total)" lines={courtesyLines} />
      ) : null}

      {payment.remainingCents > 0 ? (
        <p className="text-sm text-content-muted">
          Saldo em aberto: {formatCents(payment.remainingCents)}
        </p>
      ) : null}

      {isOpen ? (
        <CloseAction
          mode={mode}
          setMode={setMode}
          totalCents={totalCents}
          isPending={isClosePending}
          errorMessage={closeErrorMessage}
          onConfirm={() => onClose(tab.id)}
        />
      ) : eventActive ? (
        <ReopenAction
          mode={mode}
          setMode={setMode}
          isPending={isReopenPending}
          errorMessage={reopenErrorMessage}
          onConfirm={() => onReopen(tab.id)}
        />
      ) : (
        <p className="text-sm text-content-muted">
          Evento encerrado — a comanda não pode ser reaberta.
        </p>
      )}
    </Card>
  )
}

interface LineListProps {
  readonly title: string
  readonly lines: readonly TabLine[]
}

function LineList({ title, lines }: LineListProps) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-content-muted">
        {title}
      </h3>
      <ul className="flex flex-col gap-1">
        {lines.map((line) => (
          <li key={line.itemId} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-content-primary">
              {`${formatQuantity(line.quantity)}× ${line.itemName}`}
            </span>
            <span className="text-content-muted">{formatCents(line.subtotalCents)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface CloseActionProps {
  readonly mode: ConfirmMode
  readonly setMode: (mode: ConfirmMode) => void
  readonly totalCents: number
  readonly isPending: boolean
  readonly errorMessage?: string
  readonly onConfirm: () => void
}

function CloseAction({ mode, setMode, totalCents, isPending, errorMessage, onConfirm }: CloseActionProps) {
  if (mode !== 'confirm-close') {
    return (
      <Button variant="ghost" onClick={() => setMode('confirm-close')} className="self-start">
        Fechar comanda
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-subtle p-3">
      <p className="text-sm text-content-primary">
        Confirma o fechamento desta comanda? O total registrado é {formatCents(totalCents)}.
      </p>
      {errorMessage ? (
        <p role="alert" className="text-sm font-medium text-accent">
          {errorMessage}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={onConfirm} disabled={isPending}>
          {isPending ? 'Fechando…' : 'Confirmar fechamento'}
        </Button>
        <Button variant="ghost" onClick={() => setMode('idle')} disabled={isPending}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}

interface ReopenActionProps {
  readonly mode: ConfirmMode
  readonly setMode: (mode: ConfirmMode) => void
  readonly isPending: boolean
  readonly errorMessage?: string
  readonly onConfirm: () => void
}

function ReopenAction({ mode, setMode, isPending, errorMessage, onConfirm }: ReopenActionProps) {
  if (mode !== 'confirm-reopen') {
    return (
      <Button variant="ghost" onClick={() => setMode('confirm-reopen')} className="self-start">
        Reabrir comanda
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-subtle p-3">
      <p className="text-sm text-content-primary">
        Tem certeza que deseja reabrir esta comanda?
      </p>
      {errorMessage ? (
        <p role="alert" className="text-sm font-medium text-accent">
          {errorMessage}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={onConfirm} disabled={isPending}>
          {isPending ? 'Reabrindo…' : 'Confirmar reabertura'}
        </Button>
        <Button variant="ghost" onClick={() => setMode('idle')} disabled={isPending}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}
