const MONTH_NAMES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const

export function getCurrentMonth(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export function formatMonth(month: string): string {
  const [year] = month.split('-')
  return `${formatMonthName(month)} de ${year}`
}

/** Just the month's pt-BR name, for copy that already carries the year. */
export function formatMonthName(month: string): string {
  return MONTH_NAMES[Number(month.split('-')[1]) - 1]
}
