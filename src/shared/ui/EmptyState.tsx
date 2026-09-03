import type { ReactNode } from 'react'

export interface EmptyStateProps {
  readonly title: string
  readonly description?: string
  readonly action?: ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-subtle bg-surface-raised p-8 text-center">
      <p className="text-base font-semibold text-content-primary">{title}</p>
      {description ? <p className="text-sm text-content-muted">{description}</p> : null}
      {action}
    </div>
  )
}
