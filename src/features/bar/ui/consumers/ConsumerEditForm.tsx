import { useState } from 'react'

import { describeBarError } from '../../application/error-messages'
import { useUpdateConsumer } from '../../application/queries'
import type { Consumer } from '../../domain/entities'
import { Button } from '../../../../shared/ui/Button'

const FIELD_CLASSES =
  'min-h-11 w-full rounded-md border border-border-subtle bg-surface-base px-3 text-sm ' +
  'text-content-primary placeholder:text-content-muted focus-visible:outline ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

export interface ConsumerEditFormProps {
  readonly consumer: Consumer
  readonly onSaved: (consumer: Consumer) => void
  readonly onCancel: () => void
}

/**
 * Corrects a mistyped name or phone. Typos happen, and until now a wrong
 * name was permanent.
 *
 * Only these two fields: the kind decides which kind of tab — and therefore
 * which kind of debt — the consumer already carries, and the active flag has
 * its own control next to the outstanding total, where the consequence of
 * flipping it is visible. Emptying the phone field removes the stored phone;
 * that is `updateConsumer`'s contract, not a decision made here.
 */
export function ConsumerEditForm({ consumer, onSaved, onCancel }: ConsumerEditFormProps) {
  const [name, setName] = useState(consumer.name)
  const [phone, setPhone] = useState(consumer.phone ?? '')
  const updateConsumer = useUpdateConsumer()

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    updateConsumer.mutate(
      { id: consumer.id, name, phone },
      { onSuccess: (updated) => onSaved(updated) },
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label={`Corrigir dados de ${consumer.name}`}
      className="flex flex-col gap-3 rounded-md border border-border-subtle bg-surface-overlay p-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-content-muted">
          Nome
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={FIELD_CLASSES}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-content-muted">
          Telefone (opcional)
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="(11) 90000-0000"
            className={FIELD_CLASSES}
          />
        </label>
      </div>

      {updateConsumer.isError ? (
        <p role="alert" className="text-sm text-accent">
          {describeBarError(updateConsumer.error)}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={updateConsumer.isPending}>
          {updateConsumer.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={updateConsumer.isPending}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
