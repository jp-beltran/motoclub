import { Button } from '../../../../shared/ui/Button'

export interface LaunchFeedbackProps {
  readonly message: string
  readonly tone: 'success' | 'error'
  /** Shown next to the confirmation; never blocks the launch it refers to. */
  readonly warning?: string
  readonly onUndo?: () => void
  readonly isUndoing?: boolean
}

/**
 * Short confirmation of the last launch, with the one correction the operator
 * needs most often right after a mistap.
 */
export function LaunchFeedback({
  message,
  tone,
  warning,
  onUndo,
  isUndoing = false,
}: LaunchFeedbackProps) {
  const isError = tone === 'error'

  return (
    <div className="flex flex-col gap-2">
      <div
        role={isError ? 'alert' : 'status'}
        aria-live="polite"
        className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 ${
          isError ? 'border-accent bg-surface-raised' : 'border-positive bg-surface-raised'
        }`}
      >
        <p className="text-sm text-content-primary">
          <span className="font-semibold">{isError ? 'Erro: ' : 'Registrado: '}</span>
          {message}
        </p>
        {onUndo ? (
          <Button variant="ghost" onClick={onUndo} disabled={isUndoing}>
            {isUndoing ? 'Desfazendo…' : 'Desfazer'}
          </Button>
        ) : null}
      </div>
      {warning ? (
        <p
          role="alert"
          className="rounded-lg border border-warning bg-surface-raised p-3 text-sm text-content-primary"
        >
          <span className="font-semibold">Atenção: </span>
          {warning}
        </p>
      ) : null}
    </div>
  )
}
