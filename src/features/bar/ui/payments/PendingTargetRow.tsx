import { useState, type FormEvent } from 'react'

import { formatCents, formatDateTime } from '../../../../shared/format'
import { Button } from '../../../../shared/ui/Button'
import { Card } from '../../../../shared/ui/Card'
import { CURRENT_ACTOR_ID, CURRENT_ACTOR_NAME } from '../../application/actor'
import { PAYMENT_STATUS, type PaymentStatus } from '../../domain/constants'
import type { Payment } from '../../domain/entities'
import { parsePaymentAmount } from './payment-amount'
import type { PendingTarget } from './pending-targets'

const FIELD_CLASSES =
  'min-h-11 rounded-md border border-border-subtle bg-surface-raised px-3 text-sm text-content-primary ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  [PAYMENT_STATUS.UNPAID]: 'Não pago',
  [PAYMENT_STATUS.PARTIAL]: 'Parcial',
  [PAYMENT_STATUS.PAID]: 'Pago',
}

export interface PendingTargetRowProps {
  readonly target: PendingTarget
  readonly expanded: boolean
  readonly onToggle: () => void
  readonly onSubmit: (amountCents: number) => void
  readonly isSubmitting: boolean
  readonly submitErrorMessage?: string
}

/**
 * One payable target (a visitor's event tab or a member's monthly
 * statement) with money still owed. Expanding it reveals the amount form
 * and this target's own payment history.
 */
export function PendingTargetRow({
  target,
  expanded,
  onToggle,
  onSubmit,
  isSubmitting,
  submitErrorMessage,
}: PendingTargetRowProps) {
  const [amountInput, setAmountInput] = useState('')
  const [validationError, setValidationError] = useState<string | undefined>(undefined)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setValidationError(undefined)

    const result = parsePaymentAmount(amountInput, target.payment.remainingCents)
    if (!result.ok) {
      setValidationError(result.error)
      return
    }

    onSubmit(result.amountCents)
    setAmountInput('')
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-content-primary">{target.label}</p>
          <p className="mt-1 text-sm font-semibold text-warning">
            {PAYMENT_STATUS_LABELS[target.payment.status]}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <Money label="Total" cents={target.totalCents} />
          <Money label="Pago" cents={target.payment.paidCents} />
          <Money label="Em aberto" cents={target.payment.remainingCents} emphasized />
        </div>
        <Button variant="ghost" onClick={onToggle}>
          Registrar pagamento
        </Button>
      </div>

      {expanded ? (
        <div className="flex flex-col gap-4 border-t border-border-subtle pt-3">
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm text-content-primary">
              Valor do pagamento
              <input
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                className={FIELD_CLASSES}
              />
            </label>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Registrando…' : 'Confirmar pagamento'}
            </Button>
          </form>

          {validationError ? (
            <p role="alert" className="text-sm font-medium text-accent">
              {validationError}
            </p>
          ) : null}
          {submitErrorMessage ? (
            <p role="alert" className="text-sm font-medium text-accent">
              {submitErrorMessage}
            </p>
          ) : null}

          <PaymentHistory payments={target.payments} />
        </div>
      ) : null}
    </Card>
  )
}

interface MoneyProps {
  readonly label: string
  readonly cents: number
  readonly emphasized?: boolean
}

function Money({ label, cents, emphasized = false }: MoneyProps) {
  return (
    <span className="flex flex-col items-end">
      <span className="text-xs text-content-muted">{label}</span>
      <span
        className={
          emphasized ? 'font-semibold text-content-primary' : 'text-content-primary'
        }
      >
        {formatCents(cents)}
      </span>
    </span>
  )
}

interface PaymentHistoryProps {
  readonly payments: readonly Payment[]
}

function PaymentHistory({ payments }: PaymentHistoryProps) {
  if (payments.length === 0) {
    return <p className="text-sm text-content-muted">Nenhum pagamento registrado ainda.</p>
  }

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-muted">
        Histórico de pagamentos
      </h3>
      <ul className="flex flex-col gap-1">
        {payments.map((payment) => (
          <li key={payment.id} className="flex flex-wrap items-baseline justify-between gap-3 text-sm">
            <span className="text-content-muted">{formatDateTime(payment.paidAt)}</span>
            <span className="text-content-primary">{formatCents(payment.amountCents)}</span>
            <span className="text-content-muted">
              {payment.actorId === CURRENT_ACTOR_ID ? CURRENT_ACTOR_NAME : payment.actorId}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
