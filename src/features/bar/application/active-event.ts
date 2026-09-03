import { EVENT_STATUS } from '../domain/constants'
import type { Event } from '../domain/entities'

export function getActiveEvent(events: readonly Event[]): Event | undefined {
  return events
    .filter((event) => event.status === EVENT_STATUS.ACTIVE)
    .reduce<Event | undefined>((latest, event) => {
      if (!latest) return event
      return new Date(event.startsAt).getTime() > new Date(latest.startsAt).getTime()
        ? event
        : latest
    }, undefined)
}
