import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { useInvalidateBar } from '../../application/queries'
import { useBarRepository } from '../../application/repository-context'
import type { Consumer } from '../../domain/entities'
import { describeBarError } from '../../application/error-messages'
import { Button } from '../../../../shared/ui/Button'

const MISSING_NAME_MESSAGE = 'Informe o nome do visitante.'

const FIELD_CLASSES =
  'min-h-11 w-full rounded-md border border-border-subtle bg-surface-base px-3 text-sm ' +
  'text-content-primary placeholder:text-content-muted focus-visible:outline ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

export interface VisitorQuickFormProps {
  /** Receives the created visitor, already persisted. */
  readonly onCreated: (visitor: Consumer) => void
  readonly onCancel?: () => void
}

/**
 * Minimal visitor registration: a name and, optionally, a phone. Kept apart
 * from any one screen because both the launch flow and the consumer list open
 * it to register a walk-in without leaving what they were doing.
 */
export function VisitorQuickForm({ onCreated, onCancel }: VisitorQuickFormProps) {
  const repository = useBarRepository()
  const invalidateBar = useInvalidateBar()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [validationMessage, setValidationMessage] = useState<string>()

  const createVisitor = useMutation({
    mutationFn: () => repository.createVisitor({ name: name.trim(), phone: phone.trim() }),
    onSuccess: (visitor) => {
      invalidateBar()
      setName('')
      setPhone('')
      setValidationMessage(undefined)
      onCreated(visitor)
    },
  })

  const errorMessage =
    validationMessage ??
    (createVisitor.isError ? describeBarError(createVisitor.error) : undefined)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim()) {
      setValidationMessage(MISSING_NAME_MESSAGE)
      return
    }
    setValidationMessage(undefined)
    createVisitor.mutate()
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Novo visitante"
      className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-overlay p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-content-muted">
          Nome
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nome do visitante"
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
      {errorMessage ? (
        <p role="alert" className="text-sm text-accent">
          {errorMessage}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={createVisitor.isPending}>
          {createVisitor.isPending ? 'Cadastrando…' : 'Cadastrar visitante'}
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
