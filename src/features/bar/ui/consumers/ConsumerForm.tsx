import { useState } from 'react'

import { describeBarError } from '../../application/error-messages'
import { useCreateConsumer } from '../../application/queries'
import { CONSUMER_KIND, type ConsumerKind } from '../../domain/constants'
import type { Consumer } from '../../domain/entities'
import { Button } from '../../../../shared/ui/Button'

const FIELD_CLASSES =
  'min-h-11 w-full rounded-md border border-border-subtle bg-surface-base px-3 text-sm ' +
  'text-content-primary placeholder:text-content-muted focus-visible:outline ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

const KIND_OPTIONS: readonly { readonly value: ConsumerKind; readonly label: string }[] = [
  { value: CONSUMER_KIND.MEMBER, label: 'Integrante' },
  { value: CONSUMER_KIND.VISITOR, label: 'Visitante' },
]

export interface ConsumerFormProps {
  /** Receives the registered consumer, already persisted. */
  readonly onCreated: (consumer: Consumer) => void
  readonly onCancel?: () => void
}

/**
 * The club's register: name, optional phone, and the kind — explicitly.
 *
 * The kind defaults to `member` because that is the one the system could
 * not create at all ("a opção é apenas de visitante"): the integrantes of a
 * motoclube are a roster someone sits down and types in, while a visitor is
 * usually registered mid-service by `VisitorQuickForm` on the launch
 * screen, which stays as it is.
 *
 * No rule of its own: an empty name and an unknown kind are refused by the
 * repository and printed here through `describeBarError`. A `required`
 * attribute or a local "informe o nome" would be a second copy of a rule
 * that already exists, and the browser's own bubble is not pt-BR copy this
 * screen controls.
 */
export function ConsumerForm({ onCreated, onCancel }: ConsumerFormProps) {
  const [kind, setKind] = useState<ConsumerKind>(CONSUMER_KIND.MEMBER)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const createConsumer = useCreateConsumer()

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    createConsumer.mutate(
      { name, kind, ...(phone.trim() ? { phone } : {}) },
      {
        onSuccess: (consumer) => {
          setName('')
          setPhone('')
          onCreated(consumer)
        },
      },
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Cadastrar consumidor"
      className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-overlay p-4"
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm text-content-muted">Tipo</legend>
        <div className="flex flex-wrap gap-2">
          {KIND_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${
                kind === option.value
                  ? 'border-accent bg-surface-raised text-content-primary'
                  : 'border-border-subtle text-content-muted'
              }`}
            >
              <input
                type="radio"
                name="consumer-kind"
                value={option.value}
                checked={kind === option.value}
                onChange={() => setKind(option.value)}
                className="h-4 w-4 accent-accent"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-content-muted">
          Nome
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nome completo"
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

      {createConsumer.isError ? (
        <p role="alert" className="text-sm text-accent">
          {describeBarError(createConsumer.error)}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={createConsumer.isPending}>
          {createConsumer.isPending ? 'Cadastrando…' : 'Cadastrar'}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </form>
  )
}
