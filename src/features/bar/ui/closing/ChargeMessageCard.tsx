import { useState } from 'react'

import { Button } from '../../../../shared/ui/Button'
import { Card } from '../../../../shared/ui/Card'
import { buildChargeMessage, type ChargeMessageLine } from '../../domain/charge-message'

export interface ChargeMessageCardProps {
  readonly consumerName: string
  readonly month: string
  readonly lines: readonly ChargeMessageLine[]
  readonly totalCents: number
  readonly paidCents: number
  readonly remainingCents: number
}

type CopyFeedback = 'success' | 'error'

const COPY_SUCCESS_MESSAGE = 'Mensagem copiada.'
const COPY_ERROR_MESSAGE = 'Não foi possível copiar a mensagem. Copie manualmente.'

/**
 * Shows the copyable pt-BR charge message for one member and a "Copiar"
 * button. Never opens WhatsApp or any external app — that is out of scope
 * for this phase; the operator pastes the message wherever they choose.
 */
export function ChargeMessageCard({
  consumerName,
  month,
  lines,
  totalCents,
  paidCents,
  remainingCents,
}: ChargeMessageCardProps) {
  const [feedback, setFeedback] = useState<CopyFeedback>()
  const message = buildChargeMessage({
    consumerName,
    month,
    lines,
    totalCents,
    paidCents,
    remainingCents,
  })

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message)
      setFeedback('success')
    } catch {
      setFeedback('error')
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <pre className="whitespace-pre-wrap font-sans text-sm text-content-primary">{message}</pre>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={handleCopy}>
          Copiar mensagem
        </Button>
        {feedback === 'success' ? (
          <p role="status" className="text-sm text-positive">
            {COPY_SUCCESS_MESSAGE}
          </p>
        ) : null}
        {feedback === 'error' ? (
          <p role="alert" className="text-sm text-accent">
            {COPY_ERROR_MESSAGE}
          </p>
        ) : null}
      </div>
    </Card>
  )
}
