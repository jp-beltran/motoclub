import type { ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'primary' | 'ghost' | 'danger'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant
}

const BASE_CLASSES =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium ' +
  'transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60'

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-content-primary hover:bg-accent-strong',
  ghost:
    'border border-border-subtle bg-transparent text-content-primary hover:bg-surface-overlay',
  danger: 'bg-accent-strong text-content-primary hover:bg-accent',
}

export function Button({
  variant = 'primary',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${className}`.trim()}
      {...props}
    />
  )
}
