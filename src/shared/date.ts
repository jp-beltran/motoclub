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
  const [year, monthNumber] = month.split('-')
  const monthIndex = Number(monthNumber) - 1
  return `${MONTH_NAMES[monthIndex]} de ${year}`
}
