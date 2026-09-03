import { EVENT_STATUS, TAB_STATUS, type TabStatus } from '../../domain/constants'
import type { Event } from '../../domain/entities'

const TAB_STATUS_LABELS: Record<TabStatus, string> = {
  [TAB_STATUS.OPEN]: 'Aberta',
  [TAB_STATUS.CLOSED]: 'Fechada',
}

export function formatTabStatusLabel(status: TabStatus): string {
  return TAB_STATUS_LABELS[status]
}

/** An event tab can only be closed/reopened while its own event is active. */
export function isEventActive(event: Event | undefined): boolean {
  return event?.status === EVENT_STATUS.ACTIVE
}
