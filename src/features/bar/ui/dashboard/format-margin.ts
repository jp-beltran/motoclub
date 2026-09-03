const marginFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

/**
 * Formats a profit margin ratio (e.g. `0.271`) as a pt-BR percentage
 * (`27,1%`). `margin` is not money, so `formatCents` does not apply here.
 */
export function formatMargin(margin: number): string {
  return marginFormatter.format(margin)
}
