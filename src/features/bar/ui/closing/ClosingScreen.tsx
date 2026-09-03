import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { CURRENT_ACTOR_ID } from '../../application/actor'
import type { BarDatabase } from '../../application/bar-repository'
import { useBarSnapshot, useInvalidateBar } from '../../application/queries'
import { useBarRepository } from '../../application/repository-context'
import { PAYMENT_STATUS, type PaymentStatus } from '../../domain/constants'
import type { MemberStatement, MonthlyClosing } from '../../domain/entities'
import { formatMonth, getCurrentMonth } from '../../../../shared/date'
import { formatCents, formatDateTime, formatQuantity } from '../../../../shared/format'
import { Button } from '../../../../shared/ui/Button'
import { Card } from '../../../../shared/ui/Card'
import { EmptyState } from '../../../../shared/ui/EmptyState'
import { ChargeMessageCard } from './ChargeMessageCard'
import { describeClosingError } from './closing-messages'
import {
  buildMonthPreview,
  listClosingMonths,
  summarizeClosedStatement,
  type ClosedMemberStatementView,
  type ClosingLine,
  type ClosingMonthOption,
  type MemberMonthPreview,
} from './closing-selectors'

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  [PAYMENT_STATUS.PAID]: 'Pago',
  [PAYMENT_STATUS.PARTIAL]: 'Parcial',
  [PAYMENT_STATUS.UNPAID]: 'Em aberto',
}

const PAYMENT_STATUS_TEXT_CLASSES: Record<PaymentStatus, string> = {
  [PAYMENT_STATUS.PAID]: 'text-positive',
  [PAYMENT_STATUS.PARTIAL]: 'text-warning',
  [PAYMENT_STATUS.UNPAID]: 'text-content-muted',
}

/**
 * `/fechamento`: a live preview of a month before closing it, and — once
 * `createMonthlyClosing` has run for that month — the frozen statements it
 * produced. The screen itself never writes anything; only the "Fechar mês"
 * mutation does, and it is only reachable while no closing exists yet for
 * the selected month.
 *
 * The month is chosen explicitly, defaulting to the current one. Pinning it
 * to `getCurrentMonth()` used to make an unclosed month unclosable forever
 * once the calendar rolled over, and hid every earlier month's frozen
 * statements and charge messages (Ruling 27(b)).
 */
export function ClosingScreen() {
  const currentMonth = getCurrentMonth()
  const [selectedMonth, setSelectedMonth] = useState<string>()
  const repository = useBarRepository()
  const invalidateBar = useInvalidateBar()
  const { data: snapshot, isPending, isError } = useBarSnapshot()

  const month = selectedMonth ?? currentMonth
  const createClosing = useMutation({
    mutationFn: () => repository.createMonthlyClosing({ month, actorId: CURRENT_ACTOR_ID }),
    onSuccess: () => {
      invalidateBar()
    },
  })

  const closing = snapshot?.monthlyClosings.find((entry) => entry.month === month)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold text-content-primary">Fechamento</h1>
        {snapshot ? (
          <MonthPicker
            options={listClosingMonths(snapshot, currentMonth)}
            month={month}
            onChange={(picked) => {
              setSelectedMonth(picked)
              createClosing.reset()
            }}
          />
        ) : null}
      </header>

      {isPending ? <p className="text-content-muted">Carregando fechamento…</p> : null}

      {isError ? (
        <EmptyState
          title="Não foi possível carregar o fechamento"
          description="Tente novamente em instantes."
        />
      ) : null}

      {snapshot && closing ? (
        <ClosedMonthView snapshot={snapshot} month={month} closing={closing} />
      ) : null}

      {snapshot && !closing ? (
        <PreviewMonthView
          snapshot={snapshot}
          month={month}
          onClose={() => createClosing.mutate()}
          isClosing={createClosing.isPending}
          errorMessage={
            createClosing.isError ? describeClosingError(createClosing.error) : undefined
          }
        />
      ) : null}
    </div>
  )
}

interface MonthPickerProps {
  readonly options: readonly ClosingMonthOption[]
  readonly month: string
  readonly onChange: (month: string) => void
}

/**
 * Which month the screen is acting on. Every month with consumption still
 * waiting to be closed is offered, plus every month already closed so its
 * frozen statements stay reachable after the calendar rolls over.
 */
function MonthPicker({ options, month, onChange }: MonthPickerProps) {
  return (
    <label className="flex max-w-xs flex-col gap-1 text-sm text-content-muted">
      Mês do fechamento
      <select
        value={month}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 rounded-md border border-border-subtle bg-surface-raised px-3 text-sm text-content-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {options.map((option) => (
          <option key={option.month} value={option.month}>
            {option.isClosed ? `${formatMonth(option.month)} (fechado)` : formatMonth(option.month)}
          </option>
        ))}
      </select>
    </label>
  )
}

interface PreviewMonthViewProps {
  readonly snapshot: BarDatabase
  readonly month: string
  readonly onClose: () => void
  readonly isClosing: boolean
  readonly errorMessage?: string
}

function PreviewMonthView({
  snapshot,
  month,
  onClose,
  isClosing,
  errorMessage,
}: PreviewMonthViewProps) {
  const preview = buildMonthPreview(snapshot, month)

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-content-muted">Situação do mês</p>
          <p className="text-base font-semibold text-content-primary">
            Prévia — nada foi salvo ainda.
          </p>
        </div>
        <CloseMonthAction
          month={month}
          isClosing={isClosing}
          errorMessage={errorMessage}
          onConfirm={onClose}
        />
      </Card>

      {preview.length === 0 ? (
        <EmptyState
          title="Nenhum consumo neste mês"
          description="Nenhum integrante lançou consumo em nome próprio até agora."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {preview.map((row) => (
            <MemberPreviewCard key={row.consumer.id} row={row} />
          ))}
        </div>
      )}
    </div>
  )
}

interface CloseMonthActionProps {
  readonly month: string
  readonly isClosing: boolean
  readonly errorMessage?: string
  readonly onConfirm: () => void
}

type CloseConfirmMode = 'idle' | 'confirm'

/**
 * Closing a month is irreversible — it freezes the month into statements
 * and closes every member's monthly tab, with no reopen path anywhere in
 * the repository — so it requires an explicit two-step confirmation, the
 * same in-place pattern `TabCard` uses for closing/reopening a visitor tab.
 * The trigger button and the confirm box are mutually exclusive, so there
 * is never a moment where a second click could fire the mutation twice.
 */
function CloseMonthAction({ month, isClosing, errorMessage, onConfirm }: CloseMonthActionProps) {
  const [mode, setMode] = useState<CloseConfirmMode>('idle')

  if (mode !== 'confirm') {
    return (
      <Button onClick={() => setMode('confirm')} disabled={isClosing}>
        Fechar mês
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-subtle p-3">
      <p className="text-sm text-content-primary">
        Confirma o fechamento de {formatMonth(month)}? Esta ação é irreversível: as comandas
        mensais dos integrantes serão fechadas e o consumo do mês será congelado em extratos
        individuais.
      </p>
      {errorMessage ? (
        <p role="alert" className="text-sm font-medium text-accent">
          {errorMessage}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={onConfirm} disabled={isClosing}>
          {isClosing ? 'Fechando…' : 'Confirmar fechamento'}
        </Button>
        <Button variant="ghost" onClick={() => setMode('idle')} disabled={isClosing}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}

function MemberPreviewCard({ row }: { readonly row: MemberMonthPreview }) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-base font-semibold text-content-primary">{row.consumer.name}</p>
        <span className="text-sm text-content-muted">Aguardando fechamento</span>
      </div>
      <ClosingLineList lines={row.lines} />
      <p className="text-sm font-medium text-content-primary">
        Total: {formatCents(row.totalCents)}
      </p>
    </Card>
  )
}

interface ClosedMonthViewProps {
  readonly snapshot: BarDatabase
  readonly month: string
  readonly closing: MonthlyClosing
}

function ClosedMonthView({ snapshot, month, closing }: ClosedMonthViewProps) {
  const statements = closing.statementIds
    .map((id) => snapshot.memberStatements.find((statement) => statement.id === id))
    .filter((statement): statement is MemberStatement => Boolean(statement))
  const summaries = statements
    .map((statement) => summarizeClosedStatement(snapshot, statement))
    .filter((summary): summary is ClosedMemberStatementView => Boolean(summary))

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-content-muted">Situação do mês</p>
          <p className="text-base font-semibold text-content-primary">
            Fechado em {formatDateTime(closing.closedAt)}
          </p>
        </div>
        <Button disabled title="Este mês já foi fechado.">
          Fechar mês
        </Button>
      </Card>

      <p className="text-sm text-content-muted">
        Este mês já foi fechado e não pode ser fechado novamente. Os extratos abaixo estão
        congelados e refletem exatamente o que foi consolidado.
      </p>

      {summaries.length === 0 ? (
        <EmptyState
          title="Nenhum extrato neste fechamento"
          description="Nenhum integrante teve consumo lançado no mês."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {summaries.map((summary) => (
            <ClosedStatementCard key={summary.statement.id} summary={summary} month={month} />
          ))}
        </div>
      )}
    </div>
  )
}

function ClosedStatementCard({
  summary,
  month,
}: {
  readonly summary: ClosedMemberStatementView
  readonly month: string
}) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-base font-semibold text-content-primary">{summary.consumer.name}</p>
        <span className={`text-sm font-medium ${PAYMENT_STATUS_TEXT_CLASSES[summary.payment.status]}`}>
          {PAYMENT_STATUS_LABELS[summary.payment.status]}
        </span>
      </div>
      <ClosingLineList lines={summary.lines} />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-content-primary">
        <span>Total: {formatCents(summary.totalCents)}</span>
        <span>Pago: {formatCents(summary.payment.paidCents)}</span>
        <span>Restante: {formatCents(summary.payment.remainingCents)}</span>
      </div>
      <ChargeMessageCard
        consumerName={summary.consumer.name}
        month={month}
        lines={summary.lines}
        totalCents={summary.totalCents}
        paidCents={summary.payment.paidCents}
        remainingCents={summary.payment.remainingCents}
      />
    </Card>
  )
}

function ClosingLineList({ lines }: { readonly lines: readonly ClosingLine[] }) {
  if (lines.length === 0) {
    return <p className="text-sm text-content-muted">Sem itens cobrados.</p>
  }

  return (
    <ul className="flex flex-col gap-1 text-sm text-content-muted">
      {lines.map((line, index) => (
        <li key={`${line.itemName}-${index}`}>
          {formatQuantity(line.quantity)}× {line.itemName} — {formatCents(line.subtotalCents)}
        </li>
      ))}
    </ul>
  )
}
