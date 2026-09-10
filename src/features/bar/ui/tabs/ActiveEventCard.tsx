import { useState } from 'react'

import { describeBarError } from '../../application/error-messages'
import { useSelectOrCreateActiveEvent } from '../../application/queries'
import type { Event } from '../../domain/entities'
import { formatDateTime } from '../../../../shared/format'
import { Button } from '../../../../shared/ui/Button'

const FIELD_CLASSES =
  'min-h-11 w-full rounded-md border border-border-subtle bg-surface-base px-3 text-sm ' +
  'text-content-primary placeholder:text-content-muted focus-visible:outline ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

export interface ActiveEventCardProps {
  /** The event currently running, when there is one. */
  readonly event?: Event
}

/**
 * The night's event: which one is running, or the form that opens one.
 *
 * It lives on `/comandas` because that is the only screen organised *by
 * event* — every visitor tab it lists belongs to one, and each event is
 * already its own section heading. The `TopBar` shows the active event's
 * name on every screen and now links here, which is how the operator finds
 * this without knowing where it lives; putting the form itself in the TopBar
 * would push a text field into the chrome of all eight screens, and putting
 * it on `/lancamentos` would add a form to the two-tap flow that exists to
 * stay fast.
 *
 * The form appears only while no event is active, because that is exactly
 * what the port supports: `selectOrCreateActiveEvent` returns the running
 * event and *ignores the name* when one exists. Offering a "trocar evento"
 * control would be a button that silently does nothing. See the report:
 * there is no `closeEvent` in the port, so a running event cannot be ended
 * from the UI at all — the one real gap left here.
 */
export function ActiveEventCard({ event }: ActiveEventCardProps) {
  const [name, setName] = useState('')
  const openEvent = useSelectOrCreateActiveEvent()

  function handleSubmit(submitEvent: React.FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault()
    openEvent.mutate({ name }, { onSuccess: () => setName('') })
  }

  return (
    // The Card look, on a <section> rather than inside one: the card *is*
    // the landmark, the same way ConsumerDetail's panel is.
    <section
      aria-label="Evento ativo"
      className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-raised p-4"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">
          Evento ativo
        </p>
        <p className="text-base font-semibold text-content-primary">
          {event ? event.name : 'Nenhum evento ativo'}
        </p>
        <p className="mt-1 text-sm text-content-muted">
          {event
            ? `Começou em ${formatDateTime(event.startsAt)}. Todo consumo de visitante ` +
              'lançado agora entra neste evento.'
            : 'Visitantes só recebem consumo durante um evento. Abra o evento da noite ' +
              'para começar a lançar.'}
        </p>
      </div>

      {event ? null : (
        <form
          onSubmit={handleSubmit}
          aria-label="Abrir evento"
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <label className="flex flex-1 flex-col gap-1 text-sm text-content-muted">
            Nome do evento
            <input
              value={name}
              onChange={(changeEvent) => setName(changeEvent.target.value)}
              placeholder="Encontro de outubro"
              className={FIELD_CLASSES}
            />
          </label>
          <Button type="submit" disabled={openEvent.isPending}>
            {openEvent.isPending ? 'Abrindo…' : 'Abrir evento'}
          </Button>
          {openEvent.isError ? (
            <p role="alert" className="text-sm text-accent sm:self-center">
              {describeBarError(openEvent.error)}
            </p>
          ) : null}
        </form>
      )}
    </section>
  )
}
