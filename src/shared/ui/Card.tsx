import type { HTMLAttributes } from 'react'

export type CardProps = HTMLAttributes<HTMLDivElement>

export function Card({ className = '', ...props }: CardProps) {
  return (
    <div
      className={`rounded-lg border border-border-subtle bg-surface-raised p-4 ${className}`.trim()}
      {...props}
    />
  )
}
