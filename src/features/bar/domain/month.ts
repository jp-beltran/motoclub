export const INVALID_TIMESTAMP_MESSAGE = 'Timestamp must be a parseable date'

export function getMonthKey(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    throw new Error(INVALID_TIMESTAMP_MESSAGE)
  }
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}`
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0')
}
