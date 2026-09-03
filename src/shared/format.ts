const decimalFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const quantityFormatter = new Intl.NumberFormat('pt-BR')

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const amount = decimalFormatter.format(Math.abs(cents) / 100)
  return `${sign}R$ ${amount}`
}

export function formatQuantity(value: number): string {
  return quantityFormatter.format(value)
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${day}/${month}/${year} ${hours}:${minutes}`
}
